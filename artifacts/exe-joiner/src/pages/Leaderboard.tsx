import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Trophy } from 'lucide-react';
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

export default function LeaderboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['leaderboard-public'],
    queryFn: () => apiFetch<{ leaderboard: LeaderEntry[] }>('api/slots/leaderboard'),
  });

  const all = data?.leaderboard ?? [];
  const bySpent = [...all].sort((a, b) => b.totalSpent - a.totalSpent);
  const byHours = [...all].sort((a, b) => b.totalHours - a.totalHours);

  const MedalIcon = ({ rank }: { rank: number }) => {
    if (rank === 1) return <span className="text-base">👑</span>;
    if (rank === 2) return <span className="text-base">🥈</span>;
    if (rank === 3) return <span className="text-base">🥉</span>;
    return <span className="font-mono text-xs text-white/30 w-5 text-center">{rank}</span>;
  };

  const AvatarEl = ({ entry }: { entry: LeaderEntry }) =>
    entry.avatar ? (
      <img
        src={`https://cdn.discordapp.com/avatars/${entry.discordId}/${entry.avatar}.png`}
        className="w-8 h-8 rounded-full flex-shrink-0"
        alt=""
      />
    ) : (
      <div className="w-8 h-8 rounded-full bg-[#f5a623]/20 border border-[#f5a623]/20 flex items-center justify-center flex-shrink-0">
        <span className="text-xs font-bold text-[#f5a623]">{entry.username[0]?.toUpperCase()}</span>
      </div>
    );

  const topCardStyle = (rank: number) =>
    rank === 1 ? 'border-[#f5a623]/30 bg-[#f5a623]/[0.07]' :
    rank === 2 ? 'border-white/10 bg-white/[0.04]' :
    'border-white/8 bg-white/[0.03]';

  const LeaderColumn = ({
    title, icon, entries, valueKey, formatValue,
  }: {
    title: string;
    icon: React.ReactNode;
    entries: LeaderEntry[];
    valueKey: 'totalSpent' | 'totalHours';
    formatValue: (v: number) => string;
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
              className={`flex items-center gap-3 px-3 md:px-4 py-2.5 md:py-3 rounded-xl border transition-colors ${
                isTop3 ? topCardStyle(rank) : 'border-white/5 bg-transparent hover:bg-white/[0.03]'
              }`}
            >
              <div className="w-5 flex items-center justify-center flex-shrink-0">
                <MedalIcon rank={rank} />
              </div>
              <AvatarEl entry={entry} />
              <div className="flex-1 min-w-0">
                <p className="text-xs md:text-sm font-semibold text-white/90 truncate leading-tight">
                  {entry.username}
                </p>
                <p className={`text-xs font-mono font-semibold ${rank === 1 ? 'text-[#f5a623]' : 'text-[#f5a623]/60'}`}>
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
    <div className="min-h-screen bg-[#0e0e10] text-white flex flex-col">
      <Navbar current="leaderboard" />
      <div className="max-w-3xl mx-auto w-full px-4 py-10">
        <div className="mb-8 flex items-center gap-3">
          <Trophy className="w-6 h-6 text-[#f5a623]" />
          <div>
            <h1 className="text-2xl font-bold text-white leading-tight">Leaderboard</h1>
            <p className="text-sm text-white/35">All-time top Exe Joiner users</p>
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-24">
            <div className="w-6 h-6 border-2 border-[#f5a623] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="flex gap-4 md:gap-6">
            <LeaderColumn
              title="Most Deposited"
              icon={<span className="text-[#f5a623] font-bold text-sm">$</span>}
              entries={bySpent}
              valueKey="totalSpent"
              formatValue={(v) => `$${v.toFixed(2)}`}
            />
            <LeaderColumn
              title="Most Hours"
              icon={<Trophy className="w-3.5 h-3.5 text-[#f5a623]" />}
              entries={byHours}
              valueKey="totalHours"
              formatValue={(v) => `${v}h`}
            />
          </div>
        )}
      </div>
    </div>
  );
}
