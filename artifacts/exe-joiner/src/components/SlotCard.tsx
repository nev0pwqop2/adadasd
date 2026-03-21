import React, { useState, useEffect } from 'react';
import { Button } from './ui/button';
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

function CopyKeyButton({ scriptKey }: { scriptKey: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(scriptKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1 text-primary/60 hover:text-primary transition-colors"
      title="Copy script key"
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
      'flex flex-col rounded-xl border transition-all duration-200 overflow-hidden',
      isOwner
        ? 'border-primary/35 bg-primary/[0.04]'
        : taken
          ? 'border-border bg-secondary/20'
          : 'border-border/60 bg-transparent hover:border-border hover:bg-secondary/10'
    )}>
      {/* Slot number + status */}
      <div className={cn(
        'flex items-center justify-between px-4 py-3 border-b',
        isOwner ? 'border-primary/20' : 'border-border/50'
      )}>
        <span className={cn(
          'font-mono text-xs font-semibold tracking-widest',
          isOwner ? 'text-primary' : taken ? 'text-muted-foreground' : 'text-muted-foreground/60'
        )}>
          #{String(slotNumber).padStart(2, '0')}
        </span>
        <span className={cn(
          'text-[10px] font-mono font-bold tracking-widest uppercase px-2 py-0.5 rounded-full',
          isOwner
            ? 'text-primary bg-primary/15'
            : taken
              ? 'text-muted-foreground bg-secondary'
              : 'text-muted-foreground/40 bg-secondary/50'
        )}>
          {isOwner ? 'Active' : taken ? 'Taken' : 'Open'}
        </span>
      </div>

      {/* Body */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-5 gap-3">
        {isOwner ? (
          <>
            <div className="text-center space-y-1.5 w-full">
              <p className="font-semibold text-sm text-primary tracking-wide">
                {slotData.label || 'Running'}
              </p>
              {timeLeft && (
                <div className="flex items-center justify-center gap-1.5 text-xs font-mono text-muted-foreground">
                  <Clock className="w-3 h-3 text-primary/50" />
                  <span>{timeLeft} left</span>
                </div>
              )}
            </div>

            {slotData.scriptKey ? (
              <div className="w-full bg-secondary/60 border border-primary/15 rounded px-2.5 py-1.5">
                <div className="flex items-center justify-between gap-1 mb-0.5">
                  <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground flex items-center gap-1">
                    <Key className="w-2.5 h-2.5" /> Script Key
                  </span>
                  <CopyKeyButton scriptKey={slotData.scriptKey} />
                </div>
                <p className="font-mono text-[10px] text-primary/80 break-all leading-tight">
                  {slotData.scriptKey}
                </p>
              </div>
            ) : (
              <div className="w-full bg-secondary/30 border border-border/30 rounded px-2.5 py-1.5">
                <p className="text-[10px] font-mono text-muted-foreground/40 text-center">
                  No script key assigned
                </p>
              </div>
            )}

            <Button
              variant="outline"
              size="sm"
              className="w-full h-8 border-primary/25 text-primary hover:border-primary/50 hover:bg-primary/5 text-xs font-mono"
              onClick={() => onManage(slotData)}
            >
              Manage
            </Button>
          </>
        ) : taken ? (
          <>
            <div className="flex flex-col items-center gap-1.5 w-full">
              {owner && (
                <div className="flex items-center gap-2">
                  {owner.avatar ? (
                    <img
                      src={`https://cdn.discordapp.com/avatars/${owner.discordId}/${owner.avatar}.png`}
                      alt=""
                      className="w-6 h-6 rounded-full border border-border"
                    />
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-secondary border border-border" />
                  )}
                  <span className="font-mono text-xs text-muted-foreground truncate max-w-[100px]">{owner.username}</span>
                </div>
              )}
              {timeLeft && (
                <div className="flex items-center gap-1 text-[11px] font-mono text-muted-foreground/50">
                  <Clock className="w-2.5 h-2.5" />
                  <span>{timeLeft}</span>
                </div>
              )}
            </div>
            <Button
              disabled
              size="sm"
              variant="outline"
              className="w-full h-8 border-border/40 text-muted-foreground/30 cursor-not-allowed text-xs font-mono"
            >
              Taken
            </Button>
          </>
        ) : (
          <>
            <p className="text-muted-foreground/40 font-mono text-xs">Available</p>
            <Button
              size="sm"
              className="w-full h-8 text-xs font-semibold"
              onClick={() => onPurchase(slotNumber)}
            >
              Purchase
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
