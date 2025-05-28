import { useState, useEffect, useRef } from 'react';
import { FileDropzone } from './FileDropzone';

type EncodingType = 'none' | 'split' | 'oddEven';

interface AudioSegment {
  start: number;
  end: number;
  data: Float32Array[];
}

const MAX_SEGMENT_SIZE = 1024 * 1024; // 1MB segments max

export const AudioProcessor = () => {
  const [file, setFile] = useState<File | null>(null);
  const [encodedAudioUrl, setEncodedAudioUrl] = useState<string>('');
  const [decodedAudioUrl, setDecodedAudioUrl] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [encodingType, setEncodingType] = useState<EncodingType>('none');
  const [interval, setInterval] = useState<number>(1);
  const [isReversed, setIsReversed] = useState(false);
  const [numberOfParts, setNumberOfParts] = useState<number>(2);
  const [decodingType, setDecodingType] = useState<EncodingType>('none');
  const [decodeNumberOfParts, setDecodeNumberOfParts] = useState<number>(2);
  const [decodeInterval, setDecodeInterval] = useState<number>(1);
  const [isDecodeReversed, setIsDecodeReversed] = useState(false);
  const [isDecoding, setIsDecoding] = useState(false);
  const [decodeInputCode, setDecodeInputCode] = useState<string>('');
  const [isValidCode, setIsValidCode] = useState<boolean>(true);

  const audioContextRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    return () => {
      if (encodedAudioUrl) URL.revokeObjectURL(encodedAudioUrl);
      if (decodedAudioUrl) URL.revokeObjectURL(decodedAudioUrl);
      if (audioContextRef.current) audioContextRef.current.close();
    };
  }, []);

  const initAudioContext = async () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      await audioContextRef.current.resume();
    }
    return audioContextRef.current;
  };

  const createAudioSegments = async (audioBuffer: AudioBuffer, segmentDuration: number): Promise<AudioSegment[]> => {
    const segments: AudioSegment[] = [];
    const numberOfSegments = Math.ceil(audioBuffer.duration / segmentDuration);
    const maxSamplesPerSegment = Math.min(
      Math.floor(segmentDuration * audioBuffer.sampleRate),
      MAX_SEGMENT_SIZE / audioBuffer.numberOfChannels
    );
    
    for (let i = 0; i < numberOfSegments; i++) {
      const start = i * segmentDuration;
      const end = Math.min((i + 1) * segmentDuration, audioBuffer.duration);
      const segmentLength = Math.min(
        Math.floor((end - start) * audioBuffer.sampleRate),
        maxSamplesPerSegment
      );
      
      const channelData: Float32Array[] = [];
      for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
        const data = new Float32Array(segmentLength);
        audioBuffer.copyFromChannel(data, channel, Math.floor(start * audioBuffer.sampleRate));
        channelData.push(data);
      }
      
      segments.push({
        start,
        end,
        data: channelData
      });

      // Force garbage collection of unused data
      if (i % 100 === 0) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    
    return segments;
  };

  const processInBatches = async (
    segments: AudioSegment[],
    audioContext: AudioContext,
    numberOfChannels: number,
    sampleRate: number,
    batchSize: number = 50
  ): Promise<AudioBuffer> => {
    const totalLength = segments.reduce((sum, segment) => sum + segment.data[0].length, 0);
    const resultBuffer = audioContext.createBuffer(numberOfChannels, totalLength, sampleRate);
    
    let writePosition = 0;
    for (let i = 0; i < segments.length; i += batchSize) {
      const batch = segments.slice(i, i + batchSize);
      
      for (const segment of batch) {
        for (let channel = 0; channel < numberOfChannels; channel++) {
          const channelData = resultBuffer.getChannelData(channel);
          channelData.set(segment.data[channel], writePosition);
        }
        writePosition += segment.data[0].length;
        
        // Clear segment data after use
        segment.data = [];
      }
      
      // Allow other operations to process
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    
    return resultBuffer;
  };

  const reverseAudioBuffer = (buffer: AudioBuffer): AudioBuffer => {
    const reversedBuffer = audioContextRef.current!.createBuffer(
      buffer.numberOfChannels,
      buffer.length,
      buffer.sampleRate
    );

    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const channelData = buffer.getChannelData(channel);
      const reversedData = reversedBuffer.getChannelData(channel);
      for (let i = 0; i < channelData.length; i++) {
        reversedData[i] = channelData[channelData.length - 1 - i];
      }
    }

    return reversedBuffer;
  };

  const audioBufferToWav = (buffer: AudioBuffer): Blob => {
    const numberOfChannels = buffer.numberOfChannels;
    const length = buffer.length * numberOfChannels * 2;
    const sampleRate = buffer.sampleRate;
    
    const wav = new ArrayBuffer(44 + length);
    const view = new DataView(wav);
    
    // Write WAV header
    // "RIFF" chunk descriptor
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + length, true);
    writeString(view, 8, 'WAVE');
    
    // "fmt " sub-chunk
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true); // fmt chunk size
    view.setUint16(20, 1, true); // audio format (1 for PCM)
    view.setUint16(22, numberOfChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numberOfChannels * 2, true); // byte rate
    view.setUint16(32, numberOfChannels * 2, true); // block align
    view.setUint16(34, 16, true); // bits per sample
    
    // "data" sub-chunk
    writeString(view, 36, 'data');
    view.setUint32(40, length, true);
    
    // Write interleaved audio data
    const offset = 44;
    const channelData = new Array(numberOfChannels).fill(0).map((_, i) => buffer.getChannelData(i));
    for (let i = 0; i < buffer.length; i++) {
      for (let channel = 0; channel < numberOfChannels; channel++) {
        const sample = Math.max(-1, Math.min(1, channelData[channel][i]));
        view.setInt16(offset + (i * numberOfChannels + channel) * 2, sample * 0x7FFF, true);
      }
    }
    
    return new Blob([wav], { type: 'audio/wav' });
  };

  const writeString = (view: DataView, offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  const generateEncodingCode = (): string => {
    const typePrefix = encodingType === 'split' ? 's' : encodingType === 'oddEven' ? 'oe' : '';
    if (!typePrefix) return '';
    
    const partsCode = encodingType === 'split' ? `b${numberOfParts}` : 'b';
    const intervalCode = `b${interval}`;
    const reverseCode = isReversed ? 't' : 'f';
    
    return `${typePrefix}${partsCode}${intervalCode}${reverseCode}`;
  };

  const parseEncodingCode = (code: string): boolean => {
    try {
      // Split by 'b' to get parts: [type, parts, interval, reverse]
      const parts = code.split('b');
      if (parts.length !== 3) return false;

      const [type, partsStr, intervalWithReverse] = parts;
      if (!type || !intervalWithReverse) return false;

      // Parse reverse flag (last character)
      const reverse = intervalWithReverse.slice(-1);
      if (reverse !== 't' && reverse !== 'f') return false;

      // Parse interval (everything except last character)
      const interval = parseFloat(intervalWithReverse.slice(0, -1));
      if (isNaN(interval) || interval < 0.001 || interval > 10) return false;

      // Parse type and parts
      if (type === 's') {
        const parts = parseInt(partsStr);
        if (isNaN(parts) || parts < 2 || parts > 10) return false;
        setDecodingType('split');
        setDecodeNumberOfParts(parts);
      } else if (type === 'oe') {
        if (partsStr !== '') return false;
        setDecodingType('oddEven');
      } else {
        return false;
      }

      setDecodeInterval(interval);
      setIsDecodeReversed(reverse === 't');
      return true;
    } catch (error) {
      return false;
    }
  };

  const encodeAudio = async () => {
    if (!file) return;
    setIsProcessing(true);

    try {
      const audioContext = await initAudioContext();
      const arrayBuffer = await file.arrayBuffer();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      
      // Create segments
      const segments = await createAudioSegments(audioBuffer, interval);
      
      // Reorder segments based on encoding type
      let reorderedSegments: AudioSegment[] = [];
      
      if (encodingType === 'split') {
        // Split into N parts and interleave
        const segmentsPerPart = Math.ceil(segments.length / numberOfParts);
        const parts: AudioSegment[][] = [];
        
        // Divide segments into N parts
        for (let i = 0; i < numberOfParts; i++) {
          const startIdx = i * segmentsPerPart;
          const endIdx = Math.min((i + 1) * segmentsPerPart, segments.length);
          parts.push(segments.slice(startIdx, endIdx));
        }
        
        // Interleave segments from all parts
        const maxLength = Math.max(...parts.map(part => part.length));
        for (let i = 0; i < maxLength; i++) {
          for (let part of parts) {
            if (part[i]) {
              reorderedSegments.push(part[i]);
            }
          }
        }
      } else if (encodingType === 'oddEven') {
        // Add odd indices first, then even indices
        const odd = segments.filter((_, i) => i % 2 === 0);
        const even = segments.filter((_, i) => i % 2 === 1);
        reorderedSegments = [...odd, ...even];
      }

      // Process the reordered segments in batches
      const encodedBuffer = await processInBatches(
        reorderedSegments,
        audioContext,
        audioBuffer.numberOfChannels,
        audioBuffer.sampleRate
      );

      // Clear original segments
      segments.length = 0;
      reorderedSegments.length = 0;

      // Apply reverse if needed
      const finalBuffer = isReversed ? reverseAudioBuffer(encodedBuffer) : encodedBuffer;

      // Convert to WAV and create URL
      const wavBlob = audioBufferToWav(finalBuffer);
      if (encodedAudioUrl) {
        URL.revokeObjectURL(encodedAudioUrl);
      }
      const url = URL.createObjectURL(wavBlob);
      setEncodedAudioUrl(url);
      
    } catch (error) {
      console.error('Error encoding audio:', error);
      alert('Error encoding audio. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  const decodeAudio = async () => {
    if (!file) return;
    setIsDecoding(true);

    try {
      const audioContext = await initAudioContext();
      const arrayBuffer = await file.arrayBuffer();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

      // First reverse the audio if it was reversed during encoding
      let workingBuffer = isDecodeReversed ? reverseAudioBuffer(audioBuffer) : audioBuffer;
      
      // Create segments
      const segments = await createAudioSegments(workingBuffer, decodeInterval);
      
      // Reorder segments based on decoding type
      let reorderedSegments: AudioSegment[] = [];
      
      if (decodingType === 'split') {
        // For split decoding, we need to un-interleave the parts
        const totalSegments = segments.length;
        const segmentsPerPart = Math.ceil(totalSegments / decodeNumberOfParts);
        
        // Create array to hold segments in their original positions
        reorderedSegments = new Array(totalSegments);
        
        // Calculate where each segment should go
        segments.forEach((segment, index) => {
          const partIndex = index % decodeNumberOfParts;
          const positionInPart = Math.floor(index / decodeNumberOfParts);
          const finalPosition = partIndex * segmentsPerPart + positionInPart;
          if (finalPosition < totalSegments) {
            reorderedSegments[finalPosition] = segment;
          }
        });
        
        // Remove any undefined elements (in case of uneven division)
        reorderedSegments = reorderedSegments.filter(Boolean);
        
      } else if (decodingType === 'oddEven') {
        // For odd/even decoding, we need to reorder odd and even segments
        const totalSegments = segments.length;
        const oddCount = Math.ceil(totalSegments / 2);
        
        // First half of segments are odd positions
        const odds = segments.slice(0, oddCount);
        // Second half of segments are even positions
        const evens = segments.slice(oddCount);
        
        // Interleave them back in the correct order
        reorderedSegments = new Array(totalSegments);
        odds.forEach((segment, index) => {
          reorderedSegments[index * 2] = segment;
        });
        evens.forEach((segment, index) => {
          if (index * 2 + 1 < totalSegments) {
            reorderedSegments[index * 2 + 1] = segment;
          }
        });
        
        // Remove any undefined elements
        reorderedSegments = reorderedSegments.filter(Boolean);
      }

      // Process the reordered segments in batches
      const decodedBuffer = await processInBatches(
        reorderedSegments,
        audioContext,
        workingBuffer.numberOfChannels,
        workingBuffer.sampleRate
      );

      // Clear segments from memory
      segments.length = 0;
      reorderedSegments.length = 0;

      // Convert to WAV and create URL
      const wavBlob = audioBufferToWav(decodedBuffer);
      if (decodedAudioUrl) {
        URL.revokeObjectURL(decodedAudioUrl);
      }
      const url = URL.createObjectURL(wavBlob);
      setDecodedAudioUrl(url);
      
    } catch (error) {
      console.error('Error decoding audio:', error);
      alert('Error decoding audio. Please try again.');
    } finally {
      setIsDecoding(false);
    }
  };

  useEffect(() => {
    if (decodeInputCode) {
      setIsValidCode(parseEncodingCode(decodeInputCode));
    } else {
      setIsValidCode(true);
    }
  }, [decodeInputCode]);

  const handleDownload = (url: string, prefix: string) => {
    if (url && file) {
      const a = document.createElement('a');
      a.href = url;
      a.download = `${prefix}_${file.name}`; // Keep original extension
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  return (
    <div className="App">
      <div className="background-lights">
        <div className="light-left"></div>
        <div className="light-right"></div>
      </div>
      <div className="top-section">
        <h1>Audio Encode</h1>
        <FileDropzone onFileSelect={setFile} />
        {file && (
          <div className="file-info">
            Selected file: {file.name} ({(file.size / (1024 * 1024)).toFixed(2)} MB)
          </div>
        )}
      </div>

      {file && (
        <div className="split-container">
          <div className="panel encode">
            <h2>Encode</h2>
            <div className="encoding-options">
              <div style={{ marginBottom: '15px' }}>
                <label style={{ marginRight: '10px' }}>Encoding Type:</label>
                <select
                  value={encodingType}
                  onChange={(e) => setEncodingType(e.target.value as EncodingType)}
                  style={{ padding: '5px', borderRadius: '4px' }}
                >
                  <option value="none">None</option>
                  <option value="split">Split</option>
                  <option value="oddEven">Odd/Even</option>
                </select>
              </div>

              {encodingType === 'split' && (
                <div style={{ marginBottom: '15px' }}>
                  <label style={{ marginRight: '10px' }}>Number of Parts:</label>
                  <input
                    type="number"
                    min="2"
                    max="10"
                    step="1"
                    value={numberOfParts}
                    onChange={(e) => setNumberOfParts(Math.max(2, parseInt(e.target.value)))}
                    style={{ padding: '5px', borderRadius: '4px', width: '100px' }}
                  />
                </div>
              )}

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
                  Reverse Audio
                </label>
              </div>

              {encodingType !== 'none' && (
                <div className="encoding-code" style={{ 
                  marginTop: '20px',
                  padding: '10px',
                  background: 'rgba(0, 255, 157, 0.1)',
                  borderRadius: '5px',
                  border: '1px solid #00ff9d'
                }}>
                  <p style={{ margin: '0 0 5px 0', color: '#00ff9d' }}>Encoding Code:</p>
                  <code style={{ 
                    fontSize: '1.2em',
                    color: '#fff',
                    backgroundColor: 'rgba(0, 0, 0, 0.3)',
                    padding: '5px 10px',
                    borderRadius: '3px'
                  }}>{generateEncodingCode()}</code>
                </div>
              )}

              <button
                onClick={encodeAudio}
                disabled={isProcessing || encodingType === 'none'}
                className={`button ${encodingType === 'none' ? 'disabled' : 'primary'}`}
                style={{ marginTop: '20px' }}
              >
                {isProcessing ? 'Processing...' : 'Encode Audio'}
              </button>
            </div>

            {encodedAudioUrl && (
              <div className="audio-controls">
                <audio controls src={encodedAudioUrl} style={{ width: '100%', marginBottom: '10px' }} />
                <button
                  onClick={() => handleDownload(encodedAudioUrl, 'encoded')}
                  className="button success"
                >
                  Download Encoded Audio
                </button>
              </div>
            )}
          </div>

          <div className="panel decode">
            <h2>Decode</h2>
            <div className="encoding-options">
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', marginBottom: '10px' }}>Enter Encoding Code:</label>
                <input
                  type="text"
                  value={decodeInputCode}
                  onChange={(e) => setDecodeInputCode(e.target.value)}
                  placeholder="e.g. sb5b0.2bt"
                  style={{
                    width: '80%',
                    padding: '10px',
                    borderRadius: '5px',
                    border: `1px solid ${isValidCode ? '#bf00ff' : '#ff0000'}`,
                    backgroundColor: 'rgba(0, 0, 0, 0.2)',
                    color: '#fff',
                    fontSize: '1.1em',
                    fontFamily: 'monospace',
                    display: 'block',
                    margin: '0 auto'
                  }}
                />
                {!isValidCode && decodeInputCode && (
                  <p style={{ color: '#ff0000', margin: '5px 0 0 0', fontSize: '0.9em' }}>
                    Invalid encoding code format
                  </p>
                )}
              </div>

              <button
                onClick={decodeAudio}
                disabled={isDecoding || !isValidCode || !decodeInputCode}
                className={`button ${!isValidCode || !decodeInputCode ? 'disabled' : 'primary'}`}
              >
                {isDecoding ? 'Processing...' : 'Decode Audio'}
              </button>
            </div>

            {decodedAudioUrl && (
              <div className="audio-controls">
                <audio controls src={decodedAudioUrl} style={{ width: '100%', marginBottom: '10px' }} />
                <button
                  onClick={() => handleDownload(decodedAudioUrl, 'decoded')}
                  className="button success"
                >
                  Download Decoded Audio
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}; 