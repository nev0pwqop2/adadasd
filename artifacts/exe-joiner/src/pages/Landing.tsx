import React, { useEffect } from 'react';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { Shield, Lock } from 'lucide-react';
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
    return <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
    </div>;
  }

  return (
    <div className="min-h-screen relative flex items-center justify-center overflow-hidden">
      {/* Background Image injected via inline style since it's from public dir */}
      <div 
        className="absolute inset-0 z-0 opacity-20 bg-cover bg-center"
        style={{ backgroundImage: `url(${import.meta.env.BASE_URL}images/cyber-bg.png)` }}
      />
      <div className="absolute inset-0 bg-background/80 z-0" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,rgba(0,0,0,0.8)_100%)] z-0" />

      <div className="relative z-10 max-w-5xl mx-auto px-6 w-full flex flex-col items-center text-center">
        
        <motion.div 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="mb-8"
        >
          <div className="inline-flex items-center justify-center mb-6 relative">
            <div className="absolute inset-0 rounded-full bg-primary/20 blur-2xl animate-pulse" />
            <img
              src={`${import.meta.env.BASE_URL}exe-logo.png`}
              alt="EXE Logo"
              className="w-28 h-28 relative z-10 drop-shadow-[0_0_20px_rgba(234,179,8,0.6)]"
            />
          </div>
          
          <h1 className="text-5xl md:text-7xl font-display font-bold tracking-tighter text-transparent bg-clip-text bg-gradient-to-b from-white to-primary glow-text mb-4 uppercase">
            Exe Joiner
          </h1>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.3, duration: 0.5 }}
          className="w-full max-w-md"
        >
          <div className="bg-card/40 backdrop-blur-md border border-primary/30 p-8 chamfered relative overflow-hidden group">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary to-transparent opacity-50" />
            
            <div className="space-y-6">
              <div className="flex items-center justify-center gap-3 text-sm font-mono text-primary mb-8">
                <Shield className="w-4 h-4" />
                <span>CONNECTION SECURE</span>
                <Lock className="w-4 h-4" />
              </div>

              <Button 
                onClick={handleLogin} 
                className="w-full h-14 text-lg bg-[#5865F2] hover:bg-[#4752C4] text-white border-none shadow-[0_0_15px_rgba(88,101,242,0.4)] chamfered-btn"
              >
                Authenticate with Discord
              </Button>
              
              <p className="text-xs text-muted-foreground font-mono mt-4 text-center">
                System requires verified Discord identity protocol.
              </p>
            </div>
          </div>
        </motion.div>


      </div>
    </div>
  );
}
