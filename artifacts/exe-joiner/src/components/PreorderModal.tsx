import React, { useState } from 'react';
import { Button } from './ui/button';
import { useToast } from '@/hooks/use-toast';
import { X, CreditCard, Bitcoin, Copy, Check, Clock, Loader2 } from 'lucide-react';

interface PreorderModalProps {
  isOpen: boolean;
  onClose: () => void;
  pricePerDay: number;
  slotDurationHours: number;
  nextExpiresAt: string | null;
  onSuccess: () => void;
}

const CRYPTO_OPTIONS = [
  { id: 'BTC', label: 'Bitcoin', symbol: 'BTC' },
  { id: 'LTC', label: 'Litecoin', symbol: 'LTC' },
  { id: 'USDT', label: 'USDT TRC20', symbol: 'USDT' },
  { id: 'ETH', label: 'Ethereum', symbol: 'ETH' },
  { id: 'SOL', label: 'Solana', symbol: 'SOL' },
];

type Step = 'choose' | 'crypto_address' | 'loading';

export function PreorderModal({ isOpen, onClose, pricePerDay, slotDurationHours, nextExpiresAt, onSuccess }: PreorderModalProps) {
  const { toast } = useToast();
  const [step, setStep] = useState<Step>('choose');
  const [selectedCrypto, setSelectedCrypto] = useState('');
  const [cryptoSession, setCryptoSession] = useState<{ address: string; amount: string; currency: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [isLoadingStripe, setIsLoadingStripe] = useState(false);

  const BASE = import.meta.env.BASE_URL;

  const handleClose = () => {
    setStep('choose');
    setSelectedCrypto('');
    setCryptoSession(null);
    onClose();
  };

  const handleStripe = async () => {
    setIsLoadingStripe(true);
    try {
      const res = await fetch(`${BASE}api/preorders/create-stripe`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to create session');
      window.location.href = data.url;
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
      setIsLoadingStripe(false);
    }
  };

  const handleCrypto = async () => {
    if (!selectedCrypto) return;
    setStep('loading');
    try {
      const res = await fetch(`${BASE}api/preorders/create-crypto`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currency: selectedCrypto }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to create crypto session');
      setCryptoSession({ address: data.address, amount: data.amount, currency: data.currency });
      setStep('crypto_address');
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
      setStep('choose');
    }
  };

  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const timeUntil = nextExpiresAt ? (() => {
    const diff = new Date(nextExpiresAt).getTime() - Date.now();
    if (diff <= 0) return 'soon';
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    return h > 0 ? `~${h}h ${m}m` : `~${m}m`;
  })() : null;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={handleClose} />
      <div className="relative w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 className="font-display font-bold text-foreground text-base">Pre-order a Slot</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Reserve the next available slot · ${pricePerDay.toFixed(2)} for {slotDurationHours}h
            </p>
          </div>
          <button onClick={handleClose} className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-lg hover:bg-secondary">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6">
          <div className="flex items-start gap-3 bg-primary/8 border border-primary/20 rounded-xl p-3.5 mb-5">
            <Clock className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <div>
              <p className="font-mono text-xs text-primary font-semibold">How it works</p>
              <p className="font-mono text-xs text-muted-foreground mt-1 leading-relaxed">
                Pay now. When the next slot expires{timeUntil ? ` (${timeUntil})` : ''}, you automatically get it for a full {slotDurationHours}h — no action needed.
              </p>
            </div>
          </div>

          {step === 'choose' && (
            <div className="space-y-4">
              <button
                onClick={handleStripe}
                disabled={isLoadingStripe}
                className="w-full flex items-center gap-4 p-4 border border-border rounded-xl hover:border-primary/30 hover:bg-primary/5 transition-all text-left"
              >
                <div className="w-10 h-10 bg-secondary rounded-lg flex items-center justify-center shrink-0">
                  {isLoadingStripe ? <Loader2 className="w-5 h-5 text-primary animate-spin" /> : <CreditCard className="w-5 h-5 text-primary" />}
                </div>
                <div>
                  <p className="font-semibold text-sm text-foreground">Pay by Card</p>
                  <p className="text-xs text-muted-foreground font-mono">Visa, Mastercard, etc. via Stripe</p>
                </div>
              </button>

              <div className="border border-border rounded-xl p-4">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 bg-secondary rounded-lg flex items-center justify-center shrink-0">
                    <Bitcoin className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-semibold text-sm text-foreground">Pay with Crypto</p>
                    <p className="text-xs text-muted-foreground font-mono">BTC, LTC, USDT TRC20, ETH, SOL</p>
                  </div>
                </div>
                <div className="flex gap-2 mb-3">
                  {CRYPTO_OPTIONS.map(c => (
                    <button
                      key={c.id}
                      onClick={() => setSelectedCrypto(c.id)}
                      className={`flex-1 py-1.5 rounded-lg font-mono text-xs border transition-all ${selectedCrypto === c.id ? 'border-primary/50 bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/20'}`}
                    >
                      {c.symbol}
                    </button>
                  ))}
                </div>
                <Button size="sm" className="w-full text-xs" disabled={!selectedCrypto} onClick={handleCrypto}>
                  Continue with {selectedCrypto || '...'}
                </Button>
              </div>
            </div>
          )}

          {step === 'loading' && (
            <div className="flex flex-col items-center justify-center py-8 gap-3">
              <Loader2 className="w-8 h-8 text-primary animate-spin" />
              <p className="font-mono text-sm text-muted-foreground">Generating address…</p>
            </div>
          )}

          {step === 'crypto_address' && cryptoSession && (
            <div className="space-y-4">
              <div className="bg-secondary/40 rounded-xl p-4 space-y-3">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Send exactly</p>
                  <div className="flex items-center gap-2">
                    <p className="font-mono font-bold text-primary text-lg">{cryptoSession.amount} {cryptoSession.currency}</p>
                    <button onClick={() => copy(cryptoSession.amount)} className="text-muted-foreground hover:text-primary transition-colors">
                      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-1">To address</p>
                  <div className="flex items-start gap-2">
                    <p className="font-mono text-xs text-foreground break-all flex-1">{cryptoSession.address}</p>
                    <button onClick={() => copy(cryptoSession.address)} className="text-muted-foreground hover:text-primary transition-colors shrink-0 mt-0.5">
                      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              </div>
              <p className="font-mono text-xs text-muted-foreground text-center leading-relaxed">
                Send the exact amount. Your pre-order activates automatically once the payment is confirmed.
              </p>
              <Button variant="outline" size="sm" className="w-full border-border text-xs" onClick={handleClose}>
                Done — I've sent the payment
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
