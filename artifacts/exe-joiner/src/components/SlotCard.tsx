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

function useTimeLeft(expiresAt: string | null, paused?: boolean) {
  const getMs = () => expiresAt ? Math.max(0, new Date(expiresAt).getTime() - Date.now()) : 0;
  const [ms, setMs] = useState(getMs);
  useEffect(() => {
    if (!expiresAt || paused) return;
    const id = setInterval(() => setMs(getMs()), 1000);
    return () => clearInterval(id);
  }, [expiresAt, paused]);

  if (!expiresAt) return null;
  const effectiveMs = paused ? Math.max(0, new Date(expiresAt).getTime() - Date.now()) : ms;
  if (effectiveMs === 0) return null;
  const s = Math.floor(effectiveMs / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h ${String(m).padStart(2, '0')}m`;
  return `${h}h ${String(m).padStart(2, '0')}m ${String(sec).padStart(2, '0')}s`;
}

function Avatar({ owner, size = 64 }: { owner: PublicSlot['owner']; size?: number }) {
  if (owner?.avatar) {
    return (
      <img
        src={`https://cdn.discordapp.com/avatars/${owner.discordId}/${owner.avatar}.webp?size=128`}
        alt={owner.username}
        className="rounded-full object-cover border-2 border-white/10"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className="rounded-full bg-white/6 border-2 border-white/8 flex items-center justify-center"
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
  const timeLeft = useTimeLeft(isActive ? slotData.expiresAt : null, isPaused);
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
      'rounded-2xl border flex flex-col items-center p-4 pt-3 gap-3 transition-all duration-200 relative',
      isOwner
        ? isPaused
          ? 'border-amber-500/30 bg-[#16140e]'
          : 'border-primary/25 bg-[#131209]'
        : taken
          ? 'border-white/8 bg-[#111115]'
          : 'border-white/8 bg-[#111115] hover:border-white/14 hover:bg-[#121216] cursor-pointer'
    )}>
      {/* Top row: slot number + status badge */}
      <div className="w-full flex items-center justify-between">
        <span className="font-mono text-[11px] font-bold bg-white/6 border border-white/8 px-2 py-0.5 rounded text-white/50 tracking-widest">
          #{String(slotNumber).padStart(2, '0')}
        </span>

        {isActive ? (
          isPaused ? (
            <span className="flex items-center gap-1.5 text-[11px] font-mono font-semibold text-amber-400">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              Paused
            </span>
          ) : isOwner ? (
            <span className="flex items-center gap-1.5 text-[11px] font-mono font-semibold text-primary">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              Active
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-[11px] font-mono font-semibold text-white/30">
              <span className="w-1.5 h-1.5 rounded-full bg-white/20" />
              Taken
            </span>
          )
        ) : (
          <span className="flex items-center gap-1.5 text-[11px] font-mono font-semibold text-emerald-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            Open
          </span>
        )}
      </div>

      {/* Avatar */}
      {isActive ? (
        <Avatar owner={owner} size={62} />
      ) : (
        <div className="w-[62px] h-[62px] rounded-full border-2 border-dashed border-white/10 flex items-center justify-center">
          <span className="text-white/15 text-xl font-bold">+</span>
        </div>
      )}

      {/* Username / label */}
      {isActive ? (
        <p className="text-sm text-white/60 font-medium truncate max-w-full px-1 text-center">
          {owner?.username ?? 'Unknown'}
        </p>
      ) : (
        <p className="text-xs text-white/25 font-mono text-center">Available</p>
      )}

      {/* Timer */}
      {isActive && timeLeft && (
        <div className="flex items-center gap-1.5 text-[11px] font-mono text-white/35">
          {isPaused
            ? <Pause className="w-3 h-3 text-amber-400/70" />
            : <Clock className="w-3 h-3 text-white/25" />
          }
          <span className={isPaused ? 'text-amber-400/70' : ''}>{timeLeft}</span>
        </div>
      )}

      {/* Script key (owner only) */}
      {isOwner && slotData.scriptKey && (
        <div className="w-full rounded-lg bg-white/4 border border-white/6 px-2.5 py-2 flex items-center justify-between gap-2">
          <p className="font-mono text-[10px] text-primary/60 truncate flex-1">{slotData.scriptKey}</p>
          <button onClick={handleCopyKey} className="shrink-0 text-white/20 hover:text-primary transition-colors">
            {keyCopied ? <Check className="w-3 h-3 text-primary" /> : <Copy className="w-3 h-3" />}
          </button>
        </div>
      )}

      {/* Action button */}
      {isOwner ? (
        <button
          onClick={() => onManage(slotData)}
          className="w-full h-8 rounded-lg border border-primary/20 text-primary/80 text-xs font-medium hover:bg-primary/8 hover:border-primary/35 transition-all"
        >
          Manage
        </button>
      ) : taken ? (
        <button disabled className="w-full h-8 rounded-lg border border-white/5 text-white/15 text-xs cursor-not-allowed">
          Taken
        </button>
      ) : (
        <button
          onClick={() => onPurchase(slotNumber)}
          className="w-full h-8 rounded-lg bg-primary text-[#0a0a0c] text-xs font-bold hover:brightness-110 active:brightness-95 transition-all"
        >
          Purchase
        </button>
      )}
    </div>
  );
}
