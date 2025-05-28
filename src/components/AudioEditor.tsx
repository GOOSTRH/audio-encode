import { useState, useEffect, useRef } from 'react';

interface AudioEditorProps {
  file: File;
}

type EncodingType = 'none' | 'split' | 'oddEven';

interface AudioSegment {
  start: number;
  end: number;
}

export const AudioEditor: React.FC<AudioEditorProps> = ({ file }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(1);
  const [audioUrl, setAudioUrl] = useState<string>('');
  const [isAudioContextInitialized, setIsAudioContextInitialized] = useState(false);
  const [encodingType, setEncodingType] = useState<EncodingType>('none');
  const [interval, setInterval] = useState<number>(1); // interval in seconds
  const [isReversed, setIsReversed] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [encodedAudioUrl, setEncodedAudioUrl] = useState<string>('');
  
  const audioRef = useRef<HTMLAudioElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setAudioUrl(url);
    setEncodedAudioUrl('');
    
    return () => {
      URL.revokeObjectURL(url);
      if (encodedAudioUrl) {
        URL.revokeObjectURL(encodedAudioUrl);
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, [file]);

  const initializeAudioContext = async () => {
    if (audioRef.current && !audioContextRef.current) {
      try {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        await audioContextRef.current.resume();
        
        gainNodeRef.current = audioContextRef.current.createGain();
        sourceNodeRef.current = audioContextRef.current.createMediaElementSource(audioRef.current);
        sourceNodeRef.current.connect(gainNodeRef.current);
        gainNodeRef.current.connect(audioContextRef.current.destination);
        gainNodeRef.current.gain.value = volume;
        
        setIsAudioContextInitialized(true);
      } catch (error) {
        console.error('Error initializing audio context:', error);
      }
    }
  };

  const createAudioSegments = (totalDuration: number): AudioSegment[] => {
    const segments: AudioSegment[] = [];
    const segmentCount = Math.floor(totalDuration / interval);
    
    for (let i = 0; i < segmentCount; i++) {
      segments.push({
        start: i * interval,
        end: Math.min((i + 1) * interval, totalDuration)
      });
    }

    // Add remaining segment if there's a partial interval left
    if (segmentCount * interval < totalDuration) {
      segments.push({
        start: segmentCount * interval,
        end: totalDuration
      });
    }

    return segments;
  };

  const reorderSegments = (segments: AudioSegment[]): AudioSegment[] => {
    if (encodingType === 'split') {
      const firstHalf = segments.filter((_, i) => i % 2 === 0);
      const secondHalf = segments.filter((_, i) => i % 2 === 1);
      return [...firstHalf, ...secondHalf];
    } else if (encodingType === 'oddEven') {
      const odd = segments.filter((_, i) => i % 2 === 0);
      const even = segments.filter((_, i) => i % 2 === 1);
      return [...odd, ...even];
    }
    return segments;
  };

  const encodeAudio = async () => {
    if (!audioContextRef.current) {
      await initializeAudioContext();
    }

    setIsProcessing(true);

    try {
      const response = await fetch(audioUrl);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await audioContextRef.current!.decodeAudioData(arrayBuffer);

      const segments = createAudioSegments(audioBuffer.duration);
      const reorderedSegments = reorderSegments(segments);
      
      if (isReversed) {
        reorderedSegments.reverse();
      }

      // Create a new buffer for the encoded audio
      const encodedBuffer = audioContextRef.current!.createBuffer(
        audioBuffer.numberOfChannels,
        audioBuffer.length,
        audioBuffer.sampleRate
      );

      // Fill the new buffer with reordered segments
      for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
        const inputData = audioBuffer.getChannelData(channel);
        const outputData = encodedBuffer.getChannelData(channel);
        
        let writePosition = 0;
        for (const segment of reorderedSegments) {
          const startSample = Math.floor(segment.start * audioBuffer.sampleRate);
          const endSample = Math.floor(segment.end * audioBuffer.sampleRate);
          const segmentLength = endSample - startSample;
          
          for (let i = 0; i < segmentLength; i++) {
            outputData[writePosition + i] = inputData[startSample + i];
          }
          writePosition += segmentLength;
        }
      }

      // Convert the buffer to a WAV file
      const wavBlob = await audioBufferToWav(encodedBuffer);
      const newUrl = URL.createObjectURL(wavBlob);
      
      if (encodedAudioUrl) {
        URL.revokeObjectURL(encodedAudioUrl);
      }
      
      setEncodedAudioUrl(newUrl);
      setIsProcessing(false);

    } catch (error) {
      console.error('Error encoding audio:', error);
      setIsProcessing(false);
    }
  };

  // Convert AudioBuffer to WAV format
  const audioBufferToWav = (buffer: AudioBuffer): Promise<Blob> => {
    const numberOfChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const format = 1; // PCM
    const bitDepth = 16;
    
    const bytesPerSample = bitDepth / 8;
    const blockAlign = numberOfChannels * bytesPerSample;
    
    const dataLength = buffer.length * blockAlign;
    const bufferLength = 44 + dataLength;
    
    const arrayBuffer = new ArrayBuffer(bufferLength);
    const view = new DataView(arrayBuffer);
    
    // Write WAV header
    const writeString = (offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };
    
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataLength, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, format, true);
    view.setUint16(22, numberOfChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    writeString(36, 'data');
    view.setUint32(40, dataLength, true);
    
    // Write audio data
    const offset = 44;
    const channelData = new Array(numberOfChannels).fill(0).map((_, i) => buffer.getChannelData(i));
    
    for (let i = 0; i < buffer.length; i++) {
      for (let channel = 0; channel < numberOfChannels; channel++) {
        const sample = Math.max(-1, Math.min(1, channelData[channel][i]));
        const value = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
        view.setInt16(offset + (i * blockAlign) + (channel * bytesPerSample), value, true);
      }
    }
    
    return Promise.resolve(new Blob([arrayBuffer], { type: 'audio/wav' }));
  };

  const handlePlayPause = async () => {
    if (!isAudioContextInitialized) {
      await initializeAudioContext();
    }

    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        try {
          if (audioContextRef.current?.state === 'suspended') {
            await audioContextRef.current.resume();
          }
          await audioRef.current.play();
        } catch (error) {
          console.error('Error playing audio:', error);
        }
      }
      setIsPlaying(!isPlaying);
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = parseFloat(e.target.value);
    setVolume(newVolume);
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = newVolume;
    }
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    setCurrentTime(time);
    if (audioRef.current) {
      audioRef.current.currentTime = time;
    }
  };

  const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const handleDownload = () => {
    if (encodedAudioUrl) {
      const a = document.createElement('a');
      a.href = encodedAudioUrl;
      a.download = `encoded_${file.name.replace('.mp3', '')}.wav`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  return (
    <div style={{ padding: '20px', border: '1px solid #ccc', borderRadius: '8px', marginTop: '20px' }}>
      <h2>Audio Editor</h2>
      <audio
        ref={audioRef}
        src={encodedAudioUrl || audioUrl}
        onLoadedMetadata={() => {
          if (audioRef.current) {
            setDuration(audioRef.current.duration);
          }
        }}
        onTimeUpdate={handleTimeUpdate}
        onEnded={() => setIsPlaying(false)}
      />
      
      <div style={{ marginBottom: '20px' }}>
        <button 
          onClick={handlePlayPause}
          style={{
            padding: '8px 16px',
            backgroundColor: '#4a90e2',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            marginRight: '10px'
          }}
        >
          {isPlaying ? 'Pause' : 'Play'}
        </button>

        {encodedAudioUrl && (
          <button
            onClick={handleDownload}
            style={{
              padding: '8px 16px',
              backgroundColor: '#4CAF50',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Download Encoded Audio
          </button>
        )}
      </div>

      <div style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span>{formatTime(currentTime)}</span>
          <input
            type="range"
            min="0"
            max={duration}
            value={currentTime}
            onChange={handleSeek}
            style={{ flex: 1 }}
          />
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
        <span>Volume:</span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={volume}
          onChange={handleVolumeChange}
          style={{ width: '200px' }}
        />
      </div>

      <div style={{ 
        padding: '20px',
        backgroundColor: '#f5f5f5',
        borderRadius: '8px',
        marginTop: '20px'
      }}>
        <h3>Encoding Options</h3>
        
        <div style={{ marginBottom: '15px' }}>
          <label style={{ marginRight: '10px' }}>Encoding Type:</label>
          <select
            value={encodingType}
            onChange={(e) => setEncodingType(e.target.value as EncodingType)}
            style={{ padding: '5px', borderRadius: '4px' }}
          >
            <option value="none">None</option>
            <option value="split">Split (1,4,2,5,3,6)</option>
            <option value="oddEven">Odd/Even (1,3,5,2,4,6)</option>
          </select>
        </div>

        <div style={{ marginBottom: '15px' }}>
          <label style={{ marginRight: '10px' }}>Interval (seconds):</label>
          <input
            type="number"
            min="0.001"
            max="10"
            step="0.001"
            value={interval}
            onChange={(e) => setInterval(parseFloat(e.target.value))}
            style={{ padding: '5px', borderRadius: '4px', width: '100px' }}
          />
        </div>

        <div style={{ marginBottom: '15px' }}>
          <label style={{ marginRight: '10px' }}>
            <input
              type="checkbox"
              checked={isReversed}
              onChange={(e) => setIsReversed(e.target.checked)}
              style={{ marginRight: '5px' }}
            />
            Reverse Order
          </label>
        </div>

        <button
          onClick={encodeAudio}
          disabled={isProcessing || encodingType === 'none'}
          style={{
            padding: '8px 16px',
            backgroundColor: encodingType === 'none' ? '#ccc' : '#4a90e2',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: encodingType === 'none' ? 'not-allowed' : 'pointer'
          }}
        >
          {isProcessing ? 'Processing...' : 'Encode Audio'}
        </button>
      </div>
    </div>
  );
}; 