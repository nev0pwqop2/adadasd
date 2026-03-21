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
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="w-full max-w-sm flex flex-col items-center text-center"
      >
        <div className="mb-8">
          <div className="inline-flex items-center justify-center mb-6">
            <div className="relative">
              <div className="absolute inset-0 rounded-full bg-primary/20 blur-2xl scale-150" />
              <img
                src={`${import.meta.env.BASE_URL}exe-logo.png`}
                alt="EXE Logo"
                className="w-20 h-20 relative z-10"
              />
            </div>
          </div>

          <h1 className="text-4xl font-display font-bold tracking-tight text-foreground mb-2">
            Exe Joiner
          </h1>
          <p className="text-sm text-muted-foreground">
            Discord-verified slot access
          </p>
        </div>

        <div className="w-full bg-card border border-border rounded-2xl p-6">
          <Button
            onClick={handleLogin}
            className="w-full h-11 text-sm bg-[#5865F2] hover:bg-[#4752C4] text-white border-none shadow-lg rounded-xl font-semibold"
          >
            Continue with Discord
          </Button>

          <p className="text-xs text-muted-foreground/60 mt-4 leading-relaxed">
            By continuing you agree to our terms of service.
            Only verified Discord accounts may access this system.
          </p>
        </div>
      </motion.div>
    </div>
  );
}
