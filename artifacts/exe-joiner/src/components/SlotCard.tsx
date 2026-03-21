import React, { useState, useEffect } from 'react';
import { Card } from './ui/card';
import { Button } from './ui/button';
import { Zap, Lock, Plus, Clock } from 'lucide-react';
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

  const totalSecs = Math.floor(ms / 1000);
  const d = Math.floor(totalSecs / 86400);
  const h = Math.floor((totalSecs % 86400) / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;

  if (d > 0) return `${d}d ${h}h ${String(m).padStart(2, '0')}m`;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
  return `${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
}

export function SlotCard({ slotData, onPurchase, onManage }: SlotCardProps) {
  const { slotNumber, isActive, isOwner, owner } = slotData;
  const takenByOther = isActive && !isOwner;
  const timeLeft = useTimeLeft(isActive ? slotData.expiresAt : null);

  return (
    <Card className={cn(
      'transition-all duration-300 overflow-hidden h-full flex flex-col rounded-xl',
      isOwner
        ? 'border-primary/40 glow-box-active bg-primary/5'
        : takenByOther
          ? 'border-red-500/20 bg-red-500/5'
          : 'border-border hover:border-primary/20 hover:bg-secondary/30 opacity-80 hover:opacity-100'
    )}>

      {/* Card header */}
      <div className={cn(
        'px-4 py-2.5 flex justify-between items-center border-b text-xs font-mono tracking-wider',
        isOwner
          ? 'border-primary/20 bg-primary/10 text-primary'
          : takenByOther
            ? 'border-red-500/15 bg-red-500/8 text-red-400/80'
            : 'border-border bg-secondary/30 text-muted-foreground'
      )}>
        <span className="font-semibold">Slot {String(slotNumber).padStart(2, '0')}</span>
        <span className={cn(
          'px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-widest uppercase',
          isOwner
            ? 'bg-primary/20 text-primary'
            : takenByOther
              ? 'bg-red-500/15 text-red-400'
              : 'bg-secondary text-muted-foreground'
        )}>
          {isOwner ? 'Active' : takenByOther ? 'Taken' : 'Open'}
        </span>
      </div>

      {/* Card body */}
      <div className="p-5 flex-1 flex flex-col justify-between items-center text-center gap-5">

        {isOwner ? (
          <>
            <div className="flex-1 flex flex-col items-center justify-center gap-3">
              <div className="relative">
                <div className="absolute inset-0 bg-primary/20 blur-2xl rounded-full" />
                <Zap className="w-10 h-10 text-primary relative z-10 mx-auto drop-shadow-[0_0_8px_rgba(218,165,32,0.6)]" />
              </div>
              <div className="w-full space-y-2">
                <p className="text-primary font-display font-bold uppercase tracking-wide text-sm">
                  {slotData.label || 'Running'}
                </p>
                {timeLeft && (
                  <div className="flex items-center justify-center gap-1.5 text-xs font-mono text-muted-foreground">
                    <Clock className="w-3 h-3 text-primary/60" />
                    <span>{timeLeft} left</span>
                  </div>
                )}
              </div>
            </div>
            <Button variant="outline" size="sm" className="w-full border-primary/25 text-primary/80 hover:text-primary hover:border-primary/50 text-xs font-mono" onClick={() => onManage(slotData)}>
              Manage
            </Button>
          </>
        ) : takenByOther ? (
          <>
            <div className="flex-1 flex flex-col items-center justify-center gap-3">
              <Lock className="w-9 h-9 text-red-400/40 mx-auto" />
              <div className="space-y-2">
                {owner && (
                  <div className="flex items-center justify-center gap-2">
                    {owner.avatar ? (
                      <img
                        src={`https://cdn.discordapp.com/avatars/${owner.discordId}/${owner.avatar}.png`}
                        alt=""
                        className="w-5 h-5 rounded-full border border-red-500/20"
                      />
                    ) : (
                      <div className="w-5 h-5 rounded-full bg-secondary border border-red-500/20" />
                    )}
                    <span className="font-mono text-xs text-muted-foreground">{owner.username}</span>
                  </div>
                )}
                {timeLeft && (
                  <div className="flex items-center justify-center gap-1.5 text-xs font-mono text-red-400/60">
                    <Clock className="w-3 h-3" />
                    <span>{timeLeft} left</span>
                  </div>
                )}
              </div>
            </div>
            <Button disabled variant="outline" size="sm" className="w-full border-red-500/15 text-red-400/40 cursor-not-allowed text-xs font-mono">
              Unavailable
            </Button>
          </>
        ) : (
          <>
            <div className="flex-1 flex flex-col items-center justify-center gap-3">
              <div className="w-10 h-10 rounded-full border-2 border-dashed border-border flex items-center justify-center mx-auto">
                <Plus className="w-4 h-4 text-muted-foreground/50" />
              </div>
              <p className="text-muted-foreground font-mono text-xs">Available slot</p>
            </div>
            <Button
              size="sm"
              className="w-full text-xs font-semibold tracking-wide"
              onClick={() => onPurchase(slotNumber)}
            >
              Purchase
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}
