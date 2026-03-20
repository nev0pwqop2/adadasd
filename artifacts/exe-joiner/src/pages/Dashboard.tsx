import React, { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { LogOut, LayoutGrid, Settings } from 'lucide-react';
import { useGetMe, useGetSlots, useLogout, Slot } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { SlotCard } from '@/components/SlotCard';
import { PaymentModal } from '@/components/PaymentModal';
import { ManageSlotModal } from '@/components/ManageSlotModal';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { motion } from 'framer-motion';

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: user, isError: isUserError, isLoading: isUserLoading } = useGetMe({
    query: { retry: false }
  });

  const { data: slotsRes, refetch: refetchSlots, isLoading: isSlotsLoading } = useGetSlots({
    query: { enabled: !!user }
  });

  const { mutate: logoutMutate } = useLogout();
  const queryClient = useQueryClient();
  const [purchasingSlot, setPurchasingSlot] = useState<number | null>(null);
  const [managingSlot, setManagingSlot] = useState<Slot | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('payment') === 'success') {
      toast({ title: "Payment Successful", description: "Your slot has been activated.", className: "bg-primary text-primary-foreground border-none" });
      window.history.replaceState({}, document.title, window.location.pathname);
      refetchSlots();
    } else if (params.get('payment') === 'cancelled') {
      toast({ title: "Payment Cancelled", description: "The transaction was aborted.", variant: "destructive" });
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, [toast, refetchSlots]);

  useEffect(() => {
    if (isUserError) setLocation('/');
  }, [isUserError, setLocation]);

  const handleLogout = () => {
    logoutMutate(undefined, {
      onSuccess: () => { queryClient.clear(); setLocation('/'); },
      onError: () => { queryClient.clear(); setLocation('/'); },
    });
  };

  if (isUserLoading || isSlotsLoading) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
        <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        <p className="font-mono text-primary animate-pulse tracking-widest uppercase text-sm">Initializing Interface...</p>
      </div>
    );
  }

  if (!user) return null;

  const slots = slotsRes?.slots || [];
  const totalSlots = slotsRes?.totalSlots ?? 10;
  const pricePerDay = slotsRes?.pricePerDay ?? 20;
  const activeCount = slots.filter(s => s.isActive).length;

  const gridSlots = Array.from({ length: totalSlots }).map((_, i) => {
    const num = i + 1;
    return slots.find(s => s.slotNumber === num) || { id: -num, slotNumber: num, isActive: false } as Slot;
  });

  return (
    <div className="min-h-screen bg-background relative overflow-x-hidden">
      <div
        className="fixed inset-0 z-0 opacity-[0.03] bg-cover bg-center mix-blend-screen pointer-events-none"
        style={{ backgroundImage: `url(${import.meta.env.BASE_URL}images/cyber-bg.png)` }}
      />

      <div className="relative z-10 flex flex-col min-h-screen">
        <header className="border-b border-primary/20 bg-card/80 backdrop-blur-md sticky top-0 z-40">
          <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-8 h-8 bg-primary text-primary-foreground flex items-center justify-center font-display font-bold chamfered">EX</div>
              <h1 className="font-display font-bold uppercase tracking-widest text-primary hidden sm:block glow-text">Dashboard</h1>
            </div>

            <div className="flex items-center gap-6">
              <div className="hidden md:flex flex-col items-end">
                <span className="text-xs font-mono text-muted-foreground uppercase">System Status</span>
                <span className="text-sm font-mono text-primary flex items-center gap-2">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
                  </span>
                  {activeCount} / {totalSlots} NODES ONLINE
                </span>
              </div>

              <div className="h-8 w-px bg-primary/20 hidden sm:block" />

              <div className="flex items-center gap-3">
                {user.avatar ? (
                  <img src={`https://cdn.discordapp.com/avatars/${user.discordId}/${user.avatar}.png`} alt="Avatar" className="w-8 h-8 rounded-none border border-primary/50 chamfered" />
                ) : (
                  <div className="w-8 h-8 bg-secondary border border-primary/50 chamfered" />
                )}
                <span className="font-mono text-sm hidden sm:block text-foreground">{user.username}</span>
              </div>

              {user.isAdmin && (
                <Button variant="outline" size="sm" onClick={() => setLocation('/admin')} className="border-yellow-500/40 text-yellow-400 hover:text-yellow-300 hidden sm:flex">
                  <Settings className="w-4 h-4 sm:mr-2" />
                  <span className="hidden sm:inline">ADMIN</span>
                </Button>
              )}

              <Button variant="outline" size="sm" onClick={handleLogout} className="border-primary/20 text-muted-foreground hover:text-primary">
                <LogOut className="w-4 h-4 sm:mr-2" />
                <span className="hidden sm:inline">DISCONNECT</span>
              </Button>
            </div>
          </div>
        </header>

        <main className="flex-1 max-w-7xl mx-auto px-4 py-8 w-full">
          <div className="mb-8 flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-display font-bold uppercase text-foreground flex items-center gap-3">
                <LayoutGrid className="text-primary" /> Array Configuration
              </h2>
              <p className="text-muted-foreground font-mono mt-1 text-sm">
                Manage your execution slots — <span className="text-primary">${pricePerDay.toFixed(2)}/day per slot</span>
              </p>
            </div>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5"
          >
            {gridSlots.map((slot, idx) => (
              <motion.div
                key={slot.slotNumber}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.05 }}
              >
                <SlotCard
                  slotNumber={slot.slotNumber}
                  slotData={slot.id > 0 ? slot : undefined}
                  onPurchase={setPurchasingSlot}
                  onManage={setManagingSlot}
                />
              </motion.div>
            ))}
          </motion.div>
        </main>

        <footer className="border-t border-primary/10 bg-background/50 py-6 mt-auto">
          <div className="max-w-7xl mx-auto px-4 text-center text-xs font-mono text-muted-foreground">
            <p className="uppercase tracking-widest">[ Exe Joiner Core System v1.0.0 ]</p>
          </div>
        </footer>
      </div>

      <PaymentModal
        isOpen={purchasingSlot !== null}
        onClose={() => setPurchasingSlot(null)}
        slotNumber={purchasingSlot || 1}
        pricePerDay={pricePerDay}
        onSuccess={() => { refetchSlots(); }}
      />

      <ManageSlotModal
        slot={managingSlot}
        onClose={() => setManagingSlot(null)}
        onSuccess={() => { refetchSlots(); }}
      />
    </div>
  );
}
