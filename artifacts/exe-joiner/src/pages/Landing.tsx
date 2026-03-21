import React, { useEffect } from 'react';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { useGetMe } from '@workspace/api-client-react';
import { motion } from 'framer-motion';

export default function Landing() {
  const [, setLocation] = useLocation();
  const { data: user, isLoading } = useGetMe({ query: { retry: false } });

  useEffect(() => {
    if (!isLoading && user) {
      setLocation('/dashboard');
    }
  }, [user, isLoading]);

  const handleLogin = () => {
    window.location.href = '/api/auth/discord';
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen relative flex items-center justify-center overflow-hidden">
      <div
        className="absolute inset-0 z-0 opacity-15 bg-cover bg-center"
        style={{ backgroundImage: `url(${import.meta.env.BASE_URL}images/cyber-bg.png)` }}
      />
      <div className="absolute inset-0 bg-background/85 z-0" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_60%,transparent_0%,rgba(0,0,0,0.7)_100%)] z-0" />

      <div className="relative z-10 w-full max-w-sm mx-auto px-6 flex flex-col items-center text-center">

        <motion.div
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className="mb-10"
        >
          <div className="inline-flex items-center justify-center mb-5 relative">
            <div className="absolute inset-0 rounded-full bg-primary/15 blur-3xl" />
            <img
              src={`${import.meta.env.BASE_URL}exe-logo.png`}
              alt="EXE Logo"
              className="w-24 h-24 relative z-10 drop-shadow-[0_0_24px_rgba(218,165,32,0.5)]"
            />
          </div>

          <h1 className="text-5xl md:text-6xl font-display font-bold tracking-tight text-foreground glow-text mb-2 uppercase">
            Exe Joiner
          </h1>
          <p className="text-sm font-mono text-muted-foreground tracking-wider">
            Discord-verified slot access
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25, duration: 0.5 }}
          className="w-full"
        >
          <div className="bg-card/60 backdrop-blur-lg border border-white/8 rounded-xl p-8 shadow-2xl">
            <Button
              onClick={handleLogin}
              className="w-full h-12 text-base bg-[#5865F2] hover:bg-[#4752C4] text-white border-none shadow-lg rounded-lg font-semibold tracking-wide"
            >
              Continue with Discord
            </Button>

            <p className="text-xs text-muted-foreground font-mono mt-5 text-center leading-relaxed">
              By continuing you agree to our terms of service.<br />
              Only verified Discord accounts may access this system.
            </p>
          </div>
        </motion.div>

      </div>
    </div>
  );
}
