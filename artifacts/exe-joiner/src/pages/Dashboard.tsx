import React, { useEffect, useState, useCallback } from 'react';
import { useLocation } from 'wouter';
import { LogOut, LayoutGrid, Settings, Trophy, History, Gavel, Clock, TrendingUp, X, Crown, CalendarClock, Wallet, Plus } from 'lucide-react';
import { useGetMe, useLogout } from '@workspace/api-client-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { SlotCard, type PublicSlot } from '@/components/SlotCard';
import { PaymentModal } from '@/components/PaymentModal';
import { ManageSlotModal } from '@/components/ManageSlotModal';
import { PreorderModal } from '@/components/PreorderModal';
import { DepositModal } from '@/components/DepositModal';
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

  const { data: user, isError: isUserError, isLoading: isUserLoading } = useGetMe({ query: { retry: false } as any });

  const [bidAmount, setBidAmount] = useState('');
  const [showBidForm, setShowBidForm] = useState(false);
  const [showPreorderModal, setShowPreorderModal] = useState(false);
  const [showDepositModal, setShowDepositModal] = useState(false);

  const { data: slotsRes, refetch: refetchSlots, isLoading: isSlotsLoading } = useQuery({
    queryKey: ['slots'],
    queryFn: () => apiFetch<{ slots: PublicSlot[]; totalSlots: number; pricePerDay: number; slotDurationHours: number; hourlyPricingEnabled: boolean; pricePerHour: number; minHours: number; nextExpiresAt: string | null }>('api/slots'),
    enabled: !!user,
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  });

  type BidEntry = { id: number; amount: number; username: string; discordId: string; avatar: string | null; isOwn: boolean; paidWithBalance: boolean; createdAt: string };
  const { data: bidsRes, refetch: refetchBids } = useQuery({
    queryKey: ['bids'],
    queryFn: () => apiFetch<{ bids: BidEntry[]; myBid: { id: number; amount: number; rank: number; paidWithBalance: boolean } | null; topPreorderAmount: number | null }>('api/bids'),
    enabled: !!user,
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  });

  const { mutate: placeBid, isPending: isPlacingBid } = useMutation({
    mutationFn: async ({ amount }: { amount: number }) => {
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
      toast({ title: 'Bid placed!', description: 'Balance held — you are in the queue.', className: 'bg-primary text-primary-foreground border-none' });
      setShowBidForm(false);
      setBidAmount('');
      refetchBids();
      refetchBalance();
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
      refetchBalance();
    },
    onError: () => toast({ title: 'Error', description: 'Could not cancel bid.', variant: 'destructive' }),
  });

  type PreorderEntry = { id: number; rank: number; amount: number; currency: string | null; isOwn: boolean; username: string; discordId: string; avatar: string | null; createdAt: string };
  const { data: preordersRes, refetch: refetchPreorders } = useQuery({
    queryKey: ['preorders'],
    queryFn: () => apiFetch<{ queue: PreorderEntry[]; myPreorder: PreorderEntry | null }>('api/preorders'),
    enabled: !!user,
    refetchInterval: 10000,
    refetchIntervalInBackground: false,
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

  const { data: balanceRes, refetch: refetchBalance } = useQuery({
    queryKey: ['balance'],
    queryFn: () => apiFetch<{ balance: string; balanceNum: number }>('api/balance'),
    enabled: !!user,
    refetchInterval: 10000,
    refetchIntervalInBackground: false,
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
    } else if (params.get('preorder') === 'success') {
      toast({ title: "Pre-order Placed!", description: "You'll automatically get the next slot when one opens.", className: "bg-primary text-primary-foreground border-none" });
      window.history.replaceState({}, document.title, window.location.pathname);
      refetchPreorders();
    } else if (params.get('preorder') === 'cancelled') {
      toast({ title: "Pre-order Cancelled", description: "No charge was made.", variant: "destructive" });
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (params.get('deposit') === 'success') {
      toast({ title: "Funds Added!", description: "Your balance has been credited.", className: "bg-primary text-primary-foreground border-none" });
      window.history.replaceState({}, document.title, window.location.pathname);
      refetchBalance();
      setActiveTab('deposit');
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
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
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
  const preorderQueue = preordersRes?.queue ?? [];
  const myPreorder = preordersRes?.myPreorder ?? null;
  const userBalance = balanceRes?.balanceNum ?? 0;

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'slots', label: 'Slots', icon: <LayoutGrid className="w-4 h-4" /> },
    { id: 'leaderboard', label: 'Leaderboard', icon: <Trophy className="w-4 h-4" /> },
    { id: 'deposit', label: 'Deposits', icon: <Wallet className="w-4 h-4" /> },
  ];

  return (
    <div className="min-h-screen bg-background relative overflow-x-hidden">
      <div className="flex flex-col min-h-screen">
        <header className="border-b border-border/50 bg-background/90 backdrop-blur-md sticky top-0 z-40">
          <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2.5 shrink-0">
              <img src={`${import.meta.env.BASE_URL}exe-logo.png`} alt="EXE" className="w-6 h-6" />
              <span className="font-display font-bold text-sm text-foreground hidden sm:block">Exe Joiner</span>
            </div>

            <div className="flex items-center gap-2">
              <div className="hidden sm:flex items-center gap-1.5 text-xs font-mono text-muted-foreground mr-1">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-50" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-primary" />
                </span>
                {activeCount}/{totalSlots}
              </div>

              {user.isAdmin && (
                <Button variant="ghost" size="sm" onClick={() => setLocation('/admin')} className="text-muted-foreground hover:text-foreground text-xs h-8 px-2.5">
                  <Settings className="w-3.5 h-3.5" />
                </Button>
              )}

              <div className="flex items-center gap-2 border border-border/50 rounded-lg px-2.5 py-1.5">
                {user.avatar ? (
                  <img src={`https://cdn.discordapp.com/avatars/${user.discordId}/${user.avatar}.png`} alt="Avatar" className="w-5 h-5 rounded-full" />
                ) : (
                  <div className="w-5 h-5 rounded-full bg-secondary" />
                )}
                <span className="font-mono text-xs text-muted-foreground hidden sm:block">{user.username}</span>
              </div>

              <Button variant="ghost" size="sm" onClick={handleLogout} className="text-muted-foreground hover:text-foreground h-8 px-2.5">
                <LogOut className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        </header>

        {/* Tab bar */}
        <div className="border-b border-border/40 sticky top-14 z-30 bg-background/80 backdrop-blur-md">
          <div className="max-w-7xl mx-auto px-4 py-2.5 flex gap-1">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-1.5 rounded-full font-mono text-xs tracking-wide transition-all ${
                  activeTab === tab.id
                    ? 'bg-primary/15 text-primary border border-primary/30'
                    : 'text-muted-foreground hover:text-foreground hover:bg-white/5 border border-transparent'
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
              <div className="mb-6 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-display font-bold text-foreground">Slots</h2>
                  <p className="text-muted-foreground font-mono text-xs mt-0.5">
                    {hourlyPricingEnabled
                      ? <><span className="text-primary">${pricePerHour.toFixed(2)}/hr</span> · min {minHours}h</>
                      : <><span className="text-primary">${pricePerDay.toFixed(2)}</span> for {slotDurationHours}h</>}
                  </p>
                </div>
                <span className="font-mono text-xs text-muted-foreground/50">{activeCount}/{totalSlots} active</span>
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
                            <p className="font-mono text-xs text-primary/70 mb-3">${myBid.amount.toFixed(2)} held from balance · cancelling will refund it</p>
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
                              {myBid ? `Current bid: $${myBid.amount.toFixed(2)}. Enter a higher amount.` : 'Bids are paid from your balance. Highest bidder wins the next open slot.'}
                            </p>
                            {bidsRes?.topPreorderAmount != null && (
                              <p className="font-mono text-xs text-amber-400">
                                Highest pre-order: <span className="font-bold">${bidsRes.topPreorderAmount.toFixed(2)}</span> — your bid must exceed this to get priority.
                              </p>
                            )}
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-muted-foreground text-sm">$</span>
                              <input
                                type="number"
                                min={Math.max(myBid?.amount ?? 0, bidsRes?.topPreorderAmount ?? 0) + 0.01}
                                max={balanceRes?.balanceNum ?? 0}
                                step={0.01}
                                value={bidAmount}
                                onChange={e => setBidAmount(e.target.value)}
                                placeholder={bidsRes?.topPreorderAmount != null
                                  ? (bidsRes.topPreorderAmount + 1).toFixed(2)
                                  : myBid ? (myBid.amount + 1).toFixed(2) : '0.00'}
                                className="flex-1 bg-background border border-border rounded text-foreground font-mono px-3 py-2 text-sm focus:outline-none focus:border-primary/60"
                                autoFocus
                              />
                            </div>
                            <div className="w-full flex items-center justify-between px-3 py-2 rounded-lg border border-primary/20 bg-primary/5 text-xs font-mono">
                              <span className="text-muted-foreground">Balance available</span>
                              <span className="text-primary font-bold">${(balanceRes?.balanceNum ?? 0).toFixed(2)}</span>
                            </div>
                            {bidAmount && parseFloat(bidAmount) > (balanceRes?.balanceNum ?? 0) + (myBid?.amount ?? 0) && (
                              <p className="font-mono text-xs text-red-400">Insufficient balance for this bid amount.</p>
                            )}
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                className="flex-1 text-xs"
                                disabled={
                                  isPlacingBid ||
                                  !bidAmount ||
                                  parseFloat(bidAmount) <= (myBid?.amount ?? 0) ||
                                  (bidsRes?.topPreorderAmount != null && parseFloat(bidAmount) <= bidsRes.topPreorderAmount) ||
                                  parseFloat(bidAmount) > (balanceRes?.balanceNum ?? 0) + (myBid?.amount ?? 0)
                                }
                                onClick={() => placeBid({ amount: parseFloat(bidAmount) })}
                              >
                                {isPlacingBid ? (myBid ? 'Updating…' : 'Placing…') : (myBid ? 'Raise Bid' : 'Place Bid')}
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

              {/* PRE-ORDER SECTION — visible when all slots are full */}
              {allFull && (
                <motion.div
                  initial={{ opacity: 0, y: 30 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                  className="mt-5"
                >
                  <div className="border border-border rounded-xl overflow-hidden">
                    <div className="border-b border-border/60 p-5 flex flex-col sm:flex-row sm:items-center gap-4">
                      <div className="flex-1">
                        <h3 className="font-display font-bold text-foreground flex items-center gap-2 text-base">
                          <CalendarClock className="w-4 h-4 text-primary" /> Pre-order Next Slot
                        </h3>
                        <p className="font-mono text-xs text-muted-foreground mt-1">
                          Pay now · get a full {slotDurationHours}h slot automatically when the next one opens
                          {nextExpiresAt && countdown ? ` in ${String(countdown.h).padStart(2,'0')}:${String(countdown.m).padStart(2,'0')}:${String(countdown.s).padStart(2,'0')}` : ''}
                        </p>
                      </div>
                      {!myPreorder && (
                        <Button
                          size="sm"
                          className="text-xs shrink-0"
                          onClick={() => setShowPreorderModal(true)}
                        >
                          <CalendarClock className="w-3.5 h-3.5 mr-1.5" />
                          Pre-order — ${pricePerDay.toFixed(2)}
                        </Button>
                      )}
                    </div>

                    <div className="p-5 grid grid-cols-1 lg:grid-cols-2 gap-6">
                      {/* My pre-order status */}
                      <div>
                        <h4 className="font-mono text-xs uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-2">
                          <CalendarClock className="w-3.5 h-3.5" /> Your Pre-order
                        </h4>
                        {myPreorder ? (
                          <div className="border border-primary/30 bg-primary/8 rounded-xl p-4">
                            <div className="flex items-center justify-between mb-3">
                              <div>
                                <p className="font-display font-bold text-primary text-2xl">${myPreorder.amount.toFixed(2)}</p>
                                <p className="font-mono text-xs text-muted-foreground mt-1">
                                  {myPreorder.rank === 1 ? '🏆 First in queue — you get the next slot!' : `Rank #${myPreorder.rank} in pre-order queue`}
                                </p>
                              </div>
                              <span className="font-mono text-xs px-2.5 py-1 rounded-full border border-primary/40 text-primary bg-primary/10">
                                #{myPreorder.rank}
                              </span>
                            </div>
                          </div>
                        ) : (
                          <div className="border border-border p-4 rounded-xl text-center">
                            <p className="font-mono text-xs text-muted-foreground mb-3">No pre-order placed. Reserve your spot now.</p>
                            <Button size="sm" className="text-xs w-full" onClick={() => setShowPreorderModal(true)}>
                              <CalendarClock className="w-3 h-3 mr-2" /> Pre-order — ${pricePerDay.toFixed(2)}
                            </Button>
                          </div>
                        )}
                      </div>

                      {/* Pre-order queue */}
                      <div>
                        <h4 className="font-mono text-xs uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-2">
                          <Crown className="w-3.5 h-3.5" /> Pre-order Queue ({preorderQueue.length})
                        </h4>
                        {preorderQueue.length === 0 ? (
                          <div className="border border-border p-4 rounded-xl text-center font-mono text-xs text-muted-foreground">
                            No pre-orders yet — be first in line!
                          </div>
                        ) : (
                          <div className="space-y-1.5 max-h-64 overflow-y-auto">
                            {preorderQueue.map((p, i) => (
                              <div
                                key={p.id}
                                className={`flex items-center gap-3 p-2.5 rounded-lg border ${p.isOwn ? 'border-primary/30 bg-primary/8' : 'border-border bg-card/40'}`}
                              >
                                <span className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-xs shrink-0 ${i === 0 ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}`}>
                                  {i + 1}
                                </span>
                                {p.avatar ? (
                                  <img src={`https://cdn.discordapp.com/avatars/${p.discordId}/${p.avatar}.png`} alt="" className="w-6 h-6 rounded-full border border-border shrink-0" />
                                ) : (
                                  <div className="w-6 h-6 rounded-full bg-secondary border border-border shrink-0" />
                                )}
                                <span className={`font-mono text-xs flex-1 truncate ${p.isOwn ? 'text-primary font-semibold' : 'text-foreground'}`}>
                                  {p.username}{p.isOwn ? ' (you)' : ''}
                                </span>
                                <span className="font-mono text-sm font-bold text-primary shrink-0">${p.amount.toFixed(2)}</span>
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
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
              {/* Balance card */}
              <div className="relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-6">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Wallet className="w-4 h-4 text-primary" />
                      <p className="font-mono text-xs text-muted-foreground uppercase tracking-wider">Account Balance</p>
                    </div>
                    <p className="font-display font-bold text-4xl text-foreground">
                      <span className="text-primary">$</span>{userBalance.toFixed(2)}
                    </p>
                    <p className="font-mono text-xs text-muted-foreground mt-1.5">Available to spend on slots</p>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Button onClick={() => setShowDepositModal(true)} className="font-mono text-xs uppercase tracking-wider">
                      <Plus className="w-3.5 h-3.5 mr-1.5" /> Add Funds
                    </Button>
                    {userBalance >= pricePerDay && (
                      <Button
                        variant="outline"
                        onClick={() => {
                          const availableSlot = slots.find(s => !s.isActive);
                          if (availableSlot) setPurchasingSlot(availableSlot.slotNumber);
                          else toast({ title: "No slots available", description: "All slots are currently occupied.", variant: "destructive" });
                        }}
                        className="font-mono text-xs uppercase tracking-wider"
                      >
                        Buy a Slot
                      </Button>
                    )}
                  </div>
                </div>
                <div className="absolute -right-8 -bottom-8 w-32 h-32 bg-primary/5 rounded-full blur-2xl pointer-events-none" />
              </div>

              {/* Transaction history */}
              <div>
                <h2 className="text-base font-display font-bold text-foreground flex items-center gap-2 mb-4">
                  <History className="w-4 h-4 text-primary" /> Transaction History
                </h2>

                {isHistoryLoading ? (
                  <div className="flex justify-center py-16">
                    <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : !historyRes?.payments.length ? (
                  <div className="text-center py-16 font-mono text-muted-foreground text-sm">No transactions yet.</div>
                ) : (
                  <div className="space-y-2">
                    {historyRes.payments.map(p => {
                      const isDeposit = p.method === 'balance-deposit-stripe' || p.method === 'balance-deposit-crypto';
                      const isBalancePay = p.method === 'balance';
                      const methodLabel = p.method === 'stripe' ? 'Card'
                        : p.method === 'balance' ? 'Balance'
                        : p.method === 'balance-deposit-stripe' ? 'Balance Deposit (Card)'
                        : p.method === 'balance-deposit-crypto' ? `Balance Deposit (Crypto${p.currency ? ` · ${p.currency}` : ''})`
                        : p.method === 'preorder-stripe' ? 'Pre-order (Card)'
                        : p.method === 'preorder-crypto' ? `Pre-order (Crypto${p.currency ? ` · ${p.currency}` : ''})`
                        : `Crypto${p.currency ? ` · ${p.currency}` : ''}`;
                      return (
                        <div key={p.id} className="flex items-center gap-4 p-4 border border-border bg-card/30 rounded-xl">
                          <div className={`px-2.5 py-1 text-[10px] font-mono font-bold rounded-full ${
                            p.status === 'completed' ? 'bg-primary/15 text-primary' :
                            p.status === 'pending' ? 'bg-yellow-500/15 text-yellow-400' :
                            'bg-red-500/15 text-red-400'
                          }`}>
                            {p.status.toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-mono text-sm text-foreground">
                              {isDeposit ? 'Balance Deposit' : isBalancePay ? `Slot #${p.slotNumber}` : `Slot #${p.slotNumber}`}
                            </p>
                            <p className="font-mono text-xs text-muted-foreground truncate">
                              {methodLabel} · {format(new Date(p.createdAt), 'MMM dd, yyyy HH:mm')}
                            </p>
                          </div>
                          {p.amount && (
                            <p className={`font-mono text-sm font-bold shrink-0 ${isDeposit ? 'text-green-400' : 'text-primary'}`}>
                              {isDeposit ? '+' : ''}{p.method === 'crypto' ? `${p.amount} ${p.currency ?? ''}` : `$${parseFloat(p.amount).toFixed(2)}`}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </main>

        <footer className="border-t border-border/40 py-5 mt-auto">
          <div className="max-w-7xl mx-auto px-4 text-center text-xs font-mono text-muted-foreground/40">
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
        userBalance={userBalance}
        onSuccess={() => { refetchSlots(); refetchHistory(); refetchBalance(); }}
      />

      <DepositModal
        isOpen={showDepositModal}
        onClose={() => setShowDepositModal(false)}
        onSuccess={() => { refetchBalance(); refetchHistory(); }}
      />

      <ManageSlotModal
        slot={managingSlot as any}
        onClose={() => setManagingSlot(null)}
        onSuccess={() => { refetchSlots(); }}
      />

      <PreorderModal
        isOpen={showPreorderModal}
        onClose={() => { setShowPreorderModal(false); refetchPreorders(); }}
        pricePerDay={pricePerDay}
        slotDurationHours={slotDurationHours}
        nextExpiresAt={nextExpiresAt}
        onSuccess={() => { refetchPreorders(); refetchBalance(); }}
        balance={balanceRes?.balanceNum ?? 0}
        hourlyPricingEnabled={slotsRes?.hourlyPricingEnabled ?? false}
        pricePerHour={slotsRes?.pricePerHour ?? 5}
        minHours={slotsRes?.minHours ?? 2}
      />
    </div>
  );
}
