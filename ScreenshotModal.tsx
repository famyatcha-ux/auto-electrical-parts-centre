import React, { useEffect, useState } from 'react';
import { getScreenshotUrl } from '../db';

interface ScreenshotModalProps {
  screenshotPath: string | null;
  onClose: () => void;
}

export default function ScreenshotModal({ screenshotPath, onClose }: ScreenshotModalProps) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!screenshotPath) return;
    setLoading(true);
    setError(false);
    // Handle legacy base64 data URLs
    if (screenshotPath.startsWith('data:')) {
      setSignedUrl(screenshotPath);
      setLoading(false);
      return;
    }
    getScreenshotUrl(screenshotPath).then((url) => {
      if (url) setSignedUrl(url);
      else setError(true);
      setLoading(false);
    });
  }, [screenshotPath]);

  if (!screenshotPath) return null;

  return (
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl overflow-hidden max-w-4xl w-full max-h-[90vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center p-4 border-b border-gray-100 bg-gray-50">
          <h3 className="font-bold text-gray-900">Screenshot</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-800 bg-white shadow-sm border border-gray-200 rounded-lg px-3 py-1 font-bold"
          >
            Close
          </button>
        </div>
        <div className="flex-1 overflow-auto p-4 bg-gray-100 flex items-center justify-center min-h-[200px]">
          {loading && <span className="text-gray-400 font-medium">Loading...</span>}
          {error && <span className="text-red-500 font-medium">Failed to load screenshot.</span>}
          {signedUrl && !loading && (
            <img
              src={signedUrl}
              alt="Attached screenshot"
              className="max-w-full max-h-[70vh] object-contain rounded shadow-sm border border-gray-200"
            />
          )}
        </div>
        {signedUrl && (
          <div className="p-4 border-t border-gray-200 bg-white flex justify-end">
            <a href={signedUrl} download="screenshot.jpg" className="text-blue-600 hover:underline font-bold text-sm">
              Download Image
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
