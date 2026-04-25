import React, { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import Navbar from '@/components/Navbar';
import { Gavel, Plus, Crown, TrendingUp, X, Wallet, Clock, ArrowDownLeft, Star, Copy, Check } from 'lucide-react';
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

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${import.meta.env.BASE_URL}${path}`, { credentials: 'include' });
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
}

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [purchasingSlot, setPurchasingSlot] = useState<number | null>(null);
  const [managingSlot, setManagingSlot] = useState<PublicSlot | null>(null);
  const [bidAmount, setBidAmount] = useState('');
  const [showBidForm, setShowBidForm] = useState(false);
  const [showPreorderModal, setShowPreorderModal] = useState(false);
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [slotTakenBanner, setSlotTakenBanner] = useState<string | null>(null);
  const [referralCopied, setReferralCopied] = useState(false);
  const [reviewRating, setReviewRating] = useState(0);
  const [reviewBody, setReviewBody] = useState('');
  const [reviewHover, setReviewHover] = useState(0);
  const queryClient = useQueryClient();

  const { data: user, isError: isUserError, isLoading: isUserLoading } = useGetMe({ query: { retry: false } as any });

  const { data: slotsRes, refetch: refetchSlots } = useQuery({
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

  const { data: balanceRes, refetch: refetchBalance } = useQuery({
    queryKey: ['balance'],
    queryFn: () => apiFetch<{ balance: string; balanceNum: number }>('api/balance'),
    enabled: !!user,
    refetchInterval: 10000,
    refetchIntervalInBackground: false,
  });

  const { data: historyRes } = useQuery({
    queryKey: ['history'],
    queryFn: () => apiFetch<{ payments: { id: string; slotNumber: number; method: string; currency: string | null; amount: string | null; status: string; createdAt: string }[] }>('api/slots/history'),
    enabled: !!user,
  });

  const { data: referralRes } = useQuery({
    queryKey: ['referral'],
    queryFn: () => apiFetch<{ referralCode: string; totalInvites: number; dollarsEarned: number }>('api/referral'),
    enabled: !!user,
    staleTime: 30000,
  });

  const { data: myReviewRes } = useQuery({
    queryKey: ['my-review'],
    queryFn: async () => {
      const res = await fetch(`${import.meta.env.BASE_URL}api/reviews/mine`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed');
      return res.json() as Promise<{ review: { id: number; rating: number; body: string; isVisible: boolean } | null }>;
    },
    enabled: !!user,
    staleTime: 60000,
  });

  const { mutate: submitReview, isPending: isSubmittingReview } = useMutation({
    mutationFn: async ({ rating, body }: { rating: number; body: string }) => {
      const res = await fetch(`${import.meta.env.BASE_URL}api/reviews`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating, body }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.message || 'Failed');
      return d;
    },
    onSuccess: (d) => {
      toast({ title: 'Review submitted!', description: d.message });
      setReviewRating(0); setReviewBody('');
      queryClient.invalidateQueries({ queryKey: ['my-review'] });
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

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
    } else if (params.get('deposit') === 'success') {
      toast({ title: 'Funds Added!', description: 'Your balance has been credited.', className: 'bg-primary text-primary-foreground border-none' });
      window.history.replaceState({}, document.title, window.location.pathname);
      refetchBalance();
    }
  }, []);

  useEffect(() => {
    if (isUserError) setLocation('/');
  }, [isUserError, setLocation]);

  if (isUserLoading) return null;

  if (!user) return null;

  const slots = slotsRes?.slots || [];
  const totalSlots = slotsRes?.totalSlots ?? 10;
  const hourlyPricingEnabled = slotsRes?.hourlyPricingEnabled ?? false;
  const pricePerHour = slotsRes?.pricePerHour ?? 5;
  const pricePerDay = slotsRes?.pricePerDay ?? 20;
  const slotDurationHours = slotsRes?.slotDurationHours ?? 24;
  const minHours = slotsRes?.minHours ?? 2;
  const activeCount = slots.filter(s => s.isActive).length;
  const allFull = activeCount >= totalSlots && totalSlots > 0;
  const bids = bidsRes?.bids ?? [];
  const myBid = bidsRes?.myBid ?? null;
  const myPreorder = preordersRes?.myPreorder ?? null;
  const userBalance = balanceRes?.balanceNum ?? 0;
  const mySlot = slots.find(s => s.isOwner && s.isActive);
  const completedPayments = historyRes?.payments.filter(p => p.status === 'completed') ?? [];
  const totalDeposited = completedPayments.reduce((sum, p) => sum + (parseFloat(p.amount ?? '0') || 0), 0);
  const recentDeposits = completedPayments.slice(0, 15);

  return (
    <div className="min-h-screen bg-[#0a0a08] text-white flex flex-col">
      <div className="pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(ellipse_70%_40%_at_50%_0%,hsla(30,60%,15%,0.2),transparent)]" />
      <Navbar current="dashboard" />

      <main className="relative z-10 flex-1 max-w-4xl mx-auto w-full px-4 py-8">

        {/* ── Slot Taken Banner ── */}
        {slotTakenBanner && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="mb-6 flex items-start gap-3 bg-orange-500/10 border border-orange-500/30 rounded-xl px-4 py-3"
          >
            <span className="text-orange-400 text-lg mt-0.5">⚠️</span>
            <div className="flex-1">
              <p className="text-sm font-semibold text-orange-300">Slot Taken</p>
              <p className="text-xs text-orange-200/70 mt-0.5">{slotTakenBanner}</p>
            </div>
            <button onClick={() => setSlotTakenBanner(null)} className="text-orange-400/60 hover:text-orange-300 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}

        {/* ── User Header ── */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-5 mb-8">
          <div className="flex-shrink-0">
            {user.avatar ? (
              <img
                src={`https://cdn.discordapp.com/avatars/${user.discordId}/${user.avatar}.png?size=128`}
                alt="Avatar"
                className="w-20 h-20 rounded-2xl object-cover border-2 border-[#f5a623]/20"
              />
            ) : (
              <div className="w-20 h-20 rounded-2xl bg-[#f5a623]/15 border-2 border-[#f5a623]/25 flex items-center justify-center">
                <span className="text-[#f5a623] text-2xl font-bold">{user.username?.[0]?.toUpperCase()}</span>
              </div>
            )}
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-white mb-0.5">{user.username}</h1>
            <p className="text-sm text-white/35">Dashboard</p>
          </div>
        </motion.div>

        {/* ── 3 Stat Cards ── */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">

          {/* Balance */}
          <div className="rounded-2xl border border-white/8 bg-[#13110a] p-5">
            <div className="flex items-center gap-2 mb-2">
              <Wallet className="w-3.5 h-3.5 text-white/30" />
              <p className="text-[11px] font-semibold uppercase tracking-widest text-white/35">Balance</p>
            </div>
            <p className="text-3xl font-extrabold text-white mb-4">${userBalance.toFixed(2)}</p>
            <button
              onClick={() => setShowDepositModal(true)}
              className="w-full bg-[#2ecc71] hover:bg-[#27ae60] active:scale-[0.98] text-black font-bold text-sm py-2.5 rounded-xl transition-all"
            >
              Add funds (Deposit)
            </button>
          </div>

          {/* Current Plan */}
          <div className="rounded-2xl border border-white/8 bg-[#13110a] p-5 relative overflow-hidden">
            <div className="flex items-center gap-2 mb-2">
              <Crown className="w-3.5 h-3.5 text-white/30" />
              <p className="text-[11px] font-semibold uppercase tracking-widest text-white/35">Current Plan</p>
            </div>
            {mySlot ? (
              <>
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-2 h-2 rounded-full bg-[#f5a623] animate-pulse" />
                  <span className="text-lg font-extrabold text-white">Slot #{String(mySlot.slotNumber).padStart(2, '0')}</span>
                </div>
                <p className="text-xs text-white/40">
                  {hourlyPricingEnabled ? `$${pricePerHour.toFixed(2)}/hr · min ${minHours}h` : `$${pricePerDay.toFixed(2)} / ${slotDurationHours}h`}
                </p>
              </>
            ) : (
              <>
                <p className="text-2xl font-extrabold text-white/20 mb-1">—</p>
                <p className="text-xs text-white/35">No active plan</p>
              </>
            )}
          </div>

          {/* Total Deposited */}
          <div className="rounded-2xl border border-white/8 bg-[#13110a] p-5">
            <div className="flex items-center gap-2 mb-2">
              <ArrowDownLeft className="w-3.5 h-3.5 text-white/30" />
              <p className="text-[11px] font-semibold uppercase tracking-widest text-white/35">Total Deposited</p>
            </div>
            <p className="text-3xl font-extrabold text-[#2ecc71]">${totalDeposited.toFixed(2)}</p>
          </div>

        </motion.div>

        {/* ── Slots Grid ── */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[11px] font-semibold uppercase tracking-widest text-white/35">
              Slots — {activeCount}/{totalSlots} active
            </h2>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {slots.map((slot, idx) => (
              <motion.div key={slot.slotNumber} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.03 }}>
                <SlotCard slotData={slot} onPurchase={setPurchasingSlot} onManage={setManagingSlot} />
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* ── Bid Queue — shown when all slots are full OR user has an active bid ── */}
        {(allFull || myBid) && <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="mb-8">
            <div className="rounded-2xl border border-[#f5a623]/20 bg-[#f5a623]/[0.03] overflow-hidden">
              <div className="border-b border-[#f5a623]/10 px-5 py-4 flex items-center gap-2">
                <Gavel className="w-4 h-4 text-[#f5a623]" />
                <div>
                  <h3 className="font-bold text-[#f5a623] text-sm">Slot Queue</h3>
                  <p className="text-xs text-white/35 mt-0.5">
                    {allFull ? 'All slots occupied — highest bid gets the next free slot.' : 'Slots available — your bid will be fulfilled first when a slot opens.'}
                    {' '}<span className="text-[#f5a623]/50">Winner gets 1h access.</span>
                  </p>
                </div>
              </div>
              <div className="p-5 grid grid-cols-1 lg:grid-cols-2 gap-5">
                {/* Your bid */}
                <div>
                  <h4 className="text-[10px] font-mono uppercase tracking-widest text-white/30 mb-3 flex items-center gap-2">
                    <TrendingUp className="w-3.5 h-3.5" /> Your Bid
                  </h4>
                  {myBid && !showBidForm ? (
                    <div className="border border-[#f5a623]/25 bg-[#f5a623]/6 rounded-xl p-4">
                      <div className="flex items-center justify-between mb-2">
                        <p className="font-bold text-[#f5a623] text-2xl font-mono">${myBid.amount.toFixed(2)}</p>
                        <span className="text-xs px-2.5 py-1 rounded-full border border-[#f5a623]/30 text-[#f5a623] bg-[#f5a623]/10 font-mono">#{myBid.rank}</span>
                      </div>
                      <p className="text-xs text-[#f5a623]/60 mb-1 font-mono">{myBid.rank === 1 ? '🏆 Top bidder!' : `Rank #${myBid.rank}`}</p>
                      <p className="text-xs text-white/30 mb-3">Bidding for <span className="text-white/50 font-semibold">1h</span> of access</p>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" className="border-[#f5a623]/30 text-[#f5a623] text-xs flex-1" onClick={() => { setBidAmount(String(myBid.amount)); setShowBidForm(true); }}>Raise Bid</Button>
                        <Button size="sm" variant="outline" className="border-red-500/25 text-red-400 text-xs" disabled={isCancellingBid} onClick={() => cancelBid()}>
                          <X className="w-3 h-3 mr-1" /> Cancel
                        </Button>
                      </div>
                    </div>
                  ) : showBidForm ? (
                    <div className="border border-[#f5a623]/20 p-4 rounded-xl space-y-3">
                      <p className="text-xs text-white/40">
                        {myBid ? `Current bid: $${myBid.amount.toFixed(2)}. Enter a higher amount.` : 'Highest bidder wins the next open slot.'}
                        {' '}<span className="text-[#f5a623]/50">Winner gets 1h access.</span>
                      </p>
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
                          className="flex-1 bg-white/5 border border-white/10 rounded-lg text-white font-mono px-3 py-2 text-sm focus:outline-none focus:border-[#f5a623]/50"
                          autoFocus
                        />
                      </div>
                      <div className="flex items-center justify-between px-3 py-2 rounded-lg border border-[#f5a623]/15 bg-[#f5a623]/5 text-xs font-mono">
                        <span className="text-white/40">Balance</span>
                        <span className="text-[#f5a623] font-bold">${(balanceRes?.balanceNum ?? 0).toFixed(2)}</span>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" className="flex-1 text-xs bg-[#f5a623] text-black hover:bg-[#f5a623]/90" disabled={isPlacingBid || !bidAmount || parseFloat(bidAmount) <= (myBid?.amount ?? 0)} onClick={() => placeBid({ amount: parseFloat(bidAmount) })}>
                          {isPlacingBid ? 'Placing…' : myBid ? 'Raise Bid' : 'Place Bid'}
                        </Button>
                        <Button size="sm" variant="outline" className="border-white/10 text-xs" onClick={() => { setShowBidForm(false); setBidAmount(''); }}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="border border-white/8 p-4 rounded-xl text-center">
                      <p className="text-xs text-white/30 mb-1">No active bid. Place one to join the queue.</p>
                      <p className="text-xs text-[#f5a623]/40 mb-3">Win = <span className="font-semibold">1h</span> of access</p>
                      <Button size="sm" onClick={() => setShowBidForm(true)} className="text-xs w-full bg-[#f5a623] text-black hover:bg-[#f5a623]/90">
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
                        <div key={bid.id} className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border ${bid.isOwn ? 'border-[#f5a623]/25 bg-[#f5a623]/6' : 'border-white/6 bg-white/[0.02]'}`}>
                          <span className="font-mono text-xs text-white/30 w-4 text-center">#{i + 1}</span>
                          {bid.avatar ? (
                            <img src={`https://cdn.discordapp.com/avatars/${bid.discordId}/${bid.avatar}.png`} alt="" className="w-6 h-6 rounded-full flex-shrink-0" />
                          ) : (
                            <div className="w-6 h-6 rounded-full bg-white/10 flex-shrink-0 flex items-center justify-center">
                              <span className="text-[10px] text-white/50">{bid.username?.[0]?.toUpperCase()}</span>
                            </div>
                          )}
                          <span className="text-xs text-white/70 flex-1 truncate">{bid.username}</span>
                          <span className="font-mono text-xs text-[#f5a623] font-bold">${bid.amount.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </motion.div>}

        {/* ── Recent Deposits ── */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="mb-6">
          <div className="rounded-2xl border border-white/8 bg-[#13110a] overflow-hidden">
            <div className="px-5 py-4 border-b border-white/6">
              <h3 className="font-bold text-white text-sm uppercase tracking-wide">Recent Deposits</h3>
              <p className="text-xs text-white/30 mt-0.5">Last 15 deposits</p>
            </div>
            <div className="p-5">
              {recentDeposits.length === 0 ? (
                <p className="text-sm text-white/30">No deposits yet.</p>
              ) : (
                <div className="space-y-1">
                  {recentDeposits.map(p => (
                    <div key={p.id} className="flex items-center justify-between py-2.5 border-b border-white/5 last:border-0">
                      <div>
                        <p className="text-sm text-white/80 font-medium">
                          {p.method === 'stripe' ? 'Stripe' : p.method === 'nowpayments' ? `Crypto (${p.currency?.toUpperCase() ?? ''})` : p.method === 'balance' ? 'Balance' : p.method}
                          {' '}· Slot #{p.slotNumber}
                        </p>
                        <p className="text-xs text-white/30">{new Date(p.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                      </div>
                      <span className="font-mono text-sm font-bold text-[#2ecc71]">+${parseFloat(p.amount ?? '0').toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </motion.div>

        {/* ── Referral Card ── */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} className="mb-6">
          <div className="rounded-2xl border border-white/8 bg-[#13110a] overflow-hidden">
            <div className="px-5 py-4 border-b border-white/6">
              <h3 className="font-bold text-white text-sm uppercase tracking-wide">Refer Friends</h3>
              <p className="text-xs text-white/30 mt-0.5">Earn $1 balance credit for every 10 users you refer</p>
            </div>
            <div className="p-5">
              {referralRes ? (
                <>
                  <div className="flex items-center gap-2 mb-4">
                    <div className="flex-1 font-mono text-sm text-white/70 bg-white/5 rounded-lg px-3 py-2 border border-white/8 select-all">
                      {`${window.location.origin}${import.meta.env.BASE_URL}?ref=${referralRes.referralCode}`}
                    </div>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(`${window.location.origin}${import.meta.env.BASE_URL}?ref=${referralRes.referralCode}`);
                        setReferralCopied(true);
                        setTimeout(() => setReferralCopied(false), 2000);
                      }}
                      className="flex items-center gap-1.5 px-3 h-9 rounded-lg bg-[#f5a623]/15 border border-[#f5a623]/25 text-[#f5a623] text-xs font-medium hover:bg-[#f5a623]/25 transition-colors flex-shrink-0"
                    >
                      {referralCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      {referralCopied ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-3 text-center">
                      <p className="text-lg font-bold text-white">{referralRes.totalInvites}</p>
                      <p className="text-[10px] text-white/30 mt-0.5">Total referrals</p>
                    </div>
                    <div className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-3 text-center">
                      <p className="text-lg font-bold text-[#f5a623]">${referralRes.dollarsEarned.toFixed(2)}</p>
                      <p className="text-[10px] text-white/30 mt-0.5">Earned</p>
                    </div>
                    <div className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-3 text-center">
                      <p className="text-lg font-bold text-white">{10 - (referralRes.totalInvites % 10 || 10)}</p>
                      <p className="text-[10px] text-white/30 mt-0.5">Until next $1</p>
                    </div>
                  </div>
                </>
              ) : (
                <p className="text-sm text-white/30">Loading referral info…</p>
              )}
            </div>
          </div>
        </motion.div>

        {/* ── Leave a Review ── */}
        {completedPayments.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="mb-6">
            <div className="rounded-2xl border border-white/8 bg-[#13110a] overflow-hidden">
              <div className="px-5 py-4 border-b border-white/6">
                <h3 className="font-bold text-white text-sm uppercase tracking-wide">Leave a Review</h3>
                <p className="text-xs text-white/30 mt-0.5">Share your experience — reviews are shown once approved</p>
              </div>
              <div className="p-5">
                {myReviewRes?.review ? (
                  <div className="flex items-start gap-3 rounded-xl border border-green-500/20 bg-green-500/5 p-4">
                    <div className="flex gap-0.5 mt-0.5">
                      {[1,2,3,4,5].map(i => (
                        <Star key={i} className={`w-4 h-4 ${i <= (myReviewRes.review!.rating) ? 'fill-amber-400 text-amber-400' : 'text-white/15'}`} />
                      ))}
                    </div>
                    <div>
                      <p className="text-xs font-medium text-green-400">{myReviewRes.review.isVisible ? 'Review approved and visible' : 'Review submitted — pending approval'}</p>
                      <p className="text-xs text-white/50 mt-1 leading-relaxed">{myReviewRes.review.body}</p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <p className="text-xs text-white/50 mb-2">Rating</p>
                      <div className="flex gap-1">
                        {[1,2,3,4,5].map(i => (
                          <button
                            key={i}
                            onMouseEnter={() => setReviewHover(i)}
                            onMouseLeave={() => setReviewHover(0)}
                            onClick={() => setReviewRating(i)}
                            className="transition-transform hover:scale-110"
                          >
                            <Star className={`w-7 h-7 transition-colors ${i <= (reviewHover || reviewRating) ? 'fill-amber-400 text-amber-400' : 'text-white/20'}`} />
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-white/50 mb-2">Your review</p>
                      <textarea
                        value={reviewBody}
                        onChange={e => setReviewBody(e.target.value)}
                        maxLength={500}
                        rows={3}
                        placeholder="Tell others about your experience…"
                        className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-white/25 resize-none focus:outline-none focus:ring-1 focus:ring-[#f5a623]/40"
                      />
                      <p className="text-[10px] text-white/20 mt-1 text-right">{reviewBody.length}/500</p>
                    </div>
                    <button
                      disabled={!reviewRating || reviewBody.trim().length < 5 || isSubmittingReview}
                      onClick={() => submitReview({ rating: reviewRating, body: reviewBody })}
                      className="px-5 h-9 rounded-lg bg-[#f5a623] text-black font-bold text-sm hover:bg-[#e8961a] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {isSubmittingReview ? 'Submitting…' : 'Submit Review'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}

      </main>

      {/* Modals */}
      <PaymentModal
        isOpen={purchasingSlot !== null}
        slotNumber={purchasingSlot ?? 1}
        pricePerDay={pricePerDay}
        slotDurationHours={slotDurationHours}
        hourlyPricingEnabled={hourlyPricingEnabled}
        pricePerHour={pricePerHour}
        minHours={minHours}
        userBalance={userBalance}
        onClose={() => setPurchasingSlot(null)}
        onSuccess={() => { setPurchasingSlot(null); refetchSlots(); }}
        onSlotTaken={() => {
          setPurchasingSlot(null);
          setSlotTakenBanner(`Slot #${purchasingSlot} was just taken by someone else. Your payment has been refunded to your balance.`);
          refetchSlots();
          setTimeout(() => setSlotTakenBanner(null), 10000);
        }}
      />
      {managingSlot && (
        <ManageSlotModal
          slot={managingSlot}
          onClose={() => setManagingSlot(null)}
          onSuccess={() => { setManagingSlot(null); refetchSlots(); }}
        />
      )}
      {showPreorderModal && slotsRes && (
        <PreorderModal
          myPreorder={myPreorder}
          slotsData={slotsRes}
          balance={userBalance}
          onClose={() => setShowPreorderModal(false)}
          onSuccess={() => { setShowPreorderModal(false); refetchPreorders(); refetchBalance(); }}
        />
      )}
      <DepositModal
        isOpen={showDepositModal}
        onClose={() => setShowDepositModal(false)}
        onSuccess={() => { setShowDepositModal(false); refetchBalance(); }}
      />
    </div>
  );
}
