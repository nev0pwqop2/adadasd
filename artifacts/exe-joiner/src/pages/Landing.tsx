import React, { useEffect } from 'react';
import { useLocation } from 'wouter';
import { useGetMe } from '@workspace/api-client-react';
import { motion } from 'framer-motion';

const DiscordIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057c.002.022.015.04.033.05a19.89 19.89 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
  </svg>
);

const ERROR_MESSAGES: Record<string, string> = {
  token_exchange_failed: 'Login failed — Discord rejected the token exchange.',
  rate_limited: 'Discord is rate limiting the server right now. Wait 1–2 minutes and try again.',
  discord_denied: 'You cancelled the Discord login.',
  invalid_state: 'Login session expired or was tampered with. Please try again.',
  no_code: 'No authorisation code received from Discord.',
  user_fetch_failed: 'Could not retrieve your Discord profile.',
  server_error: 'An unexpected server error occurred.',
};

export default function Landing() {
  const [, setLocation] = useLocation();
  const { data: user, isLoading } = useGetMe({ query: { retry: false } });

  const params = new URLSearchParams(window.location.search);
  const errorCode = params.get('error');
  const errorDetail = params.get('detail');

  useEffect(() => {
    if (!isLoading && user) setLocation('/dashboard');
  }, [user, isLoading]);

  const handleLogin = () => {
    window.location.href = '/api/auth/discord';
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_-10%,hsla(43,96%,56%,0.12),transparent)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_40%_30%_at_50%_110%,hsla(43,96%,56%,0.05),transparent)]" />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="relative z-10 flex flex-col items-center text-center max-w-sm w-full"
      >
        <div className="relative mb-8">
          <div className="absolute inset-0 rounded-full bg-primary/25 blur-3xl scale-[2]" />
          <img
            src={`${import.meta.env.BASE_URL}exe-logo.png`}
            alt="EXE"
            className="relative z-10 w-16 h-16"
          />
        </div>

        <h1 className="text-4xl font-display font-bold tracking-tight text-foreground mb-2">
          Exe Joiner
        </h1>
        <p className="text-sm text-muted-foreground mb-10">
          Premium slot access · Discord verified
        </p>

        {errorCode && (
          <div className="w-full mb-6 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-left space-y-2">
            <p className="text-sm font-semibold text-red-400">
              {ERROR_MESSAGES[errorCode] ?? `Error: ${errorCode}`}
            </p>
            {errorDetail && (
              <pre className="text-[10px] font-mono text-red-300/70 whitespace-pre-wrap break-all leading-relaxed">
                {decodeURIComponent(errorDetail)}
              </pre>
            )}
          </div>
        )}

        <button
          onClick={handleLogin}
          className="w-full flex items-center justify-center gap-3 h-12 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:brightness-110 active:brightness-95 transition-all shadow-[0_0_20px_hsla(43,96%,56%,0.25)]"
        >
          <DiscordIcon />
          Continue with Discord
        </button>

        <p className="mt-5 text-xs text-muted-foreground/50 leading-relaxed">
          Verified Discord accounts only
        </p>
      </motion.div>
    </div>
  );
}
