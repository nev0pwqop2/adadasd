import React, { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import Navbar from '@/components/Navbar';
import { Gavel, Plus, Crown, TrendingUp, X } from 'lucide-react';
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
    } else if (params.get('deposit') === 'success') {
      toast({ title: 'Funds Added!', description: 'Your balance has been credited.', className: 'bg-primary text-primary-foreground border-none' });
      window.history.replaceState({}, document.title, window.location.pathname);
      refetchBalance();
    }
  }, []);

  useEffect(() => {
    if (isUserError) setLocation('/');
  }, [isUserError, setLocation]);

  if (isUserLoading) {
    return (
      <div className="min-h-screen bg-[#0a0a08] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-[#f5a623] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

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
      <Navbar current="dashboard" />

      <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-8">

        {/* ── User Header ── */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-5 mb-8">
          <div className="flex-shrink-0">
            {user.avatar ? (
              <img
                src={`https://cdn.discordapp.com/avatars/${user.discordId}/${user.avatar}.png`}
                alt="Avatar"
                className="w-20 h-20 rounded-2xl border-2 border-white/10 object-cover"
              />
            ) : (
              <div className="w-20 h-20 rounded-2xl bg-[#f5a623]/20 border-2 border-[#f5a623]/30 flex items-center justify-center">
                <span className="text-[#f5a623] text-2xl font-bold">{user.username?.[0]?.toUpperCase()}</span>
              </div>
            )}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white mb-0.5">{user.username}</h1>
            <p className="text-sm text-white/40">Dashboard</p>
          </div>
        </motion.div>

        {/* ── 3 Stat Cards ── */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">

          {/* Balance */}
          <div className="rounded-2xl border border-white/8 bg-[#13110a] p-5">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-white/35 mb-2">Balance</p>
            <p className="text-3xl font-bold text-white mb-4">${userBalance.toFixed(2)}</p>
            <button
              onClick={() => setShowDepositModal(true)}
              className="w-full bg-[#2ecc71] hover:bg-[#27ae60] text-black font-semibold text-sm py-2 rounded-xl transition-colors"
            >
              Add funds (Deposit)
            </button>
          </div>

          {/* Current Plan */}
          <div className="rounded-2xl border border-white/8 bg-[#13110a] p-5 relative overflow-hidden">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-white/35 mb-2">Current Plan</p>
            {mySlot ? (
              <>
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-2 h-2 rounded-full bg-[#f5a623] animate-pulse" />
                  <span className="text-sm font-semibold text-[#f5a623]">Slot #{mySlot.slotNumber}</span>
                </div>
                <p className="text-xs text-white/40">
                  {hourlyPricingEnabled
                    ? `$${pricePerHour.toFixed(2)}/hr · min ${minHours}h`
                    : `$${pricePerDay.toFixed(2)} / ${slotDurationHours}h`}
                </p>
              </>
            ) : (
              <>
                <p className="text-2xl font-bold text-white/20 mb-1">—</p>
                <p className="text-xs text-white/35">No active plan</p>
              </>
            )}
            <div className="absolute top-5 right-5 w-2.5 h-2.5 rounded-full bg-white/15" />
          </div>

          {/* Total Deposited */}
          <div className="rounded-2xl border border-white/8 bg-[#13110a] p-5">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-white/35 mb-2">Total Deposited</p>
            <p className="text-3xl font-bold text-[#2ecc71]">${totalDeposited.toFixed(2)}</p>
          </div>

        </motion.div>

        {/* ── Slots Grid ── */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-white/35 mb-3">
            Slots — {activeCount}/{totalSlots} active
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 mb-8">
            {slots.map((slot, idx) => (
              <motion.div key={slot.slotNumber} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.03 }}>
                <SlotCard slotData={slot} onPurchase={setPurchasingSlot} onManage={setManagingSlot} />
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* ── Bid Queue (when full) ── */}
        {allFull && (
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="mb-8">
            <div className="rounded-2xl border border-[#f5a623]/20 bg-[#f5a623]/4 overflow-hidden">
              <div className="border-b border-[#f5a623]/12 px-5 py-4">
                <h3 className="font-bold text-[#f5a623] flex items-center gap-2 text-sm">
                  <Gavel className="w-4 h-4" /> Slot Queue
                </h3>
                <p className="text-xs text-white/40 mt-0.5">All slots occupied — highest bid gets the next free slot.</p>
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
                      <p className="text-xs text-[#f5a623]/60 mb-3 font-mono">{myBid.rank === 1 ? '🏆 Top bidder!' : `Rank #${myBid.rank}`}</p>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" className="border-[#f5a623]/30 text-[#f5a623] text-xs flex-1" onClick={() => { setBidAmount(String(myBid.amount)); setShowBidForm(true); }}>Raise Bid</Button>
                        <Button size="sm" variant="outline" className="border-red-500/25 text-red-400 text-xs" disabled={isCancellingBid} onClick={() => cancelBid()}>
                          <X className="w-3 h-3 mr-1" /> Cancel
                        </Button>
                      </div>
                    </div>
                  ) : showBidForm ? (
                    <div className="border border-[#f5a623]/20 p-4 rounded-xl space-y-3">
                      <p className="text-xs text-white/40">{myBid ? `Current bid: $${myBid.amount.toFixed(2)}. Enter a higher amount.` : 'Highest bidder wins the next open slot.'}</p>
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
                      <p className="text-xs text-white/30 mb-3">No active bid. Place one to join the queue.</p>
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
                        <div key={bid.id} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border ${bid.isOwn ? 'border-[#f5a623]/25 bg-[#f5a623]/6' : 'border-white/6 bg-white/3'}`}>
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
          </motion.div>
        )}

        {/* ── Recent Deposits ── */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <div className="rounded-2xl border border-white/8 bg-[#13110a] overflow-hidden">
            <div className="px-5 py-4 border-b border-white/6">
              <h3 className="font-bold text-white text-sm uppercase tracking-wide">Recent Deposits</h3>
              <p className="text-xs text-white/30 mt-0.5">Last 15 deposits</p>
            </div>
            <div className="p-5">
              {recentDeposits.length === 0 ? (
                <p className="text-sm text-white/30">No deposits yet.</p>
              ) : (
                <div className="space-y-2">
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

      </main>

      {/* Modals */}
      {purchasingSlot !== null && (
        <PaymentModal
          slotNumber={purchasingSlot}
          slotsData={slotsRes!}
          balance={userBalance}
          onClose={() => setPurchasingSlot(null)}
          onSuccess={() => { setPurchasingSlot(null); refetchSlots(); }}
        />
      )}
      {managingSlot && (
        <ManageSlotModal
          slot={managingSlot}
          onClose={() => setManagingSlot(null)}
          onSuccess={() => { setManagingSlot(null); refetchSlots(); }}
        />
      )}
      {showPreorderModal && (
        <PreorderModal
          myPreorder={myPreorder}
          slotsData={slotsRes!}
          balance={userBalance}
          onClose={() => setShowPreorderModal(false)}
          onSuccess={() => { setShowPreorderModal(false); refetchPreorders(); refetchBalance(); }}
        />
      )}
      {showDepositModal && (
        <DepositModal
          onClose={() => setShowDepositModal(false)}
          onSuccess={() => { setShowDepositModal(false); refetchBalance(); }}
        />
      )}
    </div>
  );
}
