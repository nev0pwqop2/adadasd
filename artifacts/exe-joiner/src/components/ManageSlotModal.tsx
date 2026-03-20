import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Settings, Loader2, Tag } from 'lucide-react';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { useToast } from '@/hooks/use-toast';
import type { Slot } from '@workspace/api-client-react';

interface ManageSlotModalProps {
  slot: Slot | null;
  onClose: () => void;
  onSuccess: () => void;
}

export function ManageSlotModal({ slot, onClose, onSuccess }: ManageSlotModalProps) {
  const [label, setLabel] = useState(slot?.label || '');
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();

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
              <div className="space-y-2">
                <label className="text-xs font-mono uppercase text-muted-foreground flex items-center gap-2">
                  <Tag className="w-3 h-3" /> Slot Label
                </label>
                <input
                  type="text"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="e.g. Main Bot, Server #1..."
                  maxLength={64}
                  className="w-full bg-secondary border border-primary/20 text-foreground font-mono text-sm px-3 py-2 focus:outline-none focus:border-primary/60 transition-colors"
                />
                <p className="text-xs text-muted-foreground font-mono">Give this slot a custom name to identify it.</p>
              </div>

              <div className="bg-secondary/50 border border-primary/10 p-3 space-y-1 font-mono text-xs">
                <div className="flex justify-between text-muted-foreground">
                  <span>SLOT ID</span>
                  <span className="text-primary">#{slot.slotNumber}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>STATUS</span>
                  <span className="text-primary">ONLINE</span>
                </div>
                {slot.expiresAt && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>EXPIRES</span>
                    <span className="text-primary">{new Date(slot.expiresAt).toLocaleDateString()}</span>
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
