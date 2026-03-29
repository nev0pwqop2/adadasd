import React, { useEffect } from 'react';
import { useLocation } from 'wouter';
import { useGetMe } from '@workspace/api-client-react';
import Navbar from '@/components/Navbar';

const DiscordIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
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

const STATS = [
  { value: '500+', label: 'Total users' },
  { value: '5',    label: 'Active slots' },
  { value: '24h',  label: 'Max duration' },
  { value: '100%', label: 'Uptime' },
];

export default function Landing() {
  const [, setLocation] = useLocation();
  const { data: user, isLoading } = useGetMe({ query: { retry: false } as any });

  const params = new URLSearchParams(window.location.search);
  const errorCode = params.get('error');

  useEffect(() => {
    if (!isLoading && user) setLocation('/dashboard');
  }, [user, isLoading]);

  const handleLogin = () => {
    window.location.href = `${import.meta.env.BASE_URL}api/auth/discord`;
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0f0b07] flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-[#f5a623] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f0b07] text-white flex flex-col items-center overflow-x-hidden">
      {/* Warm radial glow */}
      <div className="pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_80%,hsla(30,70%,25%,0.35),transparent)]" />

      <Navbar current="home" />

      {/* ── Hero ── */}
      <main className="relative z-10 flex flex-col items-center justify-center flex-1 px-5 pt-16 pb-10 text-center">
        {/* Floating logo — no box, just the image */}
        <img
          src={`${import.meta.env.BASE_URL}exe-logo.png`}
          alt="Exe Joiner"
          className="w-24 h-24 object-contain mb-8 drop-shadow-[0_0_32px_rgba(245,166,35,0.4)]"
        />

        {/* Headline */}
        <h1 className="text-4xl sm:text-5xl font-extrabold leading-tight mb-1">
          Rent a slot.
        </h1>
        <h1 className="text-4xl sm:text-5xl font-extrabold leading-tight text-[#f5a623] mb-5">
          Join instantly.
        </h1>

        {/* Subtitle */}
        <p className="text-sm sm:text-base text-white/45 max-w-sm mb-8 leading-relaxed">
          Secure a limited Exe Joiner slot and get your script key delivered the moment you pay.
        </p>

        {/* Error */}
        {errorCode && (
          <div className="mb-5 px-4 py-2.5 rounded-xl border border-red-500/25 bg-red-500/8 text-xs text-red-400 max-w-xs">
            {ERROR_MESSAGES[errorCode] ?? `Error: ${errorCode}`}
          </div>
        )}

        {/* CTAs */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleLogin}
            className="px-6 h-10 rounded-lg bg-[#f5a623] text-black font-bold text-sm hover:bg-[#e8961a] transition-colors shadow-[0_2px_20px_rgba(245,166,35,0.4)]"
          >
            Get a slot
          </button>
          <button
            onClick={handleLogin}
            className="flex items-center gap-2 px-6 h-10 rounded-lg border border-white/15 bg-white/5 text-sm font-medium text-white/70 hover:text-white hover:border-white/25 transition-colors"
          >
            <DiscordIcon />
            Login with Discord
          </button>
        </div>

        {/* ── Stats row ── */}
        <div className="mt-16 grid grid-cols-2 sm:grid-cols-4 gap-3 w-full max-w-lg">
          {STATS.map(({ value, label }) => (
            <div
              key={label}
              className="flex flex-col items-center justify-center py-4 px-3 rounded-xl border border-white/8 bg-white/3"
            >
              <span className="text-lg font-bold text-white">{value}</span>
              <span className="text-xs text-white/35 mt-0.5">{label}</span>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
