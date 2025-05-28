import { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';

interface FileDropzoneProps {
  onFileSelect: (file: File) => void;
}

export const FileDropzone = ({ onFileSelect }: FileDropzoneProps) => {
  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      onFileSelect(acceptedFiles[0]);
    }
  }, [onFileSelect]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'audio/mpeg': ['.mp3'],
      'audio/wav': ['.wav'],
      'audio/webm': ['.webm']
    },
    multiple: false
  });

  return (
    <div {...getRootProps()} className="dropzone">
      <input {...getInputProps()} />
      {isDragActive ? (
        <p style={{ color: '#00ff9d' }}>Drop the audio file here...</p>
      ) : (
        <p>Drag & drop an audio file here, or click to select</p>
      )}
      <p style={{ fontSize: '0.8em', color: '#888' }}>Supported formats: MP3, WAV, WebM</p>
    </div>
  );
}; 