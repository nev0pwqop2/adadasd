import React, { useState, useEffect } from 'react';
import { Clock, Copy, Check, Pause } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface PublicSlot {
  slotNumber: number;
  isActive: boolean;
  isOwner: boolean;
  owner: { username: string; discordId: string; avatar: string | null } | null;
  id: number | null;
  purchasedAt: string | null;
  expiresAt: string | null;
  label: string | null;
  scriptKey?: string | null;
  script?: string | null;
  hwidResetAt?: string | null;
  hwidUnlimited?: boolean;
  luarmorUserId?: string | null;
  isPaused?: boolean;
  pausedAt?: string | null;
}

interface SlotCardProps {
  slotData: PublicSlot;
  onPurchase: (slotNumber: number) => void;
  onManage: (slot: PublicSlot) => void;
}

function formatMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h ${String(m).padStart(2, '0')}m`;
  return `${h}h ${String(m).padStart(2, '0')}m ${String(sec).padStart(2, '0')}s`;
}

function useTimeLeft(expiresAt: string | null, pausedAt: string | null | undefined) {
  const getMs = () => expiresAt ? Math.max(0, new Date(expiresAt).getTime() - Date.now()) : 0;
  const [ms, setMs] = useState(getMs);
  useEffect(() => {
    if (!expiresAt || pausedAt) return;
    const id = setInterval(() => setMs(getMs()), 1000);
    return () => clearInterval(id);
  }, [expiresAt, pausedAt]);

  if (!expiresAt) return null;
  if (pausedAt) {
    const frozenMs = Math.max(0, new Date(expiresAt).getTime() - new Date(pausedAt).getTime());
    return frozenMs === 0 ? null : formatMs(frozenMs);
  }
  return ms === 0 ? null : formatMs(ms);
}

function Avatar({ owner, size = 56 }: { owner: PublicSlot['owner']; size?: number }) {
  if (owner?.avatar) {
    return (
      <img
        src={`https://cdn.discordapp.com/avatars/${owner.discordId}/${owner.avatar}.webp?size=128`}
        alt={owner.username}
        className="rounded-full object-cover ring-2 ring-white/10"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className="rounded-full bg-white/6 ring-2 ring-white/8 flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg width={size * 0.45} height={size * 0.45} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-white/20">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
      </svg>
    </div>
  );
}

export function SlotCard({ slotData, onPurchase, onManage }: SlotCardProps) {
  const { slotNumber, isActive, isOwner, owner, isPaused } = slotData;
  const taken = isActive && !isOwner;
  const timeLeft = useTimeLeft(isActive ? slotData.expiresAt : null, isPaused ? slotData.pausedAt : null);
  const [keyCopied, setKeyCopied] = useState(false);

  const handleCopyKey = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!slotData.scriptKey) return;
    await navigator.clipboard.writeText(slotData.scriptKey);
    setKeyCopied(true);
    setTimeout(() => setKeyCopied(false), 2000);
  };

  return (
    <div className={cn(
      'rounded-3xl border flex flex-col items-center p-4 pt-3.5 gap-3 transition-all duration-200 relative',
      isOwner
        ? isPaused
          ? 'border-amber-500/25 bg-[#16140e] shadow-[0_0_20px_rgba(245,166,35,0.04)]'
          : 'border-[#f5a623]/25 bg-[#131209] shadow-[0_0_20px_rgba(245,166,35,0.06)]'
        : taken
          ? 'border-white/6 bg-[#111115]'
          : 'border-white/8 bg-[#111115] hover:border-[#f5a623]/20 hover:bg-[#131209] cursor-pointer hover:shadow-[0_0_16px_rgba(245,166,35,0.04)]'
    )}>

      {/* Top row: slot number + status badge */}
      <div className="w-full flex items-center justify-between">
        <span className="font-mono text-[10px] font-bold bg-white/5 px-2.5 py-1 rounded-full text-white/40 tracking-wider border border-white/6">
          #{String(slotNumber).padStart(2, '0')}
        </span>

        {isActive ? (
          isPaused ? (
            <span className="flex items-center gap-1.5 text-[10px] font-semibold text-amber-400 bg-amber-500/10 px-2.5 py-1 rounded-full border border-amber-500/20">
              <Pause className="w-2.5 h-2.5" /> Paused
            </span>
          ) : isOwner ? (
            <span className="flex items-center gap-1.5 text-[10px] font-semibold text-[#f5a623] bg-[#f5a623]/10 px-2.5 py-1 rounded-full border border-[#f5a623]/20">
              <span className="w-1.5 h-1.5 rounded-full bg-[#f5a623] animate-pulse" />
              Active
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-[10px] font-semibold text-white/30 bg-white/5 px-2.5 py-1 rounded-full border border-white/8">
              <span className="w-1.5 h-1.5 rounded-full bg-white/20" />
              Taken
            </span>
          )
        ) : (
          <span className="flex items-center gap-1.5 text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            Open
          </span>
        )}
      </div>

      {/* Avatar */}
      {isActive ? (
        <Avatar owner={owner} size={56} />
      ) : (
        <div className="w-14 h-14 rounded-full border-2 border-dashed border-white/10 flex items-center justify-center">
          <span className="text-white/15 text-xl font-bold">+</span>
        </div>
      )}

      {/* Username */}
      {isActive ? (
        <p className="text-sm text-white/65 font-medium truncate max-w-full px-1 text-center">
          {owner?.username ?? 'Unknown'}
        </p>
      ) : (
        <p className="text-xs text-white/25 text-center">Available</p>
      )}

      {/* Timer */}
      {isActive && timeLeft && (
        <div className="flex items-center gap-1.5 text-[10px] font-mono text-white/30 bg-white/4 px-2.5 py-1.5 rounded-full border border-white/6 w-full justify-center">
          {isPaused
            ? <Pause className="w-2.5 h-2.5 text-amber-400/70" />
            : <Clock className="w-2.5 h-2.5" />
          }
          <span className={isPaused ? 'text-amber-400/70' : ''}>{timeLeft}</span>
        </div>
      )}

      {/* Script key (owner only) */}
      {isOwner && slotData.scriptKey && (
        <div className="w-full rounded-2xl bg-white/4 border border-white/6 px-2.5 py-2 flex items-center justify-between gap-2">
          <p className="font-mono text-[10px] text-[#f5a623]/60 truncate flex-1">{slotData.scriptKey}</p>
          <button onClick={handleCopyKey} className="shrink-0 text-white/20 hover:text-[#f5a623] transition-colors">
            {keyCopied ? <Check className="w-3 h-3 text-[#f5a623]" /> : <Copy className="w-3 h-3" />}
          </button>
        </div>
      )}

      {/* Action button */}
      {isOwner ? (
        <button
          onClick={() => onManage(slotData)}
          className="w-full h-8 rounded-2xl border border-[#f5a623]/20 text-[#f5a623]/80 text-xs font-medium hover:bg-[#f5a623]/8 hover:border-[#f5a623]/35 transition-all"
        >
          Manage
        </button>
      ) : taken ? (
        <button disabled className="w-full h-8 rounded-2xl border border-white/5 text-white/15 text-xs cursor-not-allowed">
          Taken
        </button>
      ) : (
        <button
          onClick={() => onPurchase(slotNumber)}
          className="w-full h-8 rounded-2xl bg-[#f5a623] text-black text-xs font-bold hover:brightness-110 active:brightness-95 transition-all"
        >
          Purchase
        </button>
      )}
    </div>
  );
}
