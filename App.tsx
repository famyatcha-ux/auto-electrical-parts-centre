import { useEffect, useState } from 'react';
import AssistantView from './components/AssistantView';
import OwnerView from './components/OwnerView';
import { supabase } from './lib/supabase';

const OWNER_EMAIL = import.meta.env.VITE_OWNER_EMAIL as string;

export default function App() {
  const [mode, setMode] = useState<string | null>(null);
  const [showPasswordPrompt, setShowPasswordPrompt] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const modeParam = params.get('mode');

    if (modeParam === 'owner') {
      supabase.auth.getSession().then(({ data }) => {
        if (data.session) {
          setMode('owner');
        } else {
          setShowPasswordPrompt(true);
          setMode('');
        }
      });
    } else {
      setMode(modeParam);
    }

    const { data: authListener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        setMode('');
        const url = new URL(window.location.href);
        url.searchParams.delete('mode');
        window.history.pushState({}, '', url);
      }
    });

    return () => authListener.subscription.unsubscribe();
  }, []);

  const selectMode = async (selectedMode: string) => {
    if (selectedMode === 'owner') {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        setShowPasswordPrompt(true);
        setPasswordError('');
        setPasswordInput('');
        return;
      }
    }
    if (selectedMode === '') {
      await supabase.auth.signOut();
    }
    const url = new URL(window.location.href);
    if (selectedMode) {
      url.searchParams.set('mode', selectedMode);
    } else {
      url.searchParams.delete('mode');
    }
    window.history.pushState({}, '', url);
    setMode(selectedMode);
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!OWNER_EMAIL) {
      setPasswordError('Owner email not configured. Check VITE_OWNER_EMAIL env var.');
      return;
    }
    setAuthLoading(true);
    setPasswordError('');
    const { error } = await supabase.auth.signInWithPassword({
      email: OWNER_EMAIL,
      password: passwordInput,
    });
    setAuthLoading(false);
    if (error) {
      setPasswordError('Incorrect password. Please try again.');
      setPasswordInput('');
    } else {
      setShowPasswordPrompt(false);
      const url = new URL(window.location.href);
      url.searchParams.set('mode', 'owner');
      window.history.pushState({}, '', url);
      setMode('owner');
    }
  };

  const getHeader = (modeName: string) => (
    <header className="h-[64px] bg-white border-b border-gray-200 flex shrink-0 items-center justify-between px-8">
      <div className="font-bold text-[18px] tracking-tight flex items-center gap-2 text-gray-900">
        <div className="w-6 h-6 bg-gray-900 rounded-[4px] flex items-center justify-center text-white text-sm">⚡</div>
        AUTO ELECTRICAL PARTS CENTRE
      </div>
      <div className="flex items-center gap-4">
        {modeName && (
          <span className="bg-gray-100 px-3 py-1 rounded-full text-xs font-semibold text-gray-600 border border-gray-200">
            {modeName.toUpperCase()} VIEW
          </span>
        )}
        <button
          onClick={() => selectMode('')}
          className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center hover:bg-gray-300 transition-colors"
          title="Switch Role"
        >
          <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
          </svg>
        </button>
      </div>
    </header>
  );

  const renderPasswordPrompt = () => {
    if (!showPasswordPrompt) return null;
    return (
      <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
        <div className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden">
          <div className="px-6 py-5 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
            <h3 className="font-bold text-gray-900 text-lg">Owner Access</h3>
            <button
              onClick={() => setShowPasswordPrompt(false)}
              className="text-gray-400 hover:text-gray-600"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <form onSubmit={handlePasswordSubmit} className="p-6">
            <div className="mb-5">
              <label className="block text-sm font-semibold text-gray-700 mb-2">Enter Owner Password</label>
              <input
                type="password"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                className="w-full p-3 border border-gray-300 rounded-lg text-lg tracking-widest focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="••••"
                autoFocus
              />
              {passwordError && <p className="text-red-500 text-sm mt-2 font-medium">{passwordError}</p>}
            </div>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowPasswordPrompt(false)}
                className="px-4 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={authLoading}
                className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-lg disabled:opacity-50"
              >
                {authLoading ? 'Signing in...' : 'Unlock'}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  };

  if (mode === 'assistant') {
    return (
      <div className="h-screen w-screen overflow-hidden flex flex-col bg-gray-50 font-sans text-gray-900">
        {getHeader('Assistant')}
        <main className="flex-grow overflow-auto p-6 md:p-8">
          <AssistantView />
        </main>
        {renderPasswordPrompt()}
      </div>
    );
  }

  if (mode === 'owner') {
    return (
      <div className="h-screen w-screen overflow-hidden flex flex-col bg-gray-50 font-sans text-gray-900">
        {getHeader('Owner')}
        <main className="flex-grow overflow-auto p-6 md:p-8">
          <OwnerView />
        </main>
        {renderPasswordPrompt()}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans text-gray-900">
      {getHeader('')}
      <div className="flex-grow flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-lg shadow-sm border border-gray-200 w-full max-w-sm text-center">
          <h1 className="text-xl font-bold text-gray-900 mb-2">Welcome</h1>
          <p className="text-gray-500 mb-8 font-medium text-sm">Please select your role</p>
          <div className="flex flex-col gap-3">
            <button
              onClick={() => selectMode('assistant')}
              className="w-full bg-gray-900 hover:bg-gray-800 text-white font-semibold py-3 px-4 rounded-md text-sm"
            >
              Assistant View
            </button>
            <button
              onClick={() => selectMode('owner')}
              className="w-full bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 font-semibold py-3 px-4 rounded-md text-sm"
            >
              Owner View
            </button>
          </div>
        </div>
      </div>
      {renderPasswordPrompt()}
    </div>
  );
}
