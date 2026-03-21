import React, { useState } from 'react';
import { Button } from './ui/button';
import { useToast } from '@/hooks/use-toast';
import { X, CreditCard, Bitcoin, Copy, Check, Clock, Loader2, Wallet, CheckCircle } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';

interface PreorderModalProps {
  isOpen: boolean;
  onClose: () => void;
  pricePerDay: number;
  slotDurationHours: number;
  nextExpiresAt: string | null;
  onSuccess: () => void;
  balance?: number;
}

const CRYPTO_OPTIONS = [
  { id: 'BTC', label: 'Bitcoin' },
  { id: 'LTC', label: 'Litecoin' },
  { id: 'USDT', label: 'Tether' },
  { id: 'ETH', label: 'Ethereum' },
  { id: 'SOL', label: 'Solana' },
];

type Step = 'choose' | 'crypto_address' | 'loading';

export function PreorderModal({ isOpen, onClose, pricePerDay, slotDurationHours, nextExpiresAt, onSuccess, balance = 0 }: PreorderModalProps) {
  const { toast } = useToast();
  const [step, setStep] = useState<Step>('choose');
  const [selectedCrypto, setSelectedCrypto] = useState('');
  const [cryptoSession, setCryptoSession] = useState<{
    paymentId: string;
    address: string;
    amount: string;
    currency: string;
    expiresAt: string;
  } | null>(null);
  const [copiedAmount, setCopiedAmount] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState(false);
  const [isLoadingStripe, setIsLoadingStripe] = useState(false);
  const [isLoadingBalance, setIsLoadingBalance] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);

  const BASE = import.meta.env.BASE_URL;
  const hasEnoughBalance = balance >= pricePerDay;

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

  const handleBalance = async () => {
    setIsLoadingBalance(true);
    try {
      const res = await fetch(`${BASE}api/preorders/create-balance`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed');
      toast({ title: 'Pre-order Placed!', description: "You'll automatically get the next slot when one opens.", className: 'bg-primary text-primary-foreground border-none' });
      onSuccess();
      handleClose();
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setIsLoadingBalance(false);
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
      setCryptoSession({
        paymentId: data.paymentId,
        address: data.address,
        amount: data.amount,
        currency: data.currency,
        expiresAt: data.expiresAt,
      });
      setStep('crypto_address');
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
      setStep('choose');
    }
  };

  const handleVerify = async () => {
    if (!cryptoSession) return;
    setIsVerifying(true);
    try {
      const res = await fetch(`${BASE}api/preorders/verify-crypto`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentId: cryptoSession.paymentId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Verification failed');
      toast({ title: 'Pre-order Confirmed!', description: "You'll automatically get the next slot when one opens.", className: 'bg-primary text-primary-foreground border-none' });
      onSuccess();
      handleClose();
    } catch (e: any) {
      toast({ title: 'Not Confirmed Yet', description: e.message || 'Payment not detected. Try again in a moment.', variant: 'destructive' });
    } finally {
      setIsVerifying(false);
    }
  };

  const copyAmount = () => {
    if (!cryptoSession) return;
    navigator.clipboard.writeText(cryptoSession.amount);
    setCopiedAmount(true);
    setTimeout(() => setCopiedAmount(false), 2000);
  };

  const copyAddress = () => {
    if (!cryptoSession) return;
    navigator.clipboard.writeText(cryptoSession.address);
    setCopiedAddress(true);
    setTimeout(() => setCopiedAddress(false), 2000);
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
          {step !== 'crypto_address' && (
            <div className="flex items-start gap-3 bg-primary/8 border border-primary/20 rounded-xl p-3.5 mb-5">
              <Clock className="w-4 h-4 text-primary shrink-0 mt-0.5" />
              <div>
                <p className="font-mono text-xs text-primary font-semibold">How it works</p>
                <p className="font-mono text-xs text-muted-foreground mt-1 leading-relaxed">
                  Pay now. When the next slot expires{timeUntil ? ` (${timeUntil})` : ''}, you automatically get it for a full {slotDurationHours}h — no action needed.
                </p>
              </div>
            </div>
          )}

          {step === 'choose' && (
            <div className="space-y-3">
              {/* Balance */}
              <button
                onClick={handleBalance}
                disabled={isLoadingBalance || !hasEnoughBalance}
                className="w-full flex items-center gap-4 p-4 border border-border rounded-xl hover:border-primary/30 hover:bg-primary/5 transition-all text-left disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="w-10 h-10 bg-secondary rounded-lg flex items-center justify-center shrink-0">
                  {isLoadingBalance ? <Loader2 className="w-5 h-5 text-primary animate-spin" /> : <Wallet className="w-5 h-5 text-primary" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-foreground">Pay with Balance</p>
                  <p className="text-xs text-muted-foreground font-mono">
                    Your balance: <span className={hasEnoughBalance ? 'text-green-400' : 'text-red-400'}>${balance.toFixed(2)}</span>
                    {!hasEnoughBalance && <span className="ml-1">(need ${pricePerDay.toFixed(2)})</span>}
                  </p>
                </div>
                {hasEnoughBalance && (
                  <span className="font-mono text-xs text-primary bg-primary/10 border border-primary/20 px-2 py-0.5 rounded-full shrink-0">Instant</span>
                )}
              </button>

              {/* Stripe */}
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

              {/* Crypto */}
              <div className="border border-border rounded-xl p-4">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 bg-secondary rounded-lg flex items-center justify-center shrink-0">
                    <Bitcoin className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-semibold text-sm text-foreground">Pay with Crypto</p>
                    <p className="text-xs text-muted-foreground font-mono">Bitcoin, Litecoin, Tether, Ethereum, Solana</p>
                  </div>
                </div>
                <div className="flex gap-2 mb-3">
                  {CRYPTO_OPTIONS.map(c => (
                    <button
                      key={c.id}
                      onClick={() => setSelectedCrypto(c.id)}
                      className={`flex-1 py-1.5 rounded-lg font-mono text-xs border transition-all ${selectedCrypto === c.id ? 'border-primary/50 bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/20'}`}
                    >
                      {c.label}
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
            <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
              {/* QR Code */}
              <div className="flex justify-center p-4 bg-white chamfered">
                <QRCodeSVG
                  value={`${cryptoSession.currency.toLowerCase()}:${cryptoSession.address}?amount=${cryptoSession.amount}`}
                  size={180}
                  level="H"
                  includeMargin
                />
              </div>

              {/* Amount */}
              <div className="bg-secondary p-3 border border-primary/20 chamfered">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs font-mono text-muted-foreground uppercase">Amount ({cryptoSession.currency})</span>
                  <button onClick={copyAmount} className="text-primary hover:text-primary/80">
                    {copiedAmount ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
                <div className="font-mono text-lg text-foreground font-bold break-all">
                  {cryptoSession.amount}
                </div>
              </div>

              {/* Address */}
              <div className="bg-secondary p-3 border border-primary/20 chamfered">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs font-mono text-muted-foreground uppercase">Address</span>
                  <button onClick={copyAddress} className="text-primary hover:text-primary/80">
                    {copiedAddress ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
                <div className="font-mono text-sm text-primary break-all">
                  {cryptoSession.address}
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => { setCryptoSession(null); setStep('choose'); }}
                  disabled={isVerifying}
                >
                  Back
                </Button>
                <Button
                  className="flex-[2]"
                  onClick={handleVerify}
                  disabled={isVerifying}
                >
                  {isVerifying
                    ? <Loader2 className="w-5 h-5 animate-spin mr-2" />
                    : <CheckCircle className="w-5 h-5 mr-2" />}
                  Verify Payment
                </Button>
              </div>

              <p className="text-center text-xs text-muted-foreground font-mono">
                Send the exact amount, then click Verify.<br />Session expires in 1 hour.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
