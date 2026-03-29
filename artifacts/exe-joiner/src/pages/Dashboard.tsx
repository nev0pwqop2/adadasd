import React, { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import Navbar from '@/components/Navbar';
import { LogOut, LayoutGrid, Trophy, History, Settings, TrendingUp, X, Crown, Gavel, Plus, Wallet } from 'lucide-react';
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
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.message || 'Failed'); }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: 'Bid placed!', description: 'Balance held — you are in the queue.', className: 'bg-primary text-primary-foreground border-none' });
      setShowBidForm(false); setBidAmount(''); refetchBids(); refetchBalance();
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
      refetchBids(); refetchBalance();
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

  const { data: historyRes, isLoading: isHistoryLoading } = useQuery({
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

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('payment') === 'success') {
      toast({ title: 'Payment Successful', description: 'Your slot has been activated.', className: 'bg-primary text-primary-foreground border-none' });
      window.history.replaceState({}, document.title, window.location.pathname);
      refetchSlots();
    } else if (params.get('payment') === 'cancelled') {
      toast({ title: 'Payment Cancelled', description: 'The transaction was aborted.', variant: 'destructive' });
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (params.get('preorder') === 'success') {
      toast({ title: 'Pre-order Placed!', description: "You'll automatically get the next slot when one opens.", className: 'bg-primary text-primary-foreground border-none' });
      window.history.replaceState({}, document.title, window.location.pathname);
      refetchPreorders();
    } else if (params.get('preorder') === 'cancelled') {
      toast({ title: 'Pre-order Cancelled', description: 'No charge was made.', variant: 'destructive' });
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (params.get('deposit') === 'success') {
      toast({ title: 'Funds Added!', description: 'Your balance has been credited.', className: 'bg-primary text-primary-foreground border-none' });
      window.history.replaceState({}, document.title, window.location.pathname);
      refetchBalance(); setActiveTab('deposit');
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
      <div className="min-h-screen bg-[#0a0a0c] flex items-center justify-center">
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
  const slotFillPct = totalSlots > 0 ? Math.round((activeCount / totalSlots) * 100) : 0;

  const navItems: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'slots',       label: 'Slots',       icon: <LayoutGrid className="w-5 h-5" /> },
    { id: 'leaderboard', label: 'Ranks',       icon: <Trophy className="w-5 h-5" /> },
    { id: 'deposit',     label: 'History',     icon: <History className="w-5 h-5" /> },
  ];

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[#0a0a0c]">

      <Navbar current="dashboard" />

      <div className="flex flex-1 overflow-hidden">

      {/* ── Sidebar (desktop only) ─────────────────────────────────────── */}
      <aside className="hidden md:flex w-48 flex-shrink-0 flex-col border-r border-white/6 bg-[#0f0f13] overflow-y-auto">
        <div className="px-4 py-4 border-b border-white/6">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-primary/15 border border-primary/20 flex items-center justify-center">
              <img src={`${import.meta.env.BASE_URL}exe-logo.png`} alt="EXE" className="w-5 h-5 object-contain" />
            </div>
            <span className="font-bold text-sm text-white tracking-tight">Exe Joiner</span>
          </div>
        </div>

        <div className="px-4 py-4 border-b border-white/6">
          <div className="flex items-center gap-2.5 mb-3">
            {user.avatar ? (
              <img src={`https://cdn.discordapp.com/avatars/${user.discordId}/${user.avatar}.png`} alt="Avatar" className="w-8 h-8 rounded-full border border-white/10 flex-shrink-0" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-primary/20 border border-primary/25 flex items-center justify-center flex-shrink-0">
                <span className="text-primary text-xs font-bold">{user.username?.[0]?.toUpperCase()}</span>
              </div>
            )}
            <div className="min-w-0">
              <p className="text-xs font-semibold text-white/90 truncate">{user.username}</p>
              <p className="text-xs font-mono text-primary">${userBalance.toFixed(2)}</p>
            </div>
          </div>
          <button
            onClick={() => setShowDepositModal(true)}
            className="w-full flex items-center justify-center gap-1.5 h-7 rounded-lg bg-primary/10 border border-primary/20 text-primary text-xs font-medium hover:bg-primary/18 transition-colors"
          >
            <Plus className="w-3 h-3" /> Add Funds
          </button>
        </div>

        <div className="px-4 py-4 border-b border-white/6">
          <p className="text-[10px] font-mono uppercase tracking-widest text-white/30 mb-2.5">Slots</p>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-white/50">Active</span>
            <span className="text-xs font-mono text-white/80 tabular-nums">{activeCount}/{totalSlots}</span>
          </div>
          <div className="h-1 rounded-full bg-white/8 overflow-hidden">
            <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${slotFillPct}%` }} />
          </div>
        </div>

        <nav className="flex-1 p-2 pt-3">
          {navItems.map(item => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium mb-0.5 transition-all ${
                activeTab === item.id
                  ? 'bg-primary/12 text-primary border border-primary/15'
                  : 'text-white/40 hover:text-white/80 hover:bg-white/5 border border-transparent'
              }`}
            >
              {item.icon}
              {item.label}
              {activeTab === item.id && <span className="ml-auto w-1 h-1 rounded-full bg-primary" />}
            </button>
          ))}
          {user.isAdmin && (
            <button
              onClick={() => setLocation('/admin')}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium mb-0.5 text-white/40 hover:text-white/80 hover:bg-white/5 border border-transparent transition-all mt-1"
            >
              <Settings className="w-4 h-4" /> Admin
            </button>
          )}
        </nav>

        <div className="p-3 border-t border-white/6">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-white/30 hover:text-white/70 hover:bg-white/5 transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" /> Logout
          </button>
        </div>
      </aside>

      {/* ── Mobile top header ──────────────────────────────────────────── */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-30 bg-[#0f0f13] border-b border-white/6 flex items-center justify-between px-4 h-14">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-primary/15 border border-primary/20 flex items-center justify-center">
            <img src={`${import.meta.env.BASE_URL}exe-logo.png`} alt="EXE" className="w-5 h-5 object-contain" />
          </div>
          <span className="font-bold text-sm text-white tracking-tight">Exe Joiner</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowDepositModal(true)}
            className="flex items-center gap-1 h-7 px-2.5 rounded-lg bg-primary/10 border border-primary/20 text-primary text-xs font-medium"
          >
            <span className="font-mono">${userBalance.toFixed(2)}</span>
            <Plus className="w-3 h-3" />
          </button>
          {user.avatar ? (
            <img src={`https://cdn.discordapp.com/avatars/${user.discordId}/${user.avatar}.png`} alt="Avatar" className="w-7 h-7 rounded-full border border-white/10" />
          ) : (
            <div className="w-7 h-7 rounded-full bg-primary/20 border border-primary/25 flex items-center justify-center">
              <span className="text-primary text-xs font-bold">{user.username?.[0]?.toUpperCase()}</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Main Content ──────────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto pt-14 md:pt-0 pb-20 md:pb-0">
        <div className="max-w-6xl mx-auto px-4 md:px-6 py-5 md:py-8">

          {/* ── SLOTS TAB ── */}
          {activeTab === 'slots' && (
            <>
              <div className="mb-4 md:mb-6 flex items-center justify-between">
                <div>
                  <h1 className="text-lg md:text-xl font-bold text-white mb-0.5">Dashboard</h1>
                  <p className="text-xs text-white/40 font-mono">
                    {hourlyPricingEnabled
                      ? <><span className="text-primary">${pricePerHour.toFixed(2)}/hr</span> · min {minHours}h</>
                      : <><span className="text-primary">${pricePerDay.toFixed(2)}</span> for {slotDurationHours}h</>}
                    {' '}· {activeCount}/{totalSlots} active
                  </p>
                </div>
              </div>

              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3"
              >
                {slots.map((slot, idx) => (
                  <motion.div key={slot.slotNumber} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.04 }}>
                    <SlotCard slotData={slot} onPurchase={setPurchasingSlot} onManage={setManagingSlot} />
                  </motion.div>
                ))}
              </motion.div>

              {/* Queue / Bid section */}
              {allFull && (
                <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="mt-6 md:mt-8">
                  <div className="border border-primary/18 bg-primary/4 rounded-xl overflow-hidden">
                    <div className="border-b border-primary/12 p-4 md:p-5">
                      <h3 className="font-bold text-primary flex items-center gap-2 text-sm">
                        <Gavel className="w-4 h-4" /> Slot Queue
                      </h3>
                      <p className="text-xs text-white/40 mt-1">All slots occupied — highest bid gets the next free slot.</p>
                    </div>

                    <div className="p-4 md:p-5 grid grid-cols-1 lg:grid-cols-2 gap-5 md:gap-6">
                      {/* Your bid */}
                      <div>
                        <h4 className="text-[10px] font-mono uppercase tracking-widest text-white/30 mb-3 flex items-center gap-2">
                          <TrendingUp className="w-3.5 h-3.5" /> Your Bid
                        </h4>
                        {myBid && !showBidForm ? (
                          <div className="border border-primary/25 bg-primary/6 rounded-xl p-4">
                            <div className="flex items-center justify-between mb-3">
                              <div>
                                <p className="font-bold text-primary text-2xl font-mono">${myBid.amount.toFixed(2)}</p>
                                <p className="text-xs text-white/40 mt-0.5">
                                  {myBid.rank === 1 ? '🏆 Top bidder!' : `Rank #${myBid.rank}`}
                                </p>
                              </div>
                              <span className={`text-xs px-2.5 py-1 rounded-full border font-mono ${myBid.rank === 1 ? 'border-primary/40 text-primary bg-primary/10' : 'border-orange-500/30 text-orange-400 bg-orange-500/10'}`}>
                                #{myBid.rank}
                              </span>
                            </div>
                            <p className="text-xs text-primary/60 mb-3 font-mono">${myBid.amount.toFixed(2)} held · cancelling refunds it</p>
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
                          <div className="border border-primary/20 p-4 rounded-xl space-y-3">
                            <p className="text-xs text-white/40">
                              {myBid ? `Current bid: $${myBid.amount.toFixed(2)}. Enter a higher amount.` : 'Bids are paid from your balance. Highest bidder wins the next open slot.'}
                            </p>
                            {bidsRes?.topPreorderAmount != null && (
                              <p className="text-xs text-amber-400">
                                Highest pre-order: <span className="font-bold">${bidsRes.topPreorderAmount.toFixed(2)}</span> — your bid must exceed this.
                              </p>
                            )}
                            <div className="flex items-center gap-2">
                              <span className="text-white/40 font-mono text-sm">$</span>
                              <input
                                type="number"
                                min={Math.max(myBid?.amount ?? 0, bidsRes?.topPreorderAmount ?? 0) + 0.01}
                                max={balanceRes?.balanceNum ?? 0}
                                step={0.01}
                                value={bidAmount}
                                onChange={e => setBidAmount(e.target.value)}
                                placeholder="0.00"
                                className="flex-1 bg-white/5 border border-white/10 rounded-lg text-white font-mono px-3 py-2 text-sm focus:outline-none focus:border-primary/50"
                                autoFocus
                              />
                            </div>
                            <div className="flex items-center justify-between px-3 py-2 rounded-lg border border-primary/15 bg-primary/5 text-xs font-mono">
                              <span className="text-white/40">Balance available</span>
                              <span className="text-primary font-bold">${(balanceRes?.balanceNum ?? 0).toFixed(2)}</span>
                            </div>
                            <div className="flex gap-2">
                              <Button size="sm" className="flex-1 text-xs" disabled={isPlacingBid || !bidAmount || parseFloat(bidAmount) <= (myBid?.amount ?? 0) || parseFloat(bidAmount) > (balanceRes?.balanceNum ?? 0) + (myBid?.amount ?? 0)} onClick={() => placeBid({ amount: parseFloat(bidAmount) })}>
                                {isPlacingBid ? 'Placing…' : myBid ? 'Raise Bid' : 'Place Bid'}
                              </Button>
                              <Button size="sm" variant="outline" className="border-white/10 text-xs" onClick={() => { setShowBidForm(false); setBidAmount(''); }}>Cancel</Button>
                            </div>
                          </div>
                        ) : (
                          <div className="border border-white/8 p-4 rounded-xl text-center">
                            <p className="text-xs text-white/30 mb-3">No active bid. Place one to join the queue.</p>
                            <Button size="sm" onClick={() => setShowBidForm(true)} className="text-xs w-full">
                              <Gavel className="w-3 h-3 mr-2" /> Place a Bid
                            </Button>
                          </div>
                        )}
                      </div>

                      {/* Bid leaderboard */}
                      <div>
                        <h4 className="text-[10px] font-mono uppercase tracking-widest text-white/30 mb-3 flex items-center gap-2">
                          <Crown className="w-3.5 h-3.5" /> Bid Queue ({bids.length})
                        </h4>
                        {bids.length === 0 ? (
                          <div className="border border-white/8 p-4 rounded-xl text-center text-xs text-white/30">No bids yet</div>
                        ) : (
                          <div className="space-y-2">
                            {bids.slice(0, 5).map((bid, i) => (
                              <div key={bid.id} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border ${bid.isOwn ? 'border-primary/25 bg-primary/6' : 'border-white/6 bg-white/3'}`}>
                                <span className="font-mono text-xs text-white/30 w-4 text-center">#{i + 1}</span>
                                {bid.avatar ? (
                                  <img src={`https://cdn.discordapp.com/avatars/${bid.discordId}/${bid.avatar}.png`} className="w-5 h-5 rounded-full flex-shrink-0" alt="" />
                                ) : (
                                  <div className="w-5 h-5 rounded-full bg-white/10 flex-shrink-0" />
                                )}
                                <span className="text-xs text-white/70 font-medium flex-1 truncate">{bid.username}</span>
                                <span className="text-xs font-mono font-bold text-primary">${bid.amount.toFixed(2)}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {preorderQueue.length > 0 && (
                          <div className="mt-4">
                            <h4 className="text-[10px] font-mono uppercase tracking-widest text-white/30 mb-2">Pre-order Queue ({preorderQueue.length})</h4>
                            <div className="space-y-1.5">
                              {preorderQueue.slice(0, 3).map((p, i) => (
                                <div key={p.id} className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs ${p.isOwn ? 'border-primary/20 bg-primary/5' : 'border-white/6 bg-white/2'}`}>
                                  <span className="font-mono text-white/30 w-4 text-center">#{i + 1}</span>
                                  <span className="text-white/60 flex-1 truncate">{p.username}</span>
                                  <span className="font-mono text-primary">${p.amount.toFixed(2)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        <div className="mt-3 flex gap-2">
                          {!myBid && !showBidForm && (
                            <Button size="sm" variant="outline" className="border-primary/25 text-primary text-xs flex-1" onClick={() => setShowBidForm(true)}>
                              <Gavel className="w-3 h-3 mr-1.5" /> Bid for Slot
                            </Button>
                          )}
                          {!myPreorder && (
                            <Button size="sm" variant="outline" className="border-white/12 text-white/60 text-xs flex-1" onClick={() => setShowPreorderModal(true)}>
                              Pre-order
                            </Button>
                          )}
                          {myPreorder && (
                            <p className="text-xs text-primary/70 font-mono">Pre-order active · ${myPreorder.amount.toFixed(2)}</p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </>
          )}

          {/* ── LEADERBOARD TAB ── */}
          {activeTab === 'leaderboard' && (() => {
            const all = leaderboardRes?.leaderboard ?? [];
            const bySpent = [...all].sort((a, b) => b.totalSpent - a.totalSpent);
            const byHours = [...all].sort((a, b) => b.totalHours - a.totalHours);

            const MedalIcon = ({ rank }: { rank: number }) => {
              if (rank === 1) return <span className="text-base">👑</span>;
              if (rank === 2) return <span className="text-base">🥈</span>;
              if (rank === 3) return <span className="text-base">🥉</span>;
              return <span className="font-mono text-xs text-white/30 w-5 text-center">{rank}</span>;
            };

            const AvatarEl = ({ entry }: { entry: typeof all[0] }) => entry.avatar ? (
              <img src={`https://cdn.discordapp.com/avatars/${entry.discordId}/${entry.avatar}.png`} className="w-8 h-8 rounded-full flex-shrink-0" alt="" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-primary/20 border border-primary/20 flex items-center justify-center flex-shrink-0">
                <span className="text-xs font-bold text-primary">{entry.username[0]?.toUpperCase()}</span>
              </div>
            );

            const topCardStyle = (rank: number) =>
              rank === 1 ? 'border-primary/30 bg-primary/[0.07]' :
              rank === 2 ? 'border-white/10 bg-white/[0.04]' :
              'border-white/8 bg-white/[0.03]';

            const LeaderColumn = ({ title, icon, entries, valueKey, formatValue }: {
              title: string; icon: React.ReactNode; entries: typeof all;
              valueKey: 'totalSpent' | 'totalHours'; formatValue: (v: number) => string;
            }) => (
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-3">
                  {icon}
                  <span className="text-sm font-bold text-white/80">{title}</span>
                </div>
                <div className="space-y-2">
                  {entries.map((entry, i) => {
                    const rank = i + 1;
                    const isTop3 = rank <= 3;
                    return (
                      <motion.div
                        key={`${entry.discordId}-${valueKey}`}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.03 }}
                        className={`flex items-center gap-3 px-3 md:px-4 py-2.5 md:py-3 rounded-xl border transition-colors ${isTop3 ? topCardStyle(rank) : 'border-white/5 bg-transparent hover:bg-white/3'}`}
                      >
                        <div className="w-5 flex items-center justify-center flex-shrink-0">
                          <MedalIcon rank={rank} />
                        </div>
                        <AvatarEl entry={entry} />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs md:text-sm font-semibold text-white/90 truncate leading-tight">{entry.username}</p>
                          <p className={`text-xs font-mono font-semibold ${rank === 1 ? 'text-primary' : 'text-primary/60'}`}>
                            {formatValue(entry[valueKey])}
                          </p>
                        </div>
                      </motion.div>
                    );
                  })}
                  {entries.length === 0 && (
                    <div className="text-center py-10 text-white/20 text-sm">No entries yet</div>
                  )}
                </div>
              </div>
            );

            return (
              <>
                <div className="mb-5 md:mb-6 flex items-center gap-3">
                  <Trophy className="w-5 h-5 text-primary" />
                  <div>
                    <h1 className="text-lg md:text-xl font-bold text-white leading-tight">Leaderboard</h1>
                    <p className="text-xs text-white/35">All-time top users</p>
                  </div>
                </div>
                {isLeaderboardLoading ? (
                  <div className="flex justify-center py-20">
                    <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : (
                  <div className="flex gap-4 md:gap-6">
                    <LeaderColumn title="Most Deposited" icon={<span className="text-primary text-sm">$</span>} entries={bySpent} valueKey="totalSpent" formatValue={v => `$${v.toFixed(2)}`} />
                    <LeaderColumn title="Most Hours" icon={<Trophy className="w-3.5 h-3.5 text-primary" />} entries={byHours} valueKey="totalHours" formatValue={v => `${v}h`} />
                  </div>
                )}
              </>
            );
          })()}

          {/* ── HISTORY TAB ── */}
          {activeTab === 'deposit' && (
            <>
              <div className="mb-5 md:mb-6 flex items-center justify-between">
                <div>
                  <h1 className="text-lg md:text-xl font-bold text-white mb-0.5">History</h1>
                  <p className="text-xs text-white/40">Your payment and deposit history</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-white/30 font-mono">Balance</p>
                  <p className="text-lg font-bold font-mono text-primary">${userBalance.toFixed(2)}</p>
                </div>
              </div>

              {isHistoryLoading ? (
                <div className="flex justify-center py-16">
                  <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                </div>
              ) : (historyRes?.payments ?? []).length === 0 ? (
                <div className="border border-white/6 rounded-xl py-16 text-center">
                  <Wallet className="w-8 h-8 text-white/15 mx-auto mb-3" />
                  <p className="text-sm text-white/30">No transactions yet</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {(historyRes?.payments ?? []).map(p => (
                    <div key={p.id} className="flex items-center gap-3 md:gap-4 px-4 md:px-5 py-3 md:py-4 rounded-xl border border-white/6 bg-white/2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <p className="text-sm text-white/80 font-medium">Slot #{p.slotNumber}</p>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono border ${
                            p.status === 'completed' ? 'border-green-500/25 text-green-400 bg-green-500/8' :
                            p.status === 'pending' ? 'border-amber-500/25 text-amber-400 bg-amber-500/8' :
                            'border-white/12 text-white/30 bg-white/4'
                          }`}>{p.status}</span>
                        </div>
                        <p className="text-xs text-white/30 font-mono truncate">{p.method}{p.currency ? ` · ${p.currency}` : ''} · {new Date(p.createdAt).toLocaleDateString()}</p>
                      </div>
                      <span className="font-mono font-bold text-primary flex-shrink-0">{p.amount ? `$${parseFloat(p.amount).toFixed(2)}` : '—'}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </main>

      {/* ── Mobile bottom nav ──────────────────────────────────────────── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-[#0f0f13] border-t border-white/6 flex items-center">
        {navItems.map(item => (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id)}
            className={`flex-1 flex flex-col items-center gap-1 py-3 transition-colors ${
              activeTab === item.id ? 'text-primary' : 'text-white/30'
            }`}
          >
            {item.icon}
            <span className="text-[10px] font-medium">{item.label}</span>
          </button>
        ))}
        {user.isAdmin && (
          <button
            onClick={() => setLocation('/admin')}
            className="flex-1 flex flex-col items-center gap-1 py-3 text-white/30"
          >
            <Settings className="w-5 h-5" />
            <span className="text-[10px] font-medium">Admin</span>
          </button>
        )}
        <button
          onClick={handleLogout}
          className="flex-1 flex flex-col items-center gap-1 py-3 text-white/30"
        >
          <LogOut className="w-5 h-5" />
          <span className="text-[10px] font-medium">Logout</span>
        </button>
      </nav>

      </div>{/* end flex-1 overflow-hidden */}

      {/* Modals */}
      <PaymentModal
        isOpen={purchasingSlot !== null}
        slotNumber={purchasingSlot ?? 0}
        pricePerDay={pricePerDay}
        slotDurationHours={slotDurationHours}
        hourlyPricingEnabled={hourlyPricingEnabled}
        pricePerHour={pricePerHour}
        minHours={minHours}
        userBalance={userBalance}
        onClose={() => setPurchasingSlot(null)}
        onSuccess={() => { setPurchasingSlot(null); refetchSlots(); refetchBalance(); }}
      />
      <ManageSlotModal
        slot={managingSlot}
        onClose={() => setManagingSlot(null)}
        onSuccess={() => { setManagingSlot(null); refetchSlots(); }}
      />
      <PreorderModal
        isOpen={showPreorderModal}
        pricePerDay={pricePerDay}
        slotDurationHours={slotDurationHours}
        nextExpiresAt={nextExpiresAt}
        balance={userBalance}
        hourlyPricingEnabled={hourlyPricingEnabled}
        pricePerHour={pricePerHour}
        minHours={minHours}
        onClose={() => setShowPreorderModal(false)}
        onSuccess={() => { setShowPreorderModal(false); refetchPreorders(); refetchBalance(); }}
      />
      <DepositModal
        isOpen={showDepositModal}
        onClose={() => setShowDepositModal(false)}
        onSuccess={() => { setShowDepositModal(false); refetchBalance(); }}
      />
    </div>
  );
}
