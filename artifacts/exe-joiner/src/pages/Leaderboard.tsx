import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import Navbar from '@/components/Navbar';

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${import.meta.env.BASE_URL}${path}`);
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
}

type LeaderEntry = {
  rank: number;
  username: string;
  discordId: string;
  avatar: string | null;
  totalSpent: number;
  totalHours: number;
};

function AvatarEl({ entry }: { entry: LeaderEntry }) {
  return entry.avatar ? (
    <img
      src={`https://cdn.discordapp.com/avatars/${entry.discordId}/${entry.avatar}.webp?size=64`}
      className="w-8 h-8 rounded-full flex-shrink-0 object-cover"
      alt=""
    />
  ) : (
    <div className="w-8 h-8 rounded-full bg-[#f5a623]/15 border border-[#f5a623]/20 flex items-center justify-center flex-shrink-0">
      <span className="text-xs font-bold text-[#f5a623]">{entry.username[0]?.toUpperCase()}</span>
    </div>
  );
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <span className="text-base flex-shrink-0">🥇</span>;
  if (rank === 2) return <span className="text-base flex-shrink-0">🥈</span>;
  if (rank === 3) return <span className="text-base flex-shrink-0">🥉</span>;
  return <span className="font-mono text-xs text-white/30 w-5 text-center flex-shrink-0">#{rank}</span>;
}

function LeaderRow({
  entry, rank, value, isFirst
}: { entry: LeaderEntry; rank: number; value: string; isFirst: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: rank * 0.025 }}
      className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-colors ${
        rank === 1 ? 'border-[#f5a623]/30 bg-[#f5a623]/[0.07]' :
        rank === 2 ? 'border-white/10 bg-white/[0.04]' :
        rank === 3 ? 'border-white/8 bg-white/[0.03]' :
        'border-transparent hover:bg-white/[0.03]'
      }`}
    >
      <RankBadge rank={rank} />
      <AvatarEl entry={entry} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-white/90 truncate leading-tight">{entry.username}</p>
        <p className="text-xs text-white/35 truncate">@{entry.username.toLowerCase().replace(/\s+/g, '')}</p>
      </div>
      <span className={`font-mono text-sm font-bold flex-shrink-0 ${rank === 1 ? 'text-[#f5a623]' : 'text-[#f5a623]/60'}`}>
        {value}
      </span>
    </motion.div>
  );
}

export default function LeaderboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['leaderboard-public'],
    queryFn: () => apiFetch<{ leaderboard: LeaderEntry[] }>('api/slots/leaderboard'),
    refetchInterval: 30000,
  });

  const all = data?.leaderboard ?? [];
  const bySpent = [...all].sort((a, b) => b.totalSpent - a.totalSpent).slice(0, 10);
  const byHours = [...all].sort((a, b) => b.totalHours - a.totalHours).slice(0, 10);
  const combined = all.slice(0, 10);

  return (
    <div className="min-h-screen bg-[#110d08] text-white flex flex-col">
      <div className="pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(ellipse_80%_55%_at_50%_100%,hsla(30,65%,18%,0.45),transparent)]" />
      <Navbar current="leaderboard" />

      <div className="relative z-10 max-w-5xl mx-auto w-full px-4 py-12">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-10">
          <h1 className="text-4xl md:text-5xl font-extrabold text-white mb-3">Leaderboard</h1>
          <p className="text-white/35 text-sm max-w-md mx-auto">
            Top depositors and most active renters. Stats come from completed payments and slot history.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">

            {/* Most Hours */}
            <div>
              <div className="mb-3">
                <p className="font-bold text-white/80 text-sm">Most Hours</p>
                <p className="text-xs text-white/35">Total rental time</p>
              </div>
              <div className="space-y-2">
                {byHours.length === 0 && <p className="text-white/20 text-sm text-center py-10">No entries yet</p>}
                {byHours.map((e, i) => (
                  <LeaderRow key={e.discordId + '-h'} entry={e} rank={i + 1} value={`${e.totalHours}h`} isFirst={i === 0} />
                ))}
              </div>
            </div>

            {/* Top Depositors (center) */}
            <div>
              <div className="mb-3">
                <p className="font-bold text-white/80 text-sm">Top Deposits</p>
                <p className="text-xs text-white/35">Lifetime total deposited (USD)</p>
              </div>
              <div className="space-y-2">
                {bySpent.length === 0 && <p className="text-white/20 text-sm text-center py-10">No entries yet</p>}
                {bySpent.map((e, i) => (
                  <LeaderRow key={e.discordId + '-s'} entry={e} rank={i + 1} value={`$${e.totalSpent.toFixed(2)}`} isFirst={i === 0} />
                ))}
              </div>
            </div>

            {/* Most Active (by combined score) */}
            <div>
              <div className="mb-3">
                <p className="font-bold text-white/80 text-sm">Most Active</p>
                <p className="text-xs text-white/35">Hours + deposit combined</p>
              </div>
              <div className="space-y-2">
                {combined.length === 0 && <p className="text-white/20 text-sm text-center py-10">No entries yet</p>}
                {combined.map((e, i) => (
                  <LeaderRow key={e.discordId + '-c'} entry={e} rank={i + 1} value={`${e.totalHours}h`} isFirst={i === 0} />
                ))}
              </div>
            </div>

        </div>
      </div>
    </div>
  );
}
