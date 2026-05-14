import React, { useRef, useState } from 'react';
import { uploadScreenshot } from '../db';

interface ImageUploadProps {
  onImageSelected: (storagePath: string | undefined) => void;
  initialPath?: string | null;
  className?: string;
}

export default function ImageUpload({ onImageSelected, initialPath, className = '' }: ImageUploadProps) {
  const [preview, setPreview] = useState<string | undefined>(undefined);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [hasImage, setHasImage] = useState(!!initialPath);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const compressImage = (file: File): Promise<Blob> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let { width, height } = img;
          const maxDim = 800;
          if (width > height) {
            if (width > maxDim) { height = Math.round((height * maxDim) / width); width = maxDim; }
          } else {
            if (height > maxDim) { width = Math.round((width * maxDim) / height); height = maxDim; }
          }
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d')!;
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);
          canvas.toBlob((blob) => {
            if (blob) resolve(blob);
            else reject(new Error('Canvas toBlob failed'));
          }, 'image/jpeg', 0.6);
        };
        img.onerror = reject;
        if (typeof e.target?.result === 'string') img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('Please upload an image file.');
      return;
    }

    setUploadError(null);
    setUploading(true);

    try {
      const blob = await compressImage(file);
      // Show local preview immediately
      const url = URL.createObjectURL(blob);
      setPreview(url);

      const path = await uploadScreenshot(blob);
      if (!path) {
        setUploadError('Upload failed — try again');
        setPreview(undefined);
        onImageSelected(undefined);
      } else {
        setHasImage(true);
        onImageSelected(path);
      }
    } catch (err) {
      console.error(err);
      setUploadError('Upload failed — try again');
      setPreview(undefined);
      onImageSelected(undefined);
    } finally {
      setUploading(false);
    }
  };

  const clearImage = () => {
    setPreview(undefined);
    setHasImage(false);
    setUploadError(null);
    onImageSelected(undefined);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <label className="block text-sm font-semibold text-gray-700">Attach Screenshot (optional)</label>

      {!hasImage && !preview ? (
        <div
          onClick={() => !uploading && fileInputRef.current?.click()}
          className="border-2 border-dashed border-gray-300 rounded-lg p-6 flex flex-col items-center justify-center cursor-pointer hover:bg-gray-50 transition-colors"
        >
          {uploading ? (
            <span className="text-sm font-medium text-gray-400 animate-pulse">Uploading...</span>
          ) : (
            <>
              <svg className="w-8 h-8 text-gray-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span className="text-sm font-medium text-gray-600">Upload Screenshot</span>
            </>
          )}
        </div>
      ) : (
        <div className="relative group rounded-lg overflow-hidden border border-gray-200">
          {preview ? (
            <img src={preview} alt="Preview" className="w-full h-32 object-cover" />
          ) : (
            <div className="w-full h-32 bg-gray-100 flex items-center justify-center text-xs text-gray-500 font-bold uppercase">
              Screenshot attached ✔
            </div>
          )}
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            <button type="button" onClick={clearImage} className="bg-white text-red-600 px-3 py-1.5 rounded text-xs font-bold shadow-sm">
              Remove
            </button>
          </div>
        </div>
      )}

      {uploadError && <p className="text-red-500 text-xs font-semibold">{uploadError}</p>}

      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
      />
    </div>
  );
}
