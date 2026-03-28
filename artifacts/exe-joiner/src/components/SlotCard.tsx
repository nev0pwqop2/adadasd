import React, { useState, useEffect } from 'react';
import { Clock, Copy, Check, Key } from 'lucide-react';
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
}

interface SlotCardProps {
  slotData: PublicSlot;
  onPurchase: (slotNumber: number) => void;
  onManage: (slot: PublicSlot) => void;
}

function useTimeLeft(expiresAt: string | null) {
  const getMs = () => expiresAt ? Math.max(0, new Date(expiresAt).getTime() - Date.now()) : 0;
  const [ms, setMs] = useState(getMs);
  useEffect(() => {
    if (!expiresAt) return;
    const id = setInterval(() => setMs(getMs()), 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  if (!expiresAt || ms === 0) return null;
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${String(m).padStart(2, '0')}m ${String(sec).padStart(2, '0')}s`;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async (e) => { e.stopPropagation(); await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      className="text-white/25 hover:text-primary transition-colors"
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
    </button>
  );
}

export function SlotCard({ slotData, onPurchase, onManage }: SlotCardProps) {
  const { slotNumber, isActive, isOwner, owner } = slotData;
  const taken = isActive && !isOwner;
  const timeLeft = useTimeLeft(isActive ? slotData.expiresAt : null);

  return (
    <div className={cn(
      'rounded-xl border p-4 flex flex-col gap-3 transition-all duration-200',
      isOwner
        ? 'border-primary/30 bg-primary/[0.04]'
        : taken
          ? 'border-white/6 bg-white/[0.02]'
          : 'border-white/6 bg-white/[0.02] hover:border-white/12 hover:bg-white/[0.04] cursor-pointer'
    )}>
      {/* Header row */}
      <div className="flex items-center justify-between">
        <span className={cn(
          'font-mono text-xs font-bold tracking-widest',
          isOwner ? 'text-primary' : 'text-white/30'
        )}>
          #{String(slotNumber).padStart(2, '0')}
        </span>
        <span className={cn(
          'text-[10px] font-mono font-semibold tracking-wider uppercase px-2 py-0.5 rounded-full border',
          isOwner
            ? 'text-primary border-primary/25 bg-primary/10'
            : taken
              ? 'text-white/30 border-white/8 bg-white/5'
              : 'text-emerald-400 border-emerald-500/20 bg-emerald-500/8'
        )}>
          {isOwner ? 'Active' : taken ? 'Taken' : 'Open'}
        </span>
      </div>

      {/* Content */}
      {isOwner ? (
        <div className="flex flex-col gap-2.5">
          <div>
            <p className="text-sm font-semibold text-white/90">{slotData.label || 'Running'}</p>
            {timeLeft && (
              <div className="flex items-center gap-1 mt-0.5">
                <Clock className="w-3 h-3 text-white/25" />
                <span className="text-xs font-mono text-white/40">{timeLeft} left</span>
              </div>
            )}
          </div>

          {slotData.scriptKey ? (
            <div className="rounded-lg bg-white/4 border border-white/6 px-3 py-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[9px] font-mono uppercase tracking-widest text-white/25 flex items-center gap-1">
                  <Key className="w-2.5 h-2.5" /> Key
                </span>
                <CopyButton text={slotData.scriptKey} />
              </div>
              <p className="font-mono text-[10px] text-primary/70 break-all leading-snug">{slotData.scriptKey}</p>
            </div>
          ) : (
            <div className="rounded-lg bg-white/3 border border-white/5 px-3 py-2 text-center">
              <p className="text-[10px] font-mono text-white/20">No key assigned</p>
            </div>
          )}

          <button
            onClick={() => onManage(slotData)}
            className="w-full h-8 rounded-lg border border-primary/25 text-primary text-xs font-medium hover:bg-primary/8 transition-colors"
          >
            Manage
          </button>
        </div>
      ) : taken ? (
        <div className="flex flex-col gap-2.5">
          {owner && (
            <div className="flex items-center gap-2">
              {owner.avatar ? (
                <img src={`https://cdn.discordapp.com/avatars/${owner.discordId}/${owner.avatar}.png`} className="w-6 h-6 rounded-full border border-white/8" alt="" />
              ) : (
                <div className="w-6 h-6 rounded-full bg-white/8 border border-white/5" />
              )}
              <span className="text-xs text-white/50 truncate">{owner.username}</span>
            </div>
          )}
          {timeLeft && (
            <div className="flex items-center gap-1">
              <Clock className="w-3 h-3 text-white/20" />
              <span className="text-xs font-mono text-white/30">{timeLeft}</span>
            </div>
          )}
          <button disabled className="w-full h-8 rounded-lg border border-white/6 text-white/20 text-xs cursor-not-allowed">
            Taken
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          <p className="text-xs text-white/30">Available to purchase</p>
          <button
            onClick={() => onPurchase(slotNumber)}
            className="w-full h-8 rounded-lg bg-primary text-[#0a0a0c] text-xs font-bold hover:brightness-110 active:brightness-95 transition-all"
          >
            Purchase
          </button>
        </div>
      )}
    </div>
  );
}
