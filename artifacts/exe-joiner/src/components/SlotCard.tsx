import React from 'react';
import { Card } from './ui/card';
import { Button } from './ui/button';
import { format } from 'date-fns';
import { Terminal, ShieldAlert, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Slot } from '@workspace/api-client-react';

interface SlotCardProps {
  slotNumber: number;
  slotData?: Slot;
  onPurchase: (slotNumber: number) => void;
}

export function SlotCard({ slotNumber, slotData, onPurchase }: SlotCardProps) {
  const isActive = slotData?.isActive || false;

  return (
    <Card className={cn(
      "transition-all duration-500 overflow-hidden h-full flex flex-col",
      isActive ? "border-primary/50 glow-box-active bg-primary/5" : "border-primary/10 opacity-70 hover:opacity-100"
    )}>
      
      <div className={cn(
        "px-4 py-3 flex justify-between items-center border-b font-mono text-sm tracking-wider uppercase",
        isActive ? "border-primary/30 bg-primary/10 text-primary" : "border-primary/10 bg-secondary/50 text-muted-foreground"
      )}>
        <span className="flex items-center gap-2">
          <Terminal className="w-4 h-4" />
          Slot_0{slotNumber}
        </span>
        <span className={cn(
          "px-2 py-0.5 text-xs font-bold chamfered",
          isActive ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground border border-primary/20"
        )}>
          {isActive ? 'ONLINE' : 'OFFLINE'}
        </span>
      </div>

      <div className="p-6 flex-1 flex flex-col justify-between items-center text-center space-y-6 scanline">
        
        {isActive ? (
          <>
            <div className="relative">
              <div className="absolute inset-0 bg-primary/20 blur-xl rounded-full animate-pulse" />
              <Zap className="w-16 h-16 text-primary relative z-10 mx-auto drop-shadow-[0_0_8px_rgba(255,215,0,0.8)]" />
            </div>
            
            <div className="space-y-1 w-full">
              <p className="text-primary font-display font-bold uppercase tracking-widest text-lg glow-text">
                {slotData?.label || "SYSTEM ACTIVE"}
              </p>
              {slotData?.expiresAt && (
                <div className="text-xs font-mono text-muted-foreground mt-4 bg-background/50 p-2 border border-primary/20 chamfered">
                  EXPIRES: <span className="text-primary">{format(new Date(slotData.expiresAt), 'MMM dd, yyyy HH:mm')}</span>
                </div>
              )}
            </div>
            
            <Button variant="outline" className="w-full mt-auto" onClick={() => {}}>
              Manage Configuration
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
