import React from 'react';
import { Card } from './ui/card';
import { Button } from './ui/button';
import { format } from 'date-fns';
import { Terminal, ShieldAlert, Zap, Lock } from 'lucide-react';
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

export function SlotCard({ slotData, onPurchase, onManage }: SlotCardProps) {
  const { slotNumber, isActive, isOwner, owner } = slotData;
  const takenByOther = isActive && !isOwner;

  return (
    <Card className={cn(
      "transition-all duration-500 overflow-hidden h-full flex flex-col",
      isOwner
        ? "border-primary/50 glow-box-active bg-primary/5"
        : takenByOther
          ? "border-red-500/30 bg-red-500/5 opacity-80"
          : "border-primary/10 opacity-70 hover:opacity-100"
    )}>

      <div className={cn(
        "px-4 py-3 flex justify-between items-center border-b font-mono text-sm tracking-wider uppercase",
        isOwner
          ? "border-primary/30 bg-primary/10 text-primary"
          : takenByOther
            ? "border-red-500/20 bg-red-500/10 text-red-400"
            : "border-primary/10 bg-secondary/50 text-muted-foreground"
      )}>
        <span className="flex items-center gap-2">
          <Terminal className="w-4 h-4" />
          Slot_0{slotNumber}
        </span>
        <span className={cn(
          "px-2 py-0.5 text-xs font-bold chamfered",
          isOwner
            ? "bg-primary text-primary-foreground"
            : takenByOther
              ? "bg-red-600 text-white"
              : "bg-secondary text-muted-foreground border border-primary/20"
        )}>
          {isOwner ? 'ONLINE' : takenByOther ? 'TAKEN' : 'OFFLINE'}
        </span>
      </div>

      <div className="p-6 flex-1 flex flex-col justify-between items-center text-center space-y-6 scanline">

        {isOwner ? (
          <>
            <div className="relative">
              <div className="absolute inset-0 bg-primary/20 blur-xl rounded-full animate-pulse" />
              <Zap className="w-16 h-16 text-primary relative z-10 mx-auto drop-shadow-[0_0_8px_rgba(255,215,0,0.8)]" />
            </div>
            <div className="space-y-1 w-full">
              <p className="text-primary font-display font-bold uppercase tracking-widest text-lg glow-text">
                {slotData.label || "SYSTEM ACTIVE"}
              </p>
              {slotData.expiresAt && (
                <div className="text-xs font-mono text-muted-foreground mt-4 bg-background/50 p-2 border border-primary/20 chamfered">
                  EXPIRES: <span className="text-primary">{format(new Date(slotData.expiresAt), 'MMM dd, yyyy HH:mm')}</span>
                </div>
              )}
            </div>
            <Button variant="outline" className="w-full mt-auto" onClick={() => onManage(slotData)}>
              Manage Configuration
            </Button>
          </>
        ) : takenByOther ? (
          <>
            <div className="relative">
              <div className="absolute inset-0 bg-red-500/10 blur-xl rounded-full" />
              <Lock className="w-16 h-16 text-red-400/60 relative z-10 mx-auto" />
            </div>
            <div className="space-y-3 w-full">
              <p className="text-red-400 font-display font-bold uppercase tracking-widest text-sm">
                Slot Reserved
              </p>
              {owner && (
                <div className="flex items-center justify-center gap-2">
                  {owner.avatar ? (
                    <img
                      src={`https://cdn.discordapp.com/avatars/${owner.discordId}/${owner.avatar}.png`}
                      alt=""
                      className="w-6 h-6 border border-red-500/30 chamfered"
                    />
                  ) : (
                    <div className="w-6 h-6 bg-secondary border border-red-500/30 chamfered" />
                  )}
                  <span className="font-mono text-sm text-muted-foreground">{owner.username}</span>
                </div>
              )}
              {slotData.expiresAt === null && (
                <p className="text-xs text-muted-foreground/50 font-mono">Occupied</p>
              )}
            </div>
            <Button disabled variant="outline" className="border-red-500/20 text-red-400/50 cursor-not-allowed w-full mt-auto">
              Unavailable
            </Button>
          </>
        ) : (
          <>
            <ShieldAlert className="w-16 h-16 text-muted-foreground/30 mx-auto" />
            <div className="space-y-2">
              <p className="text-muted-foreground font-mono text-sm uppercase">Access Denied</p>
              <p className="text-xs text-muted-foreground/70 font-mono">Requires authorization to activate terminal node.</p>
            </div>
            <Button
              className="w-full mt-auto group relative overflow-hidden"
              onClick={() => onPurchase(slotNumber)}
            >
              <span className="relative z-10 group-hover:glow-text">Purchase Access</span>
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}
