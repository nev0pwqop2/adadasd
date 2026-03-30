import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import Navbar from '@/components/Navbar';
import { Zap, Shield, Clock, RefreshCw } from 'lucide-react';
import { useGetMe } from '@workspace/api-client-react';

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${import.meta.env.BASE_URL}${path}`);
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
}

type PublicSettings = {
  slotCount: number;
  pricePerDay: number;
  slotDurationHours: number;
  hourlyPricingEnabled: boolean;
  pricePerHour: number;
  minHours: number;
  activeCount: number;
};

type BidsRes = {
  bids: { id: number; amount: number; username: string; discordId: string; avatar: string | null }[];
  myBid: null;
  topPreorderAmount: number | null;
};

function NextSlotTimer({ nextExpiresAt }: { nextExpiresAt: string | null }) {
  const getMs = () => nextExpiresAt ? Math.max(0, new Date(nextExpiresAt).getTime() - Date.now()) : 0;
  const [ms, setMs] = useState(getMs);
  useEffect(() => {
    if (!nextExpiresAt) return;
    const id = setInterval(() => setMs(getMs()), 1000);
    return () => clearInterval(id);
  }, [nextExpiresAt]);
  if (!nextExpiresAt) return <span className="text-white/30 text-xs">—</span>;
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return (
    <span className="font-mono font-bold text-[#f5a623]">
      {String(m).padStart(2, '0')}:{String(s).padStart(2, '0')}
    </span>
  );
}

export default function PlansPage() {
  const { data: user } = useGetMe({ query: { retry: false } as any });
  const isLoggedIn = !!user;
  const loginUrl = `${import.meta.env.BASE_URL}api/auth/discord`;

  const { data, isLoading } = useQuery({
    queryKey: ['public-settings'],
    queryFn: () => apiFetch<PublicSettings>('api/slots/public-settings'),
    refetchInterval: 10000,
  });

  const { data: slotsData } = useQuery({
    queryKey: ['slots-public'],
    queryFn: () => apiFetch<{ slots: any[]; totalSlots: number; nextExpiresAt: string | null; hourlyPricingEnabled: boolean; pricePerHour: number; minHours: number; pricePerDay: number; slotDurationHours: number }>('api/slots'),
    refetchInterval: 5000,
    retry: false,
  });

  const { data: bidsPublic } = useQuery({
    queryKey: ['bids-public'],
    queryFn: () => apiFetch<BidsRes>('api/bids'),
    refetchInterval: 5000,
    retry: false,
  });

  const filled = data?.activeCount ?? 0;
  const total = data?.slotCount ?? 0;
  const available = total - filled;
  const allFull = filled >= total && total > 0;
  const fillPct = total > 0 ? (filled / total) * 100 : 0;
  const nextExpiresAt = slotsData?.nextExpiresAt ?? null;
  const topBid = bidsPublic?.bids?.[0]?.amount ?? null;
  const base = import.meta.env.BASE_URL;

  const features = [
    { icon: <Zap className="w-3.5 h-3.5" />, text: 'Instant script key via Discord DM' },
    { icon: <Shield className="w-3.5 h-3.5" />, text: 'Luarmor HWID-locked key' },
    { icon: <RefreshCw className="w-3.5 h-3.5" />, text: 'HWID reset in dashboard' },
    { icon: <Clock className="w-3.5 h-3.5" />, text: 'Auto-expired cleanly' },
  ];

  return (
    <div className="min-h-screen bg-[#0a0a08] text-white flex flex-col">
      <div className="pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(ellipse_70%_50%_at_50%_80%,hsla(30,65%,20%,0.3),transparent)]" />
      <Navbar current="plans" />

      <div className="relative z-10 max-w-3xl mx-auto w-full px-4 py-12">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-10">
          <h1 className="text-4xl md:text-5xl font-extrabold text-white mb-3">Choose Your Plan</h1>
          <p className="text-white/40 text-sm max-w-md mx-auto">
            Rent a slot and get your script key the moment you pay. All plans include instant delivery.
          </p>
        </motion.div>

        {isLoading ? (
          <div className="flex justify-center py-20">
            <div className="w-6 h-6 border-2 border-[#f5a623] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="grid grid-cols-1 md:grid-cols-2 gap-4"
          >

            {/* ── Premium Card ── */}
            <div className="rounded-2xl border border-[#f5a623]/25 bg-[#13110a] p-6 flex flex-col">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-[#f5a623]/70 mb-1 block">Most Popular</span>
                  <h2 className="text-2xl font-extrabold text-white">Premium</h2>
                </div>
                {available > 0 ? (
                  <span className="text-[10px] font-semibold px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex-shrink-0 mt-1">
                    {available} open
                  </span>
                ) : (
                  <span className="text-[10px] font-semibold px-2.5 py-1 rounded-full bg-red-500/10 text-red-400 border border-red-500/20 flex-shrink-0 mt-1">
                    Full
                  </span>
                )}
              </div>

              {/* Slots bar */}
              <div className="mb-5">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs text-white/40">Slots {filled}/{total}</span>
                </div>
                <div className="h-1.5 rounded-full bg-white/8 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[#f5a623] transition-all duration-500"
                    style={{ width: `${fillPct}%` }}
                  />
                </div>
              </div>

              {/* Features */}
              <ul className="space-y-2.5 mb-6 flex-1">
                {features.map(({ icon, text }) => (
                  <li key={text} className="flex items-center gap-2.5 text-sm text-white/60">
                    <span className="text-[#f5a623]">{icon}</span>
                    {text}
                  </li>
                ))}
              </ul>

              {/* Price */}
              <div className="mb-5">
                <p className="text-[11px] uppercase tracking-widest text-white/30 mb-1">Price</p>
                {data?.hourlyPricingEnabled ? (
                  <div className="flex items-end gap-1">
                    <span className="text-4xl font-extrabold text-white">${data.pricePerHour.toFixed(2)}</span>
                    <span className="text-white/40 mb-1">/hr</span>
                  </div>
                ) : (
                  <div className="flex items-end gap-1">
                    <span className="text-4xl font-extrabold text-white">${data?.pricePerDay.toFixed(2)}</span>
                    <span className="text-white/40 mb-1">/{data?.slotDurationHours}h</span>
                  </div>
                )}
              </div>

              {!isLoggedIn ? (
                <a
                  href={loginUrl}
                  className="block w-full text-center font-bold text-sm py-3 rounded-xl transition-all bg-[#f5a623] text-black hover:bg-[#e8961a]"
                >
                  Login to buy
                </a>
              ) : (
                <a
                  href={`${base}dashboard`}
                  className={`block w-full text-center font-bold text-sm py-3 rounded-xl transition-all ${
                    allFull
                      ? 'bg-white/8 text-white/30 cursor-not-allowed pointer-events-none'
                      : 'bg-[#f5a623] text-black hover:bg-[#e8961a]'
                  }`}
                >
                  {allFull ? 'All slots full' : 'Get a slot'}
                </a>
              )}
            </div>

            {/* ── Bid Slot Card ── */}
            <div className="rounded-2xl border border-white/10 bg-[#13110a] p-6 flex flex-col">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-white/40 mb-1 block">Bid Slot</span>
                  <h2 className="text-2xl font-extrabold text-white">Bid</h2>
                </div>
                {nextExpiresAt && (
                  <div className="text-right flex-shrink-0 mt-1">
                    <div className="text-xl leading-none">
                      <NextSlotTimer nextExpiresAt={nextExpiresAt} />
                    </div>
                    <span className="text-[10px] text-white/30 uppercase tracking-wider">Next slot</span>
                  </div>
                )}
              </div>

              {/* Slots bar */}
              <div className="mb-5">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs text-white/40">Slots {filled}/{total} · {data?.hourlyPricingEnabled ? `min ${data.minHours}h` : `${data?.slotDurationHours}h`} access when you win</span>
                </div>
                <div className="h-1.5 rounded-full bg-white/8 overflow-hidden">
                  <div className="h-full rounded-full bg-[#f5a623] w-full" />
                </div>
              </div>

              {/* Bid info box */}
              <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3.5 mb-5 flex-1">
                <p className="text-xs text-white/50 mb-1">
                  {filled}/{total} slot(s) taken &middot; bid for the next
                </p>
                <p className="text-xs text-white/30">Place a bid to start 1-minute countdown</p>
              </div>

              {/* Minimum bid */}
              <div className="mb-5">
                <p className="text-[11px] uppercase tracking-widest text-white/30 mb-1">Minimum bid (per hour)</p>
                {data?.hourlyPricingEnabled ? (
                  <div>
                    <div className="flex items-end gap-1">
                      <span className="text-4xl font-extrabold text-white">${data.pricePerHour.toFixed(2)}</span>
                      <span className="text-white/40 mb-1">/hr</span>
                    </div>
                    <p className="text-xs text-white/30 mt-1">
                      Win the slot: pay ${(data.pricePerHour * data.minHours).toFixed(2)} total ({data.minHours}h × rate)
                    </p>
                  </div>
                ) : (
                  <div className="flex items-end gap-1">
                    <span className="text-4xl font-extrabold text-white">${data?.pricePerDay.toFixed(2)}</span>
                    <span className="text-white/40 mb-1">/{data?.slotDurationHours}h</span>
                  </div>
                )}
                {topBid !== null && (
                  <p className="text-xs text-[#f5a623]/70 mt-1.5">Top bid: ${topBid.toFixed(2)}</p>
                )}
              </div>

              <p className="text-xs text-white/35 mb-4">
                {allFull ? 'All slots are full — bidding opens when a slot expires.' : 'Slots available — bid to join the queue.'}
              </p>

              {!isLoggedIn ? (
                <a
                  href={loginUrl}
                  className="block w-full text-center font-bold text-sm py-3 rounded-xl border border-[#f5a623]/30 text-[#f5a623] bg-[#f5a623]/8 hover:bg-[#f5a623]/15 transition-all"
                >
                  Login to buy
                </a>
              ) : (
                <a
                  href={`${base}dashboard`}
                  className="block w-full text-center font-bold text-sm py-3 rounded-xl border border-[#f5a623]/30 text-[#f5a623] bg-[#f5a623]/8 hover:bg-[#f5a623]/15 transition-all"
                >
                  Place a bid
                </a>
              )}
            </div>

          </motion.div>
        )}

        {/* Pay methods */}
        <p className="text-center text-xs text-white/25 mt-6">
          Pay with Stripe · Crypto (BTC, ETH, LTC, USDT, SOL) · Wallet balance
        </p>
      </div>
    </div>
  );
}
