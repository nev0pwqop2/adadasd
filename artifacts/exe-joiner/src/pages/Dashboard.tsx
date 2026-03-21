import React, { useEffect, useState, useCallback } from 'react';
import { useLocation } from 'wouter';
import { LogOut, LayoutGrid, Settings, Trophy, History, Gavel, Clock, TrendingUp, X, Crown } from 'lucide-react';
import { useGetMe, useLogout } from '@workspace/api-client-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { SlotCard, type PublicSlot } from '@/components/SlotCard';
import { PaymentModal } from '@/components/PaymentModal';
import { ManageSlotModal } from '@/components/ManageSlotModal';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { motion } from 'framer-motion';
import { format } from 'date-fns';

function useCountdown(target: string | null) {
  const [timeLeft, setTimeLeft] = useState<{ h: number; m: number; s: number } | null>(null);
  useEffect(() => {
    if (!target) { setTimeLeft(null); return; }
    const tick = () => {
      const diff = new Date(target).getTime() - Date.now();
      if (diff <= 0) { setTimeLeft({ h: 0, m: 0, s: 0 }); return; }
      const s = Math.floor(diff / 1000) % 60;
      const m = Math.floor(diff / 60000) % 60;
      const h = Math.floor(diff / 3600000);
      setTimeLeft({ h, m, s });
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [target]);
  return timeLeft;
}

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

  const [bidAmount, setBidAmount] = useState('');
  const [showBidForm, setShowBidForm] = useState(false);

  const { data: slotsRes, refetch: refetchSlots, isLoading: isSlotsLoading } = useQuery({
    queryKey: ['slots'],
    queryFn: () => apiFetch<{ slots: PublicSlot[]; totalSlots: number; pricePerDay: number; slotDurationHours: number; hourlyPricingEnabled: boolean; pricePerHour: number; minHours: number; nextExpiresAt: string | null }>('api/slots'),
    enabled: !!user,
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  });

  type BidEntry = { id: number; amount: number; username: string; discordId: string; avatar: string | null; isOwn: boolean; createdAt: string };
  const { data: bidsRes, refetch: refetchBids } = useQuery({
    queryKey: ['bids'],
    queryFn: () => apiFetch<{ bids: BidEntry[]; myBid: { id: number; amount: number; rank: number } | null }>('api/bids'),
    enabled: !!user,
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  });

  const { mutate: placeBid, isPending: isPlacingBid } = useMutation({
    mutationFn: async (amount: number) => {
      const res = await fetch(`${import.meta.env.BASE_URL}api/bids`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.message || 'Failed'); }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: 'Bid placed!', description: 'You are in the queue.', className: 'bg-primary text-primary-foreground border-none' });
      setShowBidForm(false);
      setBidAmount('');
      refetchBids();
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const { mutate: cancelBid, isPending: isCancellingBid } = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${import.meta.env.BASE_URL}api/bids`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    onSuccess: () => {
      toast({ title: 'Bid cancelled', description: 'You have left the queue.' });
      refetchBids();
    },
    onError: () => toast({ title: 'Error', description: 'Could not cancel bid.', variant: 'destructive' }),
  });

  const { data: leaderboardRes, isLoading: isLeaderboardLoading } = useQuery({
    queryKey: ['leaderboard'],
    queryFn: () => apiFetch<{ leaderboard: { rank: number; username: string; discordId: string; avatar: string | null; totalSpent: number; totalHours: number }[] }>('api/slots/leaderboard'),
    enabled: !!user && activeTab === 'leaderboard',
  });

  const { data: historyRes, isLoading: isHistoryLoading, refetch: refetchHistory } = useQuery({
    queryKey: ['history'],
    queryFn: () => apiFetch<{ payments: { id: string; slotNumber: number; method: string; currency: string | null; amount: string | null; status: string; createdAt: string }[] }>('api/slots/history'),
    enabled: !!user && activeTab === 'deposit',
  });

  const { mutate: logoutMutate } = useLogout();

  // Must be called before early returns (Rules of Hooks)
  const countdown = useCountdown(slotsRes?.nextExpiresAt ?? null);

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
  const nextExpiresAt = slotsRes?.nextExpiresAt ?? null;
  const activeCount = slots.filter(s => s.isActive).length;
  const allFull = activeCount >= totalSlots && totalSlots > 0;
  const bids = bidsRes?.bids ?? [];
  const myBid = bidsRes?.myBid ?? null;

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
        <header className="border-b border-border bg-card/90 backdrop-blur-md sticky top-0 z-40">
          <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 shrink-0">
              <img src={`${import.meta.env.BASE_URL}exe-logo.png`} alt="EXE" className="w-7 h-7 drop-shadow-[0_0_8px_rgba(218,165,32,0.4)]" />
              <span className="font-display font-bold text-foreground tracking-tight hidden sm:block">Exe Joiner</span>
            </div>

            <div className="flex items-center gap-3 ml-auto">
              <div className="hidden sm:flex items-center gap-2 text-xs font-mono text-muted-foreground">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-60" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-primary" />
                </span>
                {activeCount}/{totalSlots} active
              </div>

              <div className="h-5 w-px bg-border hidden sm:block" />

              <div className="flex items-center gap-2">
                {user.avatar ? (
                  <img src={`https://cdn.discordapp.com/avatars/${user.discordId}/${user.avatar}.png`} alt="Avatar" className="w-7 h-7 rounded-full border border-border" />
                ) : (
                  <div className="w-7 h-7 rounded-full bg-secondary border border-border" />
                )}
                <span className="font-mono text-sm hidden md:block text-foreground">{user.username}</span>
              </div>

              {user.isAdmin && (
                <Button variant="outline" size="sm" onClick={() => setLocation('/admin')} className="border-primary/30 text-primary hover:bg-primary/10 text-xs h-8">
                  <Settings className="w-3.5 h-3.5 sm:mr-1.5" />
                  <span className="hidden sm:inline">Admin</span>
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={handleLogout} className="border-border text-muted-foreground hover:text-foreground text-xs h-8">
                <LogOut className="w-3.5 h-3.5 sm:mr-1.5" />
                <span className="hidden sm:inline">Logout</span>
              </Button>
            </div>
          </div>
        </header>

        {/* Tab bar */}
        <div className="border-b border-border bg-card/60 backdrop-blur-sm sticky top-14 z-30">
          <div className="max-w-7xl mx-auto px-4 flex gap-0">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-5 py-3 font-mono text-xs tracking-wide transition-all border-b-2 ${
                  activeTab === tab.id
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
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
              <div className="mb-6">
                <h2 className="text-xl font-display font-bold text-foreground flex items-center gap-2.5">
                  <LayoutGrid className="w-5 h-5 text-primary" /> Slots
                </h2>
                <p className="text-muted-foreground font-mono mt-1 text-sm">
                  {hourlyPricingEnabled ? (
                    <><span className="text-primary">${pricePerHour.toFixed(2)}/hr</span> · min {minHours}h per slot</>
                  ) : (
                    <><span className="text-primary">${pricePerDay.toFixed(2)}</span> / {slotDurationHours}h per slot</>
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

              {/* QUEUE / BID SECTION — visible when all slots are full */}
              {allFull && (
                <motion.div
                  initial={{ opacity: 0, y: 30 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  className="mt-10"
                >
                  <div className="border border-primary/20 bg-primary/5 rounded-xl overflow-hidden">
                    {/* Header */}
                    <div className="border-b border-primary/15 p-5 flex flex-col sm:flex-row sm:items-center gap-4">
                      <div className="flex-1">
                        <h3 className="font-display font-bold text-primary flex items-center gap-2 text-base">
                          <Gavel className="w-4 h-4" /> Slot Queue
                        </h3>
                        <p className="font-mono text-xs text-muted-foreground mt-1">All slots occupied — highest bid gets the next free slot.</p>
                      </div>
                      {countdown && (
                        <div className="flex items-center gap-3 border border-primary/20 bg-background/50 px-4 py-2.5 rounded-lg shrink-0">
                          <Clock className="w-4 h-4 text-primary" />
                          <div>
                            <p className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Next slot in</p>
                            <div className="flex items-center font-display font-bold text-primary text-lg tabular-nums">
                              <span>{String(countdown.h).padStart(2, '0')}</span>
                              <span className="opacity-50 mx-0.5">:</span>
                              <span>{String(countdown.m).padStart(2, '0')}</span>
                              <span className="opacity-50 mx-0.5">:</span>
                              <span>{String(countdown.s).padStart(2, '0')}</span>
                            </div>
                          </div>
                        </div>
                      )}
                      {!countdown && !nextExpiresAt && (
                        <div className="flex items-center gap-2 border border-border px-3 py-2 rounded-lg text-muted-foreground font-mono text-xs">
                          <Clock className="w-3.5 h-3.5" /> Expiry unknown
                        </div>
                      )}
                    </div>

                    <div className="p-5 grid grid-cols-1 lg:grid-cols-2 gap-6">
                      {/* Your bid panel */}
                      <div>
                        <h4 className="font-mono text-xs uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-2">
                          <TrendingUp className="w-3.5 h-3.5" /> Your Bid
                        </h4>

                        {myBid && !showBidForm ? (
                          <div className="border border-primary/30 bg-primary/8 rounded-lg p-4">
                            <div className="flex items-center justify-between mb-3">
                              <div>
                                <p className="font-display font-bold text-primary text-2xl">${myBid.amount.toFixed(2)}</p>
                                <p className="font-mono text-xs text-muted-foreground mt-1">
                                  {myBid.rank === 1
                                    ? '🏆 Top bidder!'
                                    : `Rank #${myBid.rank} — outbid by $${(bids[0]?.amount - myBid.amount).toFixed(2)}`}
                                </p>
                              </div>
                              <span className={`font-mono text-xs px-2.5 py-1 rounded-full border ${myBid.rank === 1 ? 'border-primary/40 text-primary bg-primary/10' : 'border-orange-500/30 text-orange-400 bg-orange-500/10'}`}>
                                #{myBid.rank}
                              </span>
                            </div>
                            <div className="flex gap-2">
                              <Button size="sm" variant="outline" className="border-primary/30 text-primary text-xs flex-1" onClick={() => { setBidAmount(String(myBid.amount)); setShowBidForm(true); }}>
                                Raise Bid
                              </Button>
                              <Button size="sm" variant="outline" className="border-red-500/25 text-red-400 text-xs" disabled={isCancellingBid} onClick={() => cancelBid()}>
                                <X className="w-3 h-3 mr-1" /> Cancel
                              </Button>
                            </div>
                          </div>
                        ) : showBidForm ? (
                          <div className="border border-primary/25 p-4 rounded-lg space-y-3">
                            <p className="font-mono text-xs text-muted-foreground">
                              {myBid ? `Current bid: $${myBid.amount.toFixed(2)}. Enter a higher amount.` : 'Enter your max bid in USD. Highest bidder gets first pick on the next open slot.'}
                            </p>
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-muted-foreground text-sm">$</span>
                              <input
                                type="number"
                                min={myBid ? myBid.amount + 0.01 : 0.01}
                                step={0.01}
                                value={bidAmount}
                                onChange={e => setBidAmount(e.target.value)}
                                placeholder={myBid ? (myBid.amount + 1).toFixed(2) : '0.00'}
                                className="flex-1 bg-background border border-border rounded text-foreground font-mono px-3 py-2 text-sm focus:outline-none focus:border-primary/60"
                                autoFocus
                              />
                            </div>
                            <div className="flex gap-2">
                              <Button size="sm" className="flex-1 text-xs" disabled={isPlacingBid || !bidAmount || parseFloat(bidAmount) <= (myBid?.amount ?? 0)} onClick={() => placeBid(parseFloat(bidAmount))}>
                                {isPlacingBid ? (myBid ? 'Updating…' : 'Placing…') : (myBid ? 'Update Bid' : 'Place Bid')}
                              </Button>
                              <Button size="sm" variant="outline" className="border-border text-xs" onClick={() => { setShowBidForm(false); setBidAmount(''); }}>
                                Cancel
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="border border-border p-4 rounded-lg text-center">
                            <p className="font-mono text-xs text-muted-foreground mb-3">No active bid. Place one to join the queue.</p>
                            <Button size="sm" onClick={() => setShowBidForm(true)} className="text-xs w-full">
                              <Gavel className="w-3 h-3 mr-2" /> Place a Bid
                            </Button>
                          </div>
                        )}
                      </div>

                      {/* Bid leaderboard */}
                      <div>
                        <h4 className="font-mono text-xs uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-2">
                          <Crown className="w-3.5 h-3.5" /> Bid Queue ({bids.length})
                        </h4>
                        {bids.length === 0 ? (
                          <div className="border border-border p-4 rounded-lg text-center font-mono text-xs text-muted-foreground">
                            No bids yet — be the first!
                          </div>
                        ) : (
                          <div className="space-y-1.5 max-h-64 overflow-y-auto">
                            {bids.map((b, i) => (
                              <div
                                key={b.id}
                                className={`flex items-center gap-3 p-2.5 rounded-lg border ${b.isOwn ? 'border-primary/30 bg-primary/8' : 'border-border bg-card/40'}`}
                              >
                                <span className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-xs shrink-0 ${i === 0 ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}`}>
                                  {i + 1}
                                </span>
                                {b.avatar ? (
                                  <img src={`https://cdn.discordapp.com/avatars/${b.discordId}/${b.avatar}.png`} alt="" className="w-6 h-6 rounded-full border border-border shrink-0" />
                                ) : (
                                  <div className="w-6 h-6 rounded-full bg-secondary border border-border shrink-0" />
                                )}
                                <span className={`font-mono text-xs flex-1 truncate ${b.isOwn ? 'text-primary font-semibold' : 'text-foreground'}`}>
                                  {b.username}{b.isOwn ? ' (you)' : ''}
                                </span>
                                <span className="font-mono text-sm font-bold text-primary shrink-0">${b.amount.toFixed(2)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </>
          )}

          {/* LEADERBOARD TAB */}
          {activeTab === 'leaderboard' && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
              <div className="mb-6">
                <h2 className="text-xl font-display font-bold text-foreground flex items-center gap-2.5">
                  <Trophy className="w-5 h-5 text-primary" /> Leaderboard
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
                    <div key={entry.discordId} className={`flex items-center gap-4 p-4 border rounded-xl transition-all ${
                      entry.rank === 1 ? 'border-yellow-500/30 bg-yellow-500/5' :
                      entry.rank === 2 ? 'border-slate-400/20 bg-slate-400/5' :
                      entry.rank === 3 ? 'border-amber-700/25 bg-amber-700/5' :
                      'border-border bg-card/30'
                    }`}>
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shrink-0 ${
                        entry.rank === 1 ? 'bg-yellow-500 text-black' :
                        entry.rank === 2 ? 'bg-slate-400 text-black' :
                        entry.rank === 3 ? 'bg-amber-700 text-white' :
                        'bg-secondary text-muted-foreground'
                      }`}>
                        {entry.rank}
                      </div>
                      {entry.avatar ? (
                        <img src={`https://cdn.discordapp.com/avatars/${entry.discordId}/${entry.avatar}.png`} alt="" className="w-9 h-9 rounded-full border border-border" />
                      ) : (
                        <div className="w-9 h-9 rounded-full bg-secondary border border-border" />
                      )}
                      <div className="flex-1">
                        <p className="font-mono text-sm font-semibold text-foreground">{entry.username}</p>
                        <p className="font-mono text-xs text-muted-foreground">{entry.totalHours}h purchased</p>
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
              <div className="mb-6 flex items-center justify-between flex-wrap gap-4">
                <div>
                  <h2 className="text-xl font-display font-bold text-foreground flex items-center gap-2.5">
                    <History className="w-5 h-5 text-primary" /> Deposit History
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
                    <div key={p.id} className="flex items-center gap-4 p-4 border border-border bg-card/30 rounded-xl">
                      <div className={`px-2.5 py-1 text-[10px] font-mono font-bold rounded-full ${
                        p.status === 'completed' ? 'bg-primary/15 text-primary' :
                        p.status === 'pending' ? 'bg-yellow-500/15 text-yellow-400' :
                        'bg-red-500/15 text-red-400'
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

        <footer className="border-t border-border bg-card/30 py-5 mt-auto">
          <div className="max-w-7xl mx-auto px-4 text-center text-xs font-mono text-muted-foreground/50">
            Exe Joiner · All rights reserved
          </div>
        </footer>
      </div>

      <PaymentModal
        isOpen={purchasingSlot !== null}
        onClose={() => { setPurchasingSlot(null); refetchHistory(); }}
        slotNumber={purchasingSlot || 1}
        pricePerDay={pricePerDay}
        slotDurationHours={slotDurationHours}
        hourlyPricingEnabled={hourlyPricingEnabled}
        pricePerHour={pricePerHour}
        minHours={minHours}
        onSuccess={() => { refetchSlots(); refetchHistory(); }}
      />

      <ManageSlotModal
        slot={managingSlot as any}
        onClose={() => setManagingSlot(null)}
        onSuccess={() => { refetchSlots(); }}
      />
    </div>
  );
}
