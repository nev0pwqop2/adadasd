import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Settings, Loader2, Key, Copy, Check, RefreshCw, AlertCircle, Gift } from 'lucide-react';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { useToast } from '@/hooks/use-toast';
import type { PublicSlot } from './SlotCard';

interface ManageSlotModalProps {
  slot: PublicSlot | null;
  onClose: () => void;
  onSuccess: () => void;
}

export function ManageSlotModal({ slot, onClose, onSuccess }: ManageSlotModalProps) {
  const [label, setLabel] = useState(slot?.label || '');
  const [isSaving, setIsSaving] = useState(false);
  const [keyCopied, setKeyCopied] = useState(false);
  const [scriptCopied, setScriptCopied] = useState(false);
  const [isResettingHwid, setIsResettingHwid] = useState(false);
  const [showGiftPanel, setShowGiftPanel] = useState(false);
  const [giftDiscordId, setGiftDiscordId] = useState('');
  const [isGifting, setIsGifting] = useState(false);
  const { toast } = useToast();

  const hwidResetAt = slot?.hwidResetAt ? new Date(slot.hwidResetAt) : null;
  const nextHwidReset = hwidResetAt ? new Date(hwidResetAt.getTime() + 24 * 60 * 60 * 1000) : null;
  const hwidOnCooldown = slot?.hwidUnlimited ? false : (nextHwidReset ? nextHwidReset > new Date() : false);

  const handleResetHwid = async () => {
    if (!slot?.id || hwidOnCooldown) return;
    setIsResettingHwid(true);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/slots/${slot.id}/reset-hwid`, {
        method: 'POST',
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'Failed to reset HWID');
      toast({ title: 'HWID Reset', description: 'Your HWID has been reset successfully.', className: 'bg-primary text-primary-foreground' });
      onSuccess();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Something went wrong';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    } finally {
      setIsResettingHwid(false);
    }
  };

  const handleCopyKey = async () => {
    if (!slot?.scriptKey) return;
    await navigator.clipboard.writeText(slot.scriptKey);
    setKeyCopied(true);
    setTimeout(() => setKeyCopied(false), 2000);
  };

  const handleCopyScript = async () => {
    if (!slot?.script) return;
    await navigator.clipboard.writeText(slot.script);
    setScriptCopied(true);
    setTimeout(() => setScriptCopied(false), 2000);
  };

  const handleGift = async () => {
    if (!slot?.id || !giftDiscordId.trim()) return;
    setIsGifting(true);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/slots/gift`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slotId: slot.id, recipientDiscordId: giftDiscordId.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'Failed to gift slot');
      toast({ title: 'Slot Gifted!', description: `Slot #${slot.slotNumber} has been transferred.`, className: 'bg-primary text-primary-foreground border-none' });
      onSuccess();
      onClose();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Something went wrong';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    } finally {
      setIsGifting(false);
    }
  };

  if (!slot) return null;

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const res = await fetch(`/api/slots/${slot.id}/label`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ label }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Failed to save');
      }

      toast({ title: 'Saved!', description: `Slot ${slot.slotNumber} label updated.`, className: 'bg-primary text-primary-foreground' });
      onSuccess();
      onClose();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Something went wrong';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-background/80 backdrop-blur-sm"
        />

        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="relative w-full max-w-md z-10"
        >
          <Card className="border-primary/50 shadow-2xl shadow-primary/20 bg-background/95">
            <div className="flex items-center justify-between p-6 border-b border-primary/20 bg-primary/5">
              <h2 className="text-xl font-display font-bold text-primary uppercase tracking-wider flex items-center gap-2">
                <Settings className="w-5 h-5" />
                Slot_{String(slot.slotNumber).padStart(2, '0')} Config
              </h2>
              <button onClick={onClose} className="text-muted-foreground hover:text-primary transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              <div className="bg-secondary/50 border border-primary/10 p-3 space-y-1 font-mono text-xs">
                <div className="flex justify-between text-muted-foreground">
                  <span>STATUS</span>
                  <span className="text-primary">ONLINE</span>
                </div>
                {slot.expiresAt && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>EXPIRES</span>
                    <span className="text-primary">{(() => {
                      const diff = new Date(slot.expiresAt).getTime() - Date.now();
                      if (diff <= 0) return 'Expired';
                      const h = Math.floor(diff / 3600000);
                      const m = Math.floor((diff % 3600000) / 60000);
                      return h > 0 ? `${h}h ${m}m` : `${m}m`;
                    })()}</span>
                  </div>
                )}
              </div>

              {slot.scriptKey ? (
                <div className="space-y-3">
                  <div className="space-y-2">
                    <label className="text-xs font-mono uppercase text-muted-foreground flex items-center gap-2">
                      <Key className="w-3 h-3" /> Script Key
                    </label>
                    <div className="bg-secondary/60 border border-primary/20 p-3 rounded flex items-start justify-between gap-2">
                      <pre className="font-mono text-xs text-primary/90 break-all leading-relaxed flex-1 whitespace-pre-wrap">{slot.scriptKey}</pre>
                      <button
                        onClick={handleCopyKey}
                        className="shrink-0 text-muted-foreground hover:text-primary transition-colors mt-0.5"
                        title="Copy script"
                      >
                        {keyCopied ? <Check className="w-3.5 h-3.5 text-primary" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>

                  {slot.script && (
                    <div className="space-y-2">
                      <label className="text-xs font-mono uppercase text-muted-foreground flex items-center gap-2">
                        <Key className="w-3 h-3" /> Loader Script
                      </label>
                      <div className="bg-secondary/60 border border-primary/20 p-3 rounded flex items-start justify-between gap-2">
                        <pre className="font-mono text-xs text-primary/90 break-all leading-relaxed flex-1 whitespace-pre-wrap">
                          {slot.script}
                        </pre>
                        <button
                          onClick={handleCopyScript}
                          className="shrink-0 text-muted-foreground hover:text-primary transition-colors mt-0.5"
                          title="Copy loader script"
                        >
                          {scriptCopied ? <Check className="w-3.5 h-3.5 text-primary" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                      <p className="text-[10px] font-mono text-muted-foreground/50">
                        Paste this into your executor to run the script.
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="bg-secondary/30 border border-border/30 p-3 rounded text-center">
                  <p className="text-xs font-mono text-muted-foreground/40">No script key — Luarmor not configured</p>
                </div>
              )}

              {/* HWID Reset */}
              {slot.scriptKey && (
                <div className="space-y-2">
                  <label className="text-xs font-mono uppercase text-muted-foreground flex items-center gap-2">
                    <RefreshCw className="w-3 h-3" /> HWID Reset
                  </label>
                  {hwidOnCooldown && nextHwidReset ? (
                    <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground border border-border/30 p-2.5 rounded bg-secondary/30">
                      <AlertCircle className="w-3.5 h-3.5 text-yellow-500 shrink-0" />
                      <span>Next reset available {nextHwidReset.toLocaleString()}</span>
                    </div>
                  ) : (
                    <Button variant="outline" size="sm" onClick={handleResetHwid} disabled={isResettingHwid} className="font-mono text-xs border-primary/30">
                      {isResettingHwid ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />}
                      Reset HWID
                    </Button>
                  )}
                </div>
              )}

              {/* Gift Slot */}
              <div className="space-y-2 border-t border-primary/10 pt-4">
                {!showGiftPanel ? (
                  <button
                    onClick={() => setShowGiftPanel(true)}
                    className="flex items-center gap-2 text-xs font-mono text-muted-foreground hover:text-primary transition-colors"
                  >
                    <Gift className="w-3.5 h-3.5" /> Gift this slot to another user
                  </button>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-xs font-mono text-yellow-400 bg-yellow-500/10 border border-yellow-500/20 p-2.5 rounded">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      <span>You will lose access to this slot when it is gifted.</span>
                    </div>
                    <label className="text-xs font-mono uppercase text-muted-foreground flex items-center gap-2">
                      <Gift className="w-3 h-3" /> Recipient Discord ID
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. 123456789012345678"
                      value={giftDiscordId}
                      onChange={e => setGiftDiscordId(e.target.value.replace(/\D/g, ''))}
                      className="w-full bg-secondary/50 border border-primary/20 text-foreground font-mono text-sm px-3 py-2 focus:outline-none focus:border-primary/50"
                    />
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" className="flex-1 font-mono text-xs" onClick={() => { setShowGiftPanel(false); setGiftDiscordId(''); }}>
                        Cancel
                      </Button>
                      <Button size="sm" className="flex-[2] font-mono text-xs" onClick={handleGift} disabled={isGifting || !giftDiscordId.trim()}>
                        {isGifting ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <Gift className="w-3.5 h-3.5 mr-1.5" />}
                        Gift Slot
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={onClose} disabled={isSaving}>
                  Cancel
                </Button>
                <Button className="flex-[2]" onClick={handleSave} disabled={isSaving}>
                  {isSaving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  Save Configuration
                </Button>
              </div>
            </div>
          </Card>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
