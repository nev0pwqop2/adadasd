import React, { useEffect } from 'react';
import { useLocation } from 'wouter';
import { useGetMe } from '@workspace/api-client-react';

const DiscordIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057c.002.022.015.04.033.05a19.89 19.89 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
  </svg>
);

const ERROR_MESSAGES: Record<string, string> = {
  token_exchange_failed: 'Login failed — Discord rejected the token exchange.',
  rate_limited: 'Discord is rate limiting the server. Wait 1–2 minutes and try again.',
  discord_denied: 'You cancelled the Discord login.',
  invalid_state: 'Login session expired or was tampered with. Please try again.',
  no_code: 'No authorisation code received from Discord.',
  user_fetch_failed: 'Could not retrieve your Discord profile.',
  server_error: 'An unexpected server error occurred.',
};

export default function Landing() {
  const [, setLocation] = useLocation();
  const { data: user, isLoading } = useGetMe({ query: { retry: false } as any });

  const params = new URLSearchParams(window.location.search);
  const errorCode = params.get('error');

  useEffect(() => {
    if (!isLoading && user) setLocation('/dashboard');
  }, [user, isLoading]);

  const handleLogin = () => {
    window.location.href = '/api/auth/discord';
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0a0a0c] flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0c] flex flex-col items-center justify-center px-4">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_50%_40%_at_50%_0%,hsla(43,96%,56%,0.07),transparent)]" />

      <div className="relative z-10 w-full max-w-[360px]">
        {/* Card */}
        <div className="bg-[#111115] border border-white/8 rounded-2xl p-8 flex flex-col items-center text-center shadow-2xl">
          {/* Logo */}
          <div className="w-14 h-14 rounded-2xl bg-primary/15 border border-primary/25 flex items-center justify-center mb-5 shadow-[0_0_24px_hsla(43,96%,56%,0.15)]">
            <img
              src={`${import.meta.env.BASE_URL}exe-logo.png`}
              alt="EXE"
              className="w-9 h-9 object-contain"
            />
          </div>

          <h1 className="text-xl font-bold text-white mb-1 tracking-tight">Exe Joiner</h1>
          <p className="text-sm text-white/40 mb-6">Sign in to access your dashboard</p>

          {errorCode && (
            <div className="w-full mb-4 rounded-xl border border-red-500/25 bg-red-500/8 p-3 text-left">
              <p className="text-xs text-red-400">
                {ERROR_MESSAGES[errorCode] ?? `Error: ${errorCode}`}
              </p>
            </div>
          )}

          <button
            onClick={handleLogin}
            className="w-full flex items-center justify-center gap-2.5 h-11 rounded-xl bg-[#5865F2] text-white font-semibold text-sm hover:bg-[#4752c4] active:bg-[#3c45a5] transition-colors"
          >
            <DiscordIcon />
            Sign in with Discord
          </button>

          <p className="mt-4 text-[11px] text-white/25 leading-relaxed">
            By signing in, you agree to our Terms of Service
          </p>
        </div>

        <p className="mt-5 text-center text-xs text-white/25">
          Verified Discord accounts only
        </p>
      </div>
    </div>
  );
}
