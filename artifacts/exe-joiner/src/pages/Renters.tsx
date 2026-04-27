import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import Navbar from '@/components/Navbar';
import { Clock, ChevronDown, ChevronUp, AlertTriangle, WifiOff } from 'lucide-react';

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${import.meta.env.BASE_URL}${path}`);
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
}

type StealInfo = {
  brainrotName: string;
  moneyPerSec: string;
  imageUrl: string | null;
};

type Renter = {
  slotNumber: number;
  username: string;
  discordId: string;
  avatar: string | null;
  purchasedAt: string | null;
  expiresAt: string | null;
  isPaused: boolean;
  pausedAt: string | null;
  stealCount: number;
  totalDeposited: number;
  bestSteal: StealInfo | null;
  otherSteals: StealInfo[];
};

function formatMs(ms: number): string {
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function fmtMoney(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B/s`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M/s`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K/s`;
  return `$${n}/s`;
}

function fmtStealVal(raw: string): string {
  const n = parseFloat(raw);
  if (isNaN(n)) return raw;
  return fmtMoney(n);
}

function useTimeLeft(expiresAt: string | null, isPaused: boolean, pausedAt: string | null) {
  const frozenMs = isPaused && expiresAt && pausedAt
    ? Math.max(0, new Date(expiresAt).getTime() - new Date(pausedAt).getTime())
    : null;

  const getMs = () => expiresAt ? Math.max(0, new Date(expiresAt).getTime() - Date.now()) : 0;
  const [ms, setMs] = useState(getMs);

  useEffect(() => {
    if (!expiresAt || isPaused) return;
    const id = setInterval(() => setMs(getMs()), 1000);
    return () => clearInterval(id);
  }, [expiresAt, isPaused]);

  if (!expiresAt) return null;
  if (isPaused && frozenMs !== null) return frozenMs === 0 ? null : formatMs(frozenMs);
  if (ms === 0) return null;
  return formatMs(ms);
}

function BrainrotImage({ imageUrl, name }: { imageUrl: string | null; name: string }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!imageUrl) return;
    setSrc(imageUrl);
  }, [imageUrl]);

  if (!src) {
    return (
      <div className="w-10 h-10 rounded-lg bg-[#f5a623]/10 border border-[#f5a623]/20 flex items-center justify-center flex-shrink-0">
        <span className="text-[#f5a623] text-xs font-bold">{name[0]?.toUpperCase()}</span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={name}
      onError={() => setSrc(null)}
      className="w-10 h-10 rounded-lg object-contain bg-black/20 flex-shrink-0"
    />
  );
}

function RenterCard({ renter, index }: { renter: Renter; index: number }) {
  const timeLeft = useTimeLeft(renter.expiresAt, renter.isPaused, renter.pausedAt);
  const [expanded, setExpanded] = useState(false);
  const hasMore = renter.otherSteals.length > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      className="rounded-2xl border border-white/[0.07] bg-[#15100a] overflow-hidden flex flex-col"
    >
      {/* Top accent bar */}
      <div className="h-0.5 w-full bg-gradient-to-r from-transparent via-[#f5a623]/50 to-transparent" />

      <div className="p-5 flex flex-col gap-5">
        {/* User row */}
        <div className="flex items-center gap-3">
          {renter.avatar ? (
            <img
              src={`https://cdn.discordapp.com/avatars/${renter.discordId}/${renter.avatar}.webp?size=80`}
              alt={renter.username}
              className="w-12 h-12 rounded-full object-cover ring-2 ring-[#f5a623]/20 flex-shrink-0"
            />
          ) : (
            <div className="w-12 h-12 rounded-full bg-[#f5a623]/10 border border-[#f5a623]/20 flex items-center justify-center flex-shrink-0">
              <span className="text-[#f5a623] font-bold text-xl">{renter.username[0]?.toUpperCase()}</span>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="font-bold text-white text-sm truncate">{renter.username}</p>
            <p className="text-[11px] text-white/30 truncate">@{renter.username.toLowerCase().replace(/\s+/g, '')}</p>
          </div>
          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            <span className="text-[9px] font-bold uppercase tracking-widest text-[#f5a623] bg-[#f5a623]/10 border border-[#f5a623]/20 px-2 py-0.5 rounded-full">
              Premium
            </span>
            {renter.isPaused ? (
              <div className="flex items-center gap-1 text-[10px] text-amber-400/70">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse inline-block" />
                Paused
              </div>
            ) : timeLeft ? (
              <div className="flex items-center gap-1 text-[10px] text-white/25">
                <Clock className="w-2.5 h-2.5" />
                {timeLeft}
              </div>
            ) : null}
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-white/[0.05]" />

        {/* Stats row */}
        <div className="flex items-center">
          <div className="flex-1 text-center">
            <p className="text-[9px] uppercase tracking-widest text-white/25 mb-1">Joins</p>
            <p className="font-extrabold text-white text-xl">{renter.stealCount}</p>
          </div>
          <div className="w-px h-8 bg-white/[0.06]" />
          <div className="flex-1 text-center">
            <p className="text-[9px] uppercase tracking-widest text-white/25 mb-1">Deposited</p>
            <p className="font-extrabold text-[#f5a623] text-xl">${renter.totalDeposited.toFixed(2)}</p>
          </div>
        </div>

        {/* Best steal */}
        {renter.bestSteal ? (
          <div className="flex flex-col gap-2">
            <p className="text-[9px] uppercase tracking-widest text-white/25 font-semibold">Best Join</p>
            <div className="flex items-center gap-3 bg-white/[0.025] rounded-xl px-3 py-2.5">
              <BrainrotImage imageUrl={renter.bestSteal.imageUrl} name={renter.bestSteal.brainrotName} />
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-white text-sm truncate">{renter.bestSteal.brainrotName}</p>
                <p className="text-xs text-[#f5a623]">{fmtStealVal(renter.bestSteal.moneyPerSec)}</p>
              </div>
            </div>

            {hasMore && (
              <>
                {expanded && (
                  <div className="flex flex-col gap-1.5">
                    {renter.otherSteals.map((s, i) => (
                      <div key={i} className="flex items-center gap-2 px-1">
                        <BrainrotImage imageUrl={s.imageUrl} name={s.brainrotName} />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-white/70 truncate">{s.brainrotName}</p>
                          <p className="text-[11px] text-white/35">{fmtStealVal(s.moneyPerSec)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <button
                  onClick={() => setExpanded(v => !v)}
                  className="flex items-center gap-1 text-[11px] text-white/30 hover:text-white/55 transition-colors self-start"
                >
                  {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  {expanded ? 'Show less' : `${renter.otherSteals.length} more join${renter.otherSteals.length > 1 ? 's' : ''}`}
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="text-center py-2">
            <p className="text-[9px] uppercase tracking-widest text-white/20 mb-1">Best Join</p>
            <p className="text-xs text-white/15">No joins yet</p>
          </div>
        )}
      </div>
    </motion.div>
  );
}

const MOCK_RENTERS: Renter[] = [
  {
    slotNumber: 1, username: '505', discordId: '905033435817586749', avatar: null,
    purchasedAt: new Date(Date.now() - 86400000).toISOString(),
    expiresAt: new Date(Date.now() + 4 * 60000).toISOString(),
    isPaused: false, pausedAt: null,
    stealCount: 5, totalDeposited: 28.00,
    bestSteal: { brainrotName: 'Burguro And Fryuro', moneyPerSec: '600000000', imageUrl: null },
    otherSteals: [
      { brainrotName: 'Bobritto Bandito', moneyPerSec: '310000000', imageUrl: null },
      { brainrotName: 'Chimpanzini Bananini', moneyPerSec: '180000000', imageUrl: null },
    ],
  },
  {
    slotNumber: 2, username: '!lucy', discordId: '111111111111111111', avatar: null,
    purchasedAt: new Date(Date.now() - 43200000).toISOString(),
    expiresAt: new Date(Date.now() + 5 * 60000).toISOString(),
    isPaused: false, pausedAt: null,
    stealCount: 4, totalDeposited: 38.00,
    bestSteal: { brainrotName: 'Ketupat Kepat', moneyPerSec: '210000000', imageUrl: null },
    otherSteals: [{ brainrotName: 'Trippi Troppi', moneyPerSec: '95000000', imageUrl: null }],
  },
  {
    slotNumber: 3, username: 'vez', discordId: '222222222222222222', avatar: null,
    purchasedAt: new Date(Date.now() - 21600000).toISOString(),
    expiresAt: new Date(Date.now() + 6 * 60000).toISOString(),
    isPaused: false, pausedAt: null,
    stealCount: 4, totalDeposited: 32.00,
    bestSteal: { brainrotName: 'Dragon Cannelloni', moneyPerSec: '250000000', imageUrl: null },
    otherSteals: [],
  },
];

export default function RentersPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['renters-public'],
    queryFn: () => apiFetch<{ renters: Renter[]; count: number }>('api/slots/renters'),
    refetchInterval: 15000,
  });

  const usingMock = !data?.renters || data.renters.length === 0;
  const renters = usingMock ? MOCK_RENTERS : data.renters;

  return (
    <div className="min-h-screen bg-[#110d08] text-white flex flex-col">
      <div className="pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(ellipse_80%_55%_at_50%_100%,hsla(30,65%,18%,0.45),transparent)]" />
      <Navbar current="renters" />

      <div className="relative z-10 max-w-5xl mx-auto w-full px-4 py-12">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-8">
          <h1 className="text-4xl md:text-5xl font-extrabold text-white mb-3">Our Renters</h1>
          <p className="text-white/40 text-sm">Live slot holders. Best join and deposits sync from the autojoiner and payments.</p>
        </motion.div>

        {/* Error banner — API unreachable */}
        {isError && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="mb-6 flex items-center gap-3 rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            <WifiOff className="w-4 h-4 flex-shrink-0" />
            <span>Could not reach the server. Showing cached data — retrying automatically.</span>
          </motion.div>
        )}

        {/* Warning banner — relay not connected / no joins in DB */}
        {!isLoading && !isError && usingMock && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="mb-6 flex items-center gap-3 rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-400">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span>No active renters found. Relay may not be connected to the database — joins won't appear until it is.</span>
          </motion.div>
        )}

        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="flex justify-center mb-10">
          <div className="rounded-2xl border border-white/10 bg-[#15100a] px-8 py-4 text-center">
            <p className="text-xs uppercase tracking-widest text-white/35 mb-1">Active</p>
            <p className="text-4xl font-extrabold text-white">{usingMock ? renters.length : (data?.count ?? 0)}</p>
          </div>
        </motion.div>

        {isLoading ? (
          <div className="text-center py-16 text-white/30 text-sm">Loading renters…</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {renters.map((r, i) => (
              <RenterCard key={r.slotNumber} renter={r} index={i} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
