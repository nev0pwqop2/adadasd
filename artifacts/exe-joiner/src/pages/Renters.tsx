import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import Navbar from '@/components/Navbar';
import { Clock } from 'lucide-react';

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${import.meta.env.BASE_URL}${path}`);
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
}

type Renter = {
  slotNumber: number;
  username: string;
  discordId: string;
  avatar: string | null;
  purchasedAt: string | null;
  expiresAt: string | null;
};

function useTimeLeft(expiresAt: string | null) {
  const getMs = () => expiresAt ? Math.max(0, new Date(expiresAt).getTime() - Date.now()) : 0;
  const [ms, setMs] = useState(getMs);
  useEffect(() => {
    if (!expiresAt) return;
    const id = setInterval(() => setMs(getMs()), 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  if (!expiresAt || ms === 0) return null;
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function RenterCard({ renter, index }: { renter: Renter; index: number }) {
  const timeLeft = useTimeLeft(renter.expiresAt);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      className="rounded-2xl border border-white/8 bg-[#15100a] p-5 flex flex-col gap-4"
    >
      {/* Header row */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-widest text-[#f5a623] bg-[#f5a623]/10 border border-[#f5a623]/20 px-2.5 py-1 rounded-full">
          Premium
        </span>
        {timeLeft && (
          <div className="flex items-center gap-1 text-xs text-white/35">
            <Clock className="w-3 h-3" />
            <span>Ends in {timeLeft}</span>
          </div>
        )}
      </div>

      {/* User row */}
      <div className="flex items-center gap-3">
        {renter.avatar ? (
          <img
            src={`https://cdn.discordapp.com/avatars/${renter.discordId}/${renter.avatar}.webp?size=64`}
            alt={renter.username}
            className="w-12 h-12 rounded-full object-cover ring-2 ring-white/8 flex-shrink-0"
          />
        ) : (
          <div className="w-12 h-12 rounded-full bg-[#f5a623]/15 border border-[#f5a623]/20 flex items-center justify-center flex-shrink-0">
            <span className="text-[#f5a623] font-bold text-lg">{renter.username[0]?.toUpperCase()}</span>
          </div>
        )}
        <div className="min-w-0">
          <p className="font-bold text-white text-base truncate">{renter.username}</p>
          <p className="text-xs text-white/35 truncate">@{renter.username.toLowerCase().replace(/\s+/g, '')}</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-white/[0.03] border border-white/5 px-3 py-2.5">
          <p className="text-[10px] uppercase tracking-widest text-white/30 mb-0.5">Slot</p>
          <p className="font-bold text-white text-sm">#{String(renter.slotNumber).padStart(2, '0')}</p>
        </div>
        <div className="rounded-xl bg-white/[0.03] border border-white/5 px-3 py-2.5">
          <p className="text-[10px] uppercase tracking-widest text-white/30 mb-0.5">Since</p>
          <p className="font-bold text-white text-sm">
            {renter.purchasedAt ? new Date(renter.purchasedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
          </p>
        </div>
      </div>
    </motion.div>
  );
}

export default function RentersPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['renters-public'],
    queryFn: () => apiFetch<{ renters: Renter[]; count: number }>('api/slots/renters'),
    refetchInterval: 10000,
  });

  const renters = data?.renters ?? [];

  return (
    <div className="min-h-screen bg-[#110d08] text-white flex flex-col">
      <div className="pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(ellipse_80%_55%_at_50%_100%,hsla(30,65%,18%,0.45),transparent)]" />
      <Navbar current="renters" />

      <div className="relative z-10 max-w-4xl mx-auto w-full px-4 py-12">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-8">
          <h1 className="text-4xl md:text-5xl font-extrabold text-white mb-3">Our Renters</h1>
          <p className="text-white/40 text-sm">Active slots.</p>
        </motion.div>

        {/* Active count */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="flex justify-center mb-10">
          <div className="rounded-2xl border border-white/10 bg-[#15100a] px-8 py-4 text-center">
            <p className="text-xs uppercase tracking-widest text-white/35 mb-1">Active renters</p>
            <p className="text-4xl font-extrabold text-white">{data?.count ?? 0}</p>
          </div>
        </motion.div>

        {renters.length === 0 ? (
          <div className="text-center py-16 text-white/30 text-sm">No active renters right now.</div>
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
