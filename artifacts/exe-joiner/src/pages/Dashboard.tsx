import React, { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { LogOut, LayoutGrid, AlertTriangle, CheckCircle } from 'lucide-react';
import { useGetMe, useGetSlots, useLogout, Slot } from '@workspace/api-client-react';
import { SlotCard } from '@/components/SlotCard';
import { PaymentModal } from '@/components/PaymentModal';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { motion } from 'framer-motion';

export default function Dashboard() {
  const [location, setLocation] = useLocation();
  const { toast } = useToast();
  
  const { data: user, isError: isUserError, isLoading: isUserLoading } = useGetMe({ 
    query: { retry: false } 
  });
  
  const { data: slotsRes, refetch: refetchSlots, isLoading: isSlotsLoading } = useGetSlots({
    query: { enabled: !!user }
  });

  const { mutate: logoutMutate } = useLogout();

  const [purchasingSlot, setPurchasingSlot] = useState<number | null>(null);

  // Handle Stripe redirect params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('payment') === 'success') {
      toast({
        title: "Payment Successful",
        description: "Your slot has been activated.",
        className: "bg-primary text-primary-foreground border-none"
      });
      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (params.get('payment') === 'cancelled') {
      toast({
        title: "Payment Cancelled",
        description: "The transaction was aborted.",
        variant: "destructive"
      });
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, [toast]);

  useEffect(() => {
    if (isUserError) {
      setLocation('/');
    }
  }, [isUserError, setLocation]);

  const handleLogout = () => {
    logoutMutate(undefined, {
      onSuccess: () => setLocation('/')
    });
  };

  if (isUserLoading || isSlotsLoading) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
        <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
        <p className="font-mono text-primary animate-pulse tracking-widest uppercase text-sm">Initializing Interface...</p>
      </div>
    );
  }

  if (!user) return null;

  const slots = slotsRes?.slots || [];
  const activeCount = slots.filter(s => s.isActive).length;

  // Build array of 6 slots, filling missing ones with dummy data
  const gridSlots = Array.from({ length: 6 }).map((_, i) => {
    const num = i + 1;
    return slots.find(s => s.slotNumber === num) || { id: -num, slotNumber: num, isActive: false } as Slot;
  });

  return (
    <div className="min-h-screen bg-background relative overflow-x-hidden">
      {/* Background effects */}
      <div 
        className="fixed inset-0 z-0 opacity-[0.03] bg-cover bg-center mix-blend-screen pointer-events-none"
        style={{ backgroundImage: `url(${import.meta.env.BASE_URL}images/cyber-bg.png)` }}
      />
      
      <div className="relative z-10 flex flex-col min-h-screen">
        {/* Top Navbar */}
        <header className="border-b border-primary/20 bg-card/80 backdrop-blur-md sticky top-0 z-40">
          <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
            
            <div className="flex items-center gap-4">
              <div className="w-8 h-8 bg-primary text-primary-foreground flex items-center justify-center font-display font-bold chamfered">
                EX
              </div>
              <h1 className="font-display font-bold uppercase tracking-widest text-primary hidden sm:block glow-text">
                Dashboard
              </h1>
            </div>

            <div className="flex items-center gap-6">
              <div className="hidden md:flex flex-col items-end">
                <span className="text-xs font-mono text-muted-foreground uppercase">System Status</span>
                <span className="text-sm font-mono text-primary flex items-center gap-2">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                  </span>
                  {activeCount} / 6 NODES ONLINE
                </span>
              </div>

              <div className="h-8 w-px bg-primary/20 hidden sm:block"></div>

              <div className="flex items-center gap-4">
                <div className="flex items-center gap-3">
                  {user.avatar ? (
                    <img src={`https://cdn.discordapp.com/avatars/${user.discordId}/${user.avatar}.png`} alt="Avatar" className="w-8 h-8 rounded-none border border-primary/50 chamfered" />
                  ) : (
                    <div className="w-8 h-8 bg-secondary border border-primary/50 chamfered" />
                  )}
                  <span className="font-mono text-sm hidden sm:block text-foreground">{user.username}</span>
                </div>
                
                <Button variant="outline" size="sm" onClick={handleLogout} className="border-primary/20 text-muted-foreground hover:text-primary">
                  <LogOut className="w-4 h-4 sm:mr-2" />
                  <span className="hidden sm:inline">DISCONNECT</span>
                </Button>
              </div>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 max-w-7xl mx-auto px-4 py-8 w-full">
          <div className="mb-8 flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-display font-bold uppercase text-foreground flex items-center gap-3">
                <LayoutGrid className="text-primary" /> Array Configuration
              </h2>
              <p className="text-muted-foreground font-mono mt-1 text-sm">Manage your allocated execution slots.</p>
            </div>
          </div>

          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
          >
            {gridSlots.map((slot, idx) => (
              <motion.div
                key={slot.slotNumber}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.1 }}
              >
                <SlotCard 
                  slotNumber={slot.slotNumber} 
                  slotData={slot.id > 0 ? slot : undefined} 
                  onPurchase={setPurchasingSlot}
                />
              </motion.div>
            ))}
          </motion.div>

        </main>
        
        {/* Footer */}
        <footer className="border-t border-primary/10 bg-background/50 py-6 mt-auto">
          <div className="max-w-7xl mx-auto px-4 text-center text-xs font-mono text-muted-foreground">
            <p className="uppercase tracking-widest">[ Exe Joiner Core System v1.0.0 // Encrypted Connection ]</p>
          </div>
        </footer>
      </div>

      <PaymentModal 
        isOpen={purchasingSlot !== null}
        onClose={() => setPurchasingSlot(null)}
        slotNumber={purchasingSlot || 1}
        onSuccess={() => {
          refetchSlots();
        }}
      />
    </div>
  );
}
