import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import Navbar from '@/components/Navbar';

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${import.meta.env.BASE_URL}${path}`);
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
}

type StealEntry = { brainrotName: string; moneyPerSec: string; imageUrl: string | null };

type LeaderEntry = {
  username: string;
  discordId: string;
  avatar: string | null;
  stealCount: number;
  bestStealMoneyPerSec: string | null;
  bestStealName: string | null;
  bestStealImageUrl: string | null;
  topSteals: StealEntry[];
  totalDeposited: number;
};

type Tab = 'steals' | 'best' | 'deposits';

const TABS: { id: Tab; label: string; sub: string }[] = [
  { id: 'steals', label: 'By steals', sub: 'Ranked by total successful steals.' },
  { id: 'best', label: 'By best steal', sub: 'Ranked by brainrot tier, then highest $/s.' },
  { id: 'deposits', label: 'By deposits', sub: 'Ranked by lifetime USD deposited.' },
];

function fmtMoney(raw: string | null): string {
  if (!raw) return '—';
  const n = parseFloat(raw);
  if (isNaN(n)) return raw;
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T/s`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B/s`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M/s`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K/s`;
  return `$${n}/s`;
}

function sortedBy(entries: LeaderEntry[], tab: Tab): LeaderEntry[] {
  return [...entries].sort((a, b) => {
    if (tab === 'steals') return b.stealCount - a.stealCount;
    if (tab === 'deposits') return b.totalDeposited - a.totalDeposited;
    const av = parseFloat(a.bestStealMoneyPerSec ?? '0') || 0;
    const bv = parseFloat(b.bestStealMoneyPerSec ?? '0') || 0;
    return bv - av;
  });
}

function Avatar({ entry, size = 'md' }: { entry: LeaderEntry; size?: 'sm' | 'md' | 'lg' }) {
  const cls = size === 'lg' ? 'w-16 h-16 text-2xl' : size === 'md' ? 'w-11 h-11 text-base' : 'w-8 h-8 text-xs';
  return entry.avatar ? (
    <img
      src={`https://cdn.discordapp.com/avatars/${entry.discordId}/${entry.avatar}.webp?size=128`}
      className={`${cls} rounded-full object-cover ring-2 ring-white/15 flex-shrink-0`}
      alt={entry.username}
    />
  ) : (
    <div className={`${cls} rounded-full bg-[#f5a623]/10 border border-[#f5a623]/20 flex items-center justify-center flex-shrink-0 font-bold text-[#f5a623]`}>
      {entry.username[0]?.toUpperCase()}
    </div>
  );
}

function BrainrotImg({ imageUrl, name, small }: { imageUrl: string | null; name: string; small?: boolean }) {
  const [src, setSrc] = useState<string | null>(imageUrl);
  const cls = small ? 'w-9 h-9' : 'w-11 h-11';
  if (!src) {
    return (
      <div className={`${cls} rounded-lg bg-[#f5a623]/10 border border-[#f5a623]/15 flex items-center justify-center flex-shrink-0`}>
        <span className="text-[#f5a623] font-bold text-xs">{name[0]?.toUpperCase()}</span>
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={name}
      onError={() => setSrc(null)}
      className={`${cls} rounded-lg object-contain bg-black/20 flex-shrink-0`}
    />
  );
}

function RankBadge({ rank }: { rank: number }) {
  const map: Record<number, string> = { 1: '1ST', 2: '2ND', 3: '3RD' };
  const color =
    rank === 1 ? 'bg-[#f5a623] text-black' :
    rank === 2 ? 'bg-white/15 text-white/80' :
    'bg-white/10 text-white/60';
  return (
    <span className={`text-[10px] font-extrabold tracking-widest px-2 py-0.5 rounded-full ${color}`}>
      {map[rank] ?? `#${rank}`}
    </span>
  );
}

function PodiumCard({ entry, rank, tab, isCenter }: { entry: LeaderEntry; rank: number; tab: Tab; isCenter: boolean }) {
  const nameColor = rank === 1 ? 'text-[#f5a623]' : 'text-white';
  const borderColor = rank === 1 ? 'border-[#f5a623]/30' : 'border-white/[0.07]';
  const topGlow = rank === 1 ? 'via-[#f5a623]/40' : 'via-white/10';

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: rank === 1 ? 0 : 0.08 }}
      className={`rounded-2xl border ${borderColor} bg-[#15100a] overflow-hidden flex flex-col ${isCenter ? 'z-10' : ''}`}
    >
      {/* Top bar */}
      <div className={`h-0.5 w-full bg-gradient-to-r from-transparent ${topGlow} to-transparent`} />

      {/* Banner area */}
      <div
        className="relative h-16 flex-shrink-0"
        style={{ background: rank === 1 ? 'linear-gradient(135deg,#3a1f00,#1a0e00)' : 'linear-gradient(135deg,#1a1208,#110d08)' }}
      >
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-[#15100a]/80" />
        <div className="absolute bottom-0 left-0 right-0 flex justify-center translate-y-1/2">
          <div className="relative">
            <Avatar entry={entry} size="lg" />
            <div className="absolute -top-2 left-1/2 -translate-x-1/2">
              <RankBadge rank={rank} />
            </div>
          </div>
        </div>
      </div>

      <div className="pt-10 px-4 pb-4 flex flex-col gap-3">
        {/* Name */}
        <div className="text-center">
          <p className={`font-bold text-base ${nameColor} truncate`}>{entry.username}</p>
          <p className="text-[11px] text-white/30">@{entry.username.toLowerCase().replace(/\s+/g, '')}</p>
        </div>

        {/* Stats row */}
        <div className="flex items-start justify-between text-center gap-1">
          <div className="flex-1">
            <p className="text-lg font-extrabold text-[#4ade80]">{entry.stealCount}</p>
            <p className="text-[9px] uppercase tracking-widest text-white/30">Stolen</p>
          </div>
          <div className="flex-1">
            <p className="text-sm font-bold text-white truncate">{fmtMoney(entry.bestStealMoneyPerSec)}</p>
            <p className="text-[9px] uppercase tracking-widest text-white/30">Best $/s</p>
          </div>
          <div className="flex-1">
            <p className="text-sm font-bold text-white">${entry.totalDeposited.toFixed(2)}</p>
            <p className="text-[9px] uppercase tracking-widest text-white/30">Deposited</p>
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-white/[0.05]" />

        {/* Top steals */}
        <div>
          <p className="text-[9px] uppercase tracking-widest text-white/25 mb-2">Top Steals</p>
          {entry.topSteals.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              {/* Best steal — larger */}
              <div className="flex items-center gap-2 bg-white/[0.025] rounded-xl px-2.5 py-2">
                <BrainrotImg imageUrl={entry.topSteals[0].imageUrl} name={entry.topSteals[0].brainrotName} />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-white truncate">{entry.topSteals[0].brainrotName}</p>
                  <p className="text-[11px] text-[#f5a623]">{fmtMoney(entry.topSteals[0].moneyPerSec)}</p>
                </div>
              </div>
              {/* Rest as small thumbnails */}
              {entry.topSteals.length > 1 && (
                <div className="flex gap-1.5 flex-wrap">
                  {entry.topSteals.slice(1).map((s, i) => (
                    <div key={i} className="flex items-center gap-1.5 bg-white/[0.02] rounded-lg px-2 py-1.5 flex-1 min-w-0">
                      <BrainrotImg imageUrl={s.imageUrl} name={s.brainrotName} small />
                      <div className="min-w-0">
                        <p className="text-[10px] text-white/70 truncate">{s.brainrotName.split(' ')[0]}…</p>
                        <p className="text-[10px] text-[#f5a623]/80">{fmtMoney(s.moneyPerSec)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-white/20 text-center py-2">No steals yet</p>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function LeaderRow({ entry, rank, tab }: { entry: LeaderEntry; rank: number; tab: Tab }) {
  const value =
    tab === 'steals' ? `${entry.stealCount} steals` :
    tab === 'deposits' ? `$${entry.totalDeposited.toFixed(2)}` :
    fmtMoney(entry.bestStealMoneyPerSec);

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: (rank - 4) * 0.03 }}
      className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-white/[0.04] hover:bg-white/[0.03] transition-colors"
    >
      <span className="font-mono text-xs text-white/25 w-5 text-right flex-shrink-0">#{rank}</span>
      <Avatar entry={entry} size="sm" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-white/85 truncate">{entry.username}</p>
        <p className="text-[11px] text-white/30 truncate">@{entry.username.toLowerCase().replace(/\s+/g, '')}</p>
      </div>
      {entry.topSteals[0] && (
        <div className="hidden sm:flex items-center gap-1.5 flex-shrink-0">
          <BrainrotImg imageUrl={entry.topSteals[0].imageUrl} name={entry.topSteals[0].brainrotName} small />
          <span className="text-xs text-white/40 truncate max-w-[100px]">{entry.topSteals[0].brainrotName}</span>
        </div>
      )}
      <span className="font-semibold text-sm text-[#f5a623] flex-shrink-0">{value}</span>
    </motion.div>
  );
}

const MOCK: LeaderEntry[] = [
  {
    username: 'Reece', discordId: '111', avatar: null, stealCount: 167,
    bestStealMoneyPerSec: '2638000000', bestStealName: 'Cerberus', bestStealImageUrl: null,
    topSteals: [
      { brainrotName: 'Cerberus', moneyPerSec: '2638000000', imageUrl: null },
      { brainrotName: 'Cerberus', moneyPerSec: '2458000000', imageUrl: null },
      { brainrotName: 'Cerberus', moneyPerSec: '2278000000', imageUrl: null },
    ],
    totalDeposited: 1186.00,
  },
  {
    username: 'Huu Phuong', discordId: '222', avatar: null, stealCount: 362,
    bestStealMoneyPerSec: '2020000000', bestStealName: 'Burguro And Fryuro', bestStealImageUrl: null,
    topSteals: [
      { brainrotName: 'Burguro And Fryuro', moneyPerSec: '2020000000', imageUrl: null },
      { brainrotName: 'Burguro And Fryuro', moneyPerSec: '1958000000', imageUrl: null },
    ],
    totalDeposited: 910.84,
  },
  {
    username: 'izy', discordId: '333', avatar: null, stealCount: 140,
    bestStealMoneyPerSec: '375000000', bestStealName: 'La Lucky Grande', bestStealImageUrl: null,
    topSteals: [
      { brainrotName: 'La Lucky Grande', moneyPerSec: '375000000', imageUrl: null },
    ],
    totalDeposited: 793.20,
  },
  {
    username: 'moneykept', discordId: '444', avatar: null, stealCount: 59,
    bestStealMoneyPerSec: '5400000000', bestStealName: 'Skibidi Toilet', bestStealImageUrl: null,
    topSteals: [
      { brainrotName: 'Skibidi Toilet', moneyPerSec: '5400000000', imageUrl: null },
      { brainrotName: 'Cerberus', moneyPerSec: '1498000000', imageUrl: null },
    ],
    totalDeposited: 656.00,
  },
  {
    username: 'hax', discordId: '555', avatar: null, stealCount: 109,
    bestStealMoneyPerSec: '4950000000', bestStealName: 'Meowl', bestStealImageUrl: null,
    topSteals: [
      { brainrotName: 'Meowl', moneyPerSec: '4950000000', imageUrl: null },
      { brainrotName: 'Ketupat Bros', moneyPerSec: '4138000000', imageUrl: null },
    ],
    totalDeposited: 1172.50,
  },
];

export default function LeaderboardPage() {
  const [tab, setTab] = useState<Tab>('steals');

  const { data, isLoading } = useQuery({
    queryKey: ['leaderboard-public'],
    queryFn: () => apiFetch<{ leaderboard: LeaderEntry[] }>('api/slots/leaderboard'),
    refetchInterval: 30000,
  });

  const raw = data?.leaderboard ?? [];
  const entries = sortedBy(raw.length ? raw : MOCK, tab);
  const top3 = entries.slice(0, 3);
  const rest = entries.slice(3);

  const podiumOrder = top3.length >= 2
    ? [top3[1], top3[0], top3[2]].filter(Boolean)
    : top3;

  return (
    <div className="min-h-screen bg-[#110d08] text-white flex flex-col">
      <div className="pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(ellipse_80%_55%_at_50%_100%,hsla(30,65%,18%,0.45),transparent)]" />
      <Navbar current="leaderboard" />

      <div className="relative z-10 max-w-5xl mx-auto w-full px-4 py-10">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <h1 className="text-4xl md:text-5xl font-extrabold text-white mb-2">Leaderboard</h1>
          <p className="text-white/35 text-sm">See the top users on Exe Joiner.</p>
        </motion.div>

        {/* Tabs */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
          className="grid grid-cols-3 gap-2 mb-10 rounded-2xl border border-white/[0.07] bg-[#15100a] p-2"
        >
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-xl px-3 py-3 text-left transition-all ${tab === t.id
                ? 'bg-[#f5a623]/15 border border-[#f5a623]/25'
                : 'hover:bg-white/[0.03] border border-transparent'
              }`}
            >
              <p className={`text-sm font-semibold ${tab === t.id ? 'text-[#f5a623]' : 'text-white/60'}`}>{t.label}</p>
              <p className="text-[11px] text-white/30 mt-0.5 leading-snug">{t.sub}</p>
            </button>
          ))}
        </motion.div>

        {isLoading ? (
          <div className="text-center py-20 text-white/30 text-sm">Loading leaderboard…</div>
        ) : (
          <AnimatePresence mode="wait">
            <motion.div key={tab} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
              {/* TOP 3 */}
              {top3.length > 0 && (
                <div className="mb-8">
                  <p className="text-[11px] uppercase tracking-widest text-white/25 text-center mb-4">Top 3</p>
                  <div className={`grid gap-3 items-end ${top3.length === 1 ? 'max-w-xs mx-auto' : top3.length === 2 ? 'grid-cols-2 max-w-lg mx-auto' : 'grid-cols-3'}`}>
                    {top3.length >= 3 ? (
                      <>
                        {/* 2nd — left, shorter */}
                        <div className="mt-6">
                          <PodiumCard entry={top3[1]} rank={2} tab={tab} isCenter={false} />
                        </div>
                        {/* 1st — center, tallest */}
                        <div>
                          <PodiumCard entry={top3[0]} rank={1} tab={tab} isCenter={true} />
                        </div>
                        {/* 3rd — right, shorter */}
                        <div className="mt-10">
                          <PodiumCard entry={top3[2]} rank={3} tab={tab} isCenter={false} />
                        </div>
                      </>
                    ) : top3.map((e, i) => (
                      <PodiumCard key={e.discordId} entry={e} rank={i + 1} tab={tab} isCenter={i === 0} />
                    ))}
                  </div>
                </div>
              )}

              {/* Rest */}
              {rest.length > 0 && (
                <div className="flex flex-col gap-1">
                  {rest.map((e, i) => (
                    <LeaderRow key={e.discordId} entry={e} rank={i + 4} tab={tab} />
                  ))}
                </div>
              )}

              {entries.length === 0 && (
                <div className="text-center py-20 text-white/20 text-sm">No entries yet.</div>
              )}
            </motion.div>
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}
