import React, { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { LogOut, LayoutGrid, Settings, Trophy, History } from 'lucide-react';
import { useGetMe, useLogout } from '@workspace/api-client-react';
import { useQuery } from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';
import { SlotCard, type PublicSlot } from '@/components/SlotCard';
import { PaymentModal } from '@/components/PaymentModal';
import { ManageSlotModal } from '@/components/ManageSlotModal';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { motion } from 'framer-motion';
import { format } from 'date-fns';

type Tab = 'slots' | 'leaderboard' | 'deposit';

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${import.meta.env.BASE_URL}${path}`, { credentials: 'include' });
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
}

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<Tab>('slots');
  const [purchasingSlot, setPurchasingSlot] = useState<number | null>(null);
  const [managingSlot, setManagingSlot] = useState<PublicSlot | null>(null);
  const queryClient = useQueryClient();

  const { data: user, isError: isUserError, isLoading: isUserLoading } = useGetMe({ query: { retry: false } });

  const { data: slotsRes, refetch: refetchSlots, isLoading: isSlotsLoading } = useQuery({
    queryKey: ['slots'],
    queryFn: () => apiFetch<{ slots: PublicSlot[]; totalSlots: number; pricePerDay: number; slotDurationHours: number; hourlyPricingEnabled: boolean; pricePerHour: number; minHours: number }>('api/slots'),
    enabled: !!user,
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  });

  const { data: leaderboardRes, isLoading: isLeaderboardLoading } = useQuery({
    queryKey: ['leaderboard'],
    queryFn: () => apiFetch<{ leaderboard: { rank: number; username: string; discordId: string; avatar: string | null; totalSpent: number; totalHours: number }[] }>('api/slots/leaderboard'),
    enabled: !!user && activeTab === 'leaderboard',
  });

  const { data: historyRes, isLoading: isHistoryLoading } = useQuery({
    queryKey: ['history'],
    queryFn: () => apiFetch<{ payments: { id: string; slotNumber: number; method: string; currency: string | null; amount: string | null; status: string; createdAt: string }[] }>('api/slots/history'),
    enabled: !!user && activeTab === 'deposit',
  });

  const { mutate: logoutMutate } = useLogout();

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
  const slotDurationHours = slotsRes?.slotDurationHours ?? 24;
  const hourlyPricingEnabled = slotsRes?.hourlyPricingEnabled ?? false;
  const pricePerHour = slotsRes?.pricePerHour ?? 5;
  const minHours = slotsRes?.minHours ?? 2;
  const activeCount = slots.filter(s => s.isActive).length;

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'slots', label: 'Slots', icon: <LayoutGrid className="w-4 h-4" /> },
    { id: 'leaderboard', label: 'Leaderboard', icon: <Trophy className="w-4 h-4" /> },
    { id: 'deposit', label: 'Deposit', icon: <History className="w-4 h-4" /> },
  ];

  return (
    <div className="min-h-screen bg-background relative overflow-x-hidden">
      <div className="fixed inset-0 z-0 opacity-[0.03] bg-cover bg-center mix-blend-screen pointer-events-none"
        style={{ backgroundImage: `url(${import.meta.env.BASE_URL}images/cyber-bg.png)` }} />

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
                <Button variant="outline" size="sm" onClick={() => setLocation('/admin')} className="border-yellow-500/40 text-yellow-400 hover:text-yellow-300">
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

        {/* Tab bar */}
        <div className="border-b border-primary/10 bg-card/50 backdrop-blur-sm sticky top-16 z-30">
          <div className="max-w-7xl mx-auto px-4 flex gap-0">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-6 py-3 font-mono text-xs uppercase tracking-widest transition-all border-b-2 ${
                  activeTab === tab.id
                    ? 'border-primary text-primary bg-primary/5'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-primary/5'
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <main className="flex-1 max-w-7xl mx-auto px-4 py-8 w-full">

          {/* SLOTS TAB */}
          {activeTab === 'slots' && (
            <>
              <div className="mb-8">
                <h2 className="text-2xl font-display font-bold uppercase text-foreground flex items-center gap-3">
                  <LayoutGrid className="text-primary" /> Array Configuration
                </h2>
                <p className="text-muted-foreground font-mono mt-1 text-sm">
                  {hourlyPricingEnabled ? (
                    <>
                      Manage your execution slots — <span className="text-primary">${pricePerHour.toFixed(2)}/hr</span>
                      <span className="text-muted-foreground"> · min {minHours}h purchase per slot</span>
                    </>
                  ) : (
                    <>
                      Manage your execution slots — <span className="text-primary">${pricePerDay.toFixed(2)} / {slotDurationHours}h</span>
                      <span className="text-muted-foreground"> · </span>
                      <span className="text-primary/70">${(pricePerDay / slotDurationHours).toFixed(2)}/hr</span>
                      <span className="text-muted-foreground"> per slot</span>
                    </>
                  )}
                </p>
              </div>
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5"
              >
                {slots.map((slot, idx) => (
                  <motion.div key={slot.slotNumber} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.05 }}>
                    <SlotCard
                      slotData={slot}
                      onPurchase={setPurchasingSlot}
                      onManage={setManagingSlot}
                    />
                  </motion.div>
                ))}
              </motion.div>
            </>
          )}

          {/* LEADERBOARD TAB */}
          {activeTab === 'leaderboard' && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
              <div className="mb-8">
                <h2 className="text-2xl font-display font-bold uppercase text-foreground flex items-center gap-3">
                  <Trophy className="text-primary" /> Leaderboard
                </h2>
                <p className="text-muted-foreground font-mono mt-1 text-sm">Top depositors ranked by total spend</p>
              </div>

              {isLeaderboardLoading ? (
                <div className="flex justify-center py-16">
                  <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                </div>
              ) : !leaderboardRes?.leaderboard.length ? (
                <div className="text-center py-16 font-mono text-muted-foreground text-sm">No deposits yet. Be the first!</div>
              ) : (
                <div className="space-y-2">
                  {leaderboardRes.leaderboard.map((entry) => (
                    <div key={entry.discordId} className={`flex items-center gap-4 p-4 border chamfered transition-all ${
                      entry.rank === 1 ? 'border-yellow-500/40 bg-yellow-500/5' :
                      entry.rank === 2 ? 'border-slate-400/30 bg-slate-400/5' :
                      entry.rank === 3 ? 'border-amber-700/30 bg-amber-700/5' :
                      'border-primary/10 bg-card/30'
                    }`}>
                      <div className={`w-8 h-8 flex items-center justify-center font-display font-bold text-sm chamfered ${
                        entry.rank === 1 ? 'bg-yellow-500 text-black' :
                        entry.rank === 2 ? 'bg-slate-400 text-black' :
                        entry.rank === 3 ? 'bg-amber-700 text-white' :
                        'bg-secondary text-muted-foreground border border-primary/20'
                      }`}>
                        #{entry.rank}
                      </div>
                      {entry.avatar ? (
                        <img src={`https://cdn.discordapp.com/avatars/${entry.discordId}/${entry.avatar}.png`} alt="" className="w-9 h-9 border border-primary/30 chamfered" />
                      ) : (
                        <div className="w-9 h-9 bg-secondary border border-primary/30 chamfered" />
                      )}
                      <div className="flex-1">
                        <p className="font-mono text-sm font-bold text-foreground">{entry.username}</p>
                        <p className="font-mono text-xs text-muted-foreground">{entry.totalHours}h bought</p>
                      </div>
                      <div className="text-right">
                        <p className="font-mono text-sm font-bold text-primary">${entry.totalSpent.toFixed(2)}</p>
                        <p className="font-mono text-xs text-muted-foreground">total spent</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {/* DEPOSIT TAB */}
          {activeTab === 'deposit' && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
              <div className="mb-8 flex items-center justify-between flex-wrap gap-4">
                <div>
                  <h2 className="text-2xl font-display font-bold uppercase text-foreground flex items-center gap-3">
                    <History className="text-primary" /> Deposit History
                  </h2>
                  <p className="text-muted-foreground font-mono mt-1 text-sm">Your transaction history</p>
                </div>
                <Button
                  onClick={() => {
                    const availableSlot = slots.find(s => !s.isActive);
                    if (availableSlot) setPurchasingSlot(availableSlot.slotNumber);
                    else toast({ title: "No slots available", description: "All slots are currently occupied.", variant: "destructive" });
                  }}
                  className="font-mono text-xs uppercase tracking-wider"
                >
                  + Buy a Slot
                </Button>
              </div>

              {isHistoryLoading ? (
                <div className="flex justify-center py-16">
                  <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                </div>
              ) : !historyRes?.payments.length ? (
                <div className="text-center py-16 font-mono text-muted-foreground text-sm">No transactions yet.</div>
              ) : (
                <div className="space-y-2">
                  {historyRes.payments.map(p => (
                    <div key={p.id} className="flex items-center gap-4 p-4 border border-primary/10 bg-card/30 chamfered">
                      <div className={`px-2 py-1 text-xs font-mono font-bold chamfered ${
                        p.status === 'completed' ? 'bg-primary/20 text-primary border border-primary/30' :
                        p.status === 'pending' ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30' :
                        'bg-red-500/20 text-red-400 border border-red-500/30'
                      }`}>
                        {p.status.toUpperCase()}
                      </div>
                      <div className="flex-1">
                        <p className="font-mono text-sm text-foreground">Slot #{p.slotNumber}</p>
                        <p className="font-mono text-xs text-muted-foreground">
                          {p.method === 'stripe' ? 'Card' : `Crypto (${p.currency ?? '?'})`} · {format(new Date(p.createdAt), 'MMM dd, yyyy HH:mm')}
                        </p>
                      </div>
                      {p.amount && (
                        <p className="font-mono text-sm font-bold text-primary">
                          {p.method === 'stripe' ? `$${parseFloat(p.amount).toFixed(2)}` : `${p.amount} ${p.currency ?? ''}`}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}
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
        slotDurationHours={slotDurationHours}
        hourlyPricingEnabled={hourlyPricingEnabled}
        pricePerHour={pricePerHour}
        minHours={minHours}
        onSuccess={() => { refetchSlots(); }}
      />

      <ManageSlotModal
        slot={managingSlot as any}
        onClose={() => setManagingSlot(null)}
        onSuccess={() => { refetchSlots(); }}
      />
    </div>
  );
}
