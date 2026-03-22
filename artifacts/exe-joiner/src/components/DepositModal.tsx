import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, CreditCard, Bitcoin, Loader2, Wallet, Copy, Check, CheckCircle, MessageSquare } from 'lucide-react';
import { Button } from './ui/button';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

interface DepositModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

type Method = 'stripe' | 'crypto' | 'paypal';
type Currency = 'BTC' | 'LTC' | 'USDT' | 'ETH' | 'SOL';

const PRESET_AMOUNTS = [10, 25, 50, 100];

interface CryptoSession {
  paymentId: string;
  address: string;
  amount: number;
  currency: string;
  expiresAt: string;
}

export function DepositModal({ isOpen, onClose, onSuccess }: DepositModalProps) {
  const { toast } = useToast();
  const [method, setMethod] = useState<Method>('stripe');
  const [currency, setCurrency] = useState<Currency>('BTC');
  const [amount, setAmount] = useState<number>(25);
  const [customAmount, setCustomAmount] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [cryptoSession, setCryptoSession] = useState<CryptoSession | null>(null);
  const [copied, setCopied] = useState<'address' | 'amount' | null>(null);

  const BASE = import.meta.env.BASE_URL as string;

  const effectiveAmount = customAmount ? parseFloat(customAmount) || 0 : amount;

  const reset = () => {
    setMethod('stripe');
    setCurrency('BTC');
    setAmount(25);
    setCustomAmount('');
    setIsLoading(false);
    setIsVerifying(false);
    setCryptoSession(null);
    setCopied(null);
  };

  const cancelPendingDeposit = () => {
    fetch(`${BASE}api/balance/deposit/cancel`, {
      method: 'DELETE',
      credentials: 'include',
    }).catch(() => {});
  };

  const handleClose = () => {
    cancelPendingDeposit();
    reset();
    onClose();
  };

  const handleDone = () => {
    reset();
    onClose();
  };

  const handleVerify = async () => {
    if (!cryptoSession) return;
    setIsVerifying(true);
    try {
      const res = await fetch(`${BASE}api/balance/deposit/verify`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentId: cryptoSession.paymentId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Payment not confirmed yet');
      toast({
        title: 'Balance Credited!',
        description: data.alreadyCredited ? 'Your balance was already credited.' : `$${effectiveAmount.toFixed(2)} added to your balance.`,
        className: 'bg-primary text-primary-foreground border-none',
      });
      onSuccess();
      handleDone();
    } catch (e: any) {
      toast({ title: 'Not Confirmed Yet', description: e.message, variant: 'destructive' });
    } finally {
      setIsVerifying(false);
    }
  };

  const handleStripeDeposit = async () => {
    if (effectiveAmount < 1) {
      toast({ title: 'Invalid amount', description: 'Minimum deposit is $1.00', variant: 'destructive' });
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetch(`${BASE}api/balance/deposit/stripe`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: effectiveAmount }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to create session');
      window.location.href = data.url;
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleCryptoDeposit = async () => {
    if (effectiveAmount < 1) {
      toast({ title: 'Invalid amount', description: 'Minimum deposit is $1.00', variant: 'destructive' });
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetch(`${BASE}api/balance/deposit/crypto`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: effectiveAmount, currency }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === 'below_minimum') {
          throw new Error(`Minimum deposit for ${currency} is $${data.minAmount?.toFixed(2)} USD`);
        }
        throw new Error(data.message || 'Failed');
      }
      setCryptoSession(data);
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  const copyToClipboard = (text: string, field: 'address' | 'amount') => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(field);
      setTimeout(() => setCopied(null), 1500);
    });
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={handleClose} />
          <motion.div
            className="relative z-10 bg-card border border-border rounded-2xl w-full max-w-md shadow-2xl overflow-hidden"
            initial={{ scale: 0.93, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.93, opacity: 0, y: 20 }}
          >
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-border">
              <div className="flex items-center gap-2.5">
                <Wallet className="w-5 h-5 text-primary" />
                <h2 className="font-display font-bold text-foreground">Add Funds</h2>
              </div>
              <button onClick={handleClose} className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-5">
              {!cryptoSession ? (
                <>
                  {/* Amount */}
                  <div>
                    <p className="text-xs font-mono text-muted-foreground mb-2.5 uppercase tracking-wider">Amount (USD)</p>
                    <div className="grid grid-cols-4 gap-2 mb-2.5">
                      {PRESET_AMOUNTS.map(a => (
                        <button
                          key={a}
                          onClick={() => { setAmount(a); setCustomAmount(''); }}
                          className={cn(
                            'py-2.5 rounded-xl border font-mono text-sm font-semibold transition-all',
                            amount === a && !customAmount
                              ? 'border-primary bg-primary/10 text-primary'
                              : 'border-border bg-card/50 text-muted-foreground hover:border-primary/50 hover:text-foreground'
                          )}
                        >
                          ${a}
                        </button>
                      ))}
                    </div>
                    <div className="relative">
                      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-mono text-sm text-muted-foreground">$</span>
                      <input
                        type="number"
                        min="1"
                        step="0.01"
                        value={customAmount}
                        onChange={e => { setCustomAmount(e.target.value); }}
                        placeholder="Custom amount"
                        className="w-full bg-secondary/30 border border-border rounded-xl px-9 py-2.5 font-mono text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/20 transition-all"
                      />
                    </div>
                  </div>

                  {/* Method */}
                  <div>
                    <p className="text-xs font-mono text-muted-foreground mb-2.5 uppercase tracking-wider">Payment Method</p>
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        onClick={() => setMethod('stripe')}
                        className={cn(
                          'flex items-center gap-2.5 p-3.5 rounded-xl border transition-all',
                          method === 'stripe'
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border bg-card/50 text-muted-foreground hover:border-primary/40 hover:text-foreground'
                        )}
                      >
                        <CreditCard className="w-4 h-4 shrink-0" />
                        <div className="text-left">
                          <p className="font-mono text-xs font-semibold">Card</p>
                          <p className="font-mono text-[10px] text-muted-foreground">Instant</p>
                        </div>
                      </button>
                      <button
                        onClick={() => setMethod('crypto')}
                        className={cn(
                          'flex items-center gap-2.5 p-3.5 rounded-xl border transition-all',
                          method === 'crypto'
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border bg-card/50 text-muted-foreground hover:border-primary/40 hover:text-foreground'
                        )}
                      >
                        <Bitcoin className="w-4 h-4 shrink-0" />
                        <div className="text-left">
                          <p className="font-mono text-xs font-semibold">Crypto</p>
                          <p className="font-mono text-[10px] text-muted-foreground">BTC · LTC · USDT · ETH · SOL</p>
                        </div>
                      </button>
                      <button
                        onClick={() => setMethod('paypal')}
                        className={cn(
                          'flex items-center gap-2.5 p-3.5 rounded-xl border transition-all',
                          method === 'paypal'
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border bg-card/50 text-muted-foreground hover:border-primary/40 hover:text-foreground'
                        )}
                      >
                        <MessageSquare className="w-4 h-4 shrink-0" />
                        <div className="text-left">
                          <p className="font-mono text-xs font-semibold">PayPal</p>
                          <p className="font-mono text-[10px] text-muted-foreground">Discord ticket</p>
                        </div>
                      </button>
                    </div>
                  </div>

                  {/* Crypto currency selection */}
                  {method === 'crypto' && (
                    <div>
                      <p className="text-xs font-mono text-muted-foreground mb-2.5 uppercase tracking-wider">Currency</p>
                      <div className="grid grid-cols-3 gap-2">
                        {(['BTC', 'LTC', 'USDT', 'ETH', 'SOL'] as Currency[]).map(c => (
                          <button
                            key={c}
                            onClick={() => setCurrency(c)}
                            className={cn(
                              'py-2.5 rounded-xl border font-mono text-xs font-semibold transition-all',
                              currency === c
                                ? 'border-primary bg-primary/10 text-primary'
                                : 'border-border bg-card/50 text-muted-foreground hover:border-primary/50 hover:text-foreground'
                            )}
                          >
                            {c === 'BTC' ? 'Bitcoin' : c === 'LTC' ? 'Litecoin' : c === 'USDT' ? 'USDT' : c === 'ETH' ? 'Ethereum' : c === 'SOL' ? 'Solana' : c}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* PayPal Discord message */}
                  {method === 'paypal' && (
                    <div className="flex flex-col items-center justify-center gap-3 py-6 text-center bg-secondary/20 rounded-xl border border-primary/20">
                      <MessageSquare className="w-10 h-10 text-primary opacity-80" />
                      <div className="space-y-1">
                        <p className="font-mono text-sm font-bold text-foreground">Pay with PayPal</p>
                        <p className="font-mono text-xs text-muted-foreground">For PayPal payments, open a ticket in our Discord and a staff member will assist you.</p>
                      </div>
                      <a
                        href="https://discord.gg/exenotifier"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-flex items-center gap-2 px-5 py-2.5 bg-[#5865F2] hover:bg-[#4752C4] text-white font-mono text-xs font-bold uppercase tracking-wider transition-colors rounded-lg"
                      >
                        <MessageSquare className="w-4 h-4" /> Join Discord
                      </a>
                    </div>
                  )}

                  {/* Summary + CTA */}
                  {method !== 'paypal' && (
                  <div className="bg-secondary/20 rounded-xl p-4 flex items-center justify-between">
                    <div>
                      <p className="font-mono text-xs text-muted-foreground">Depositing</p>
                      <p className="font-display font-bold text-xl text-primary">${effectiveAmount > 0 ? effectiveAmount.toFixed(2) : '0.00'}</p>
                    </div>
                    <Button
                      onClick={method === 'stripe' ? handleStripeDeposit : handleCryptoDeposit}
                      disabled={isLoading || effectiveAmount < 1}
                      className="font-mono text-xs uppercase tracking-wider"
                    >
                      {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : method === 'stripe' ? 'Pay with Card' : 'Get Address'}
                    </Button>
                  </div>
                  )}
                </>
              ) : (
                /* Crypto address display */
                <div className="space-y-4">
                  <div className="text-center">
                    <p className="font-mono text-xs text-muted-foreground mb-1">Send exactly</p>
                    <p className="font-display font-bold text-2xl text-primary">{cryptoSession.amount} {cryptoSession.currency.toUpperCase()}</p>
                    <p className="font-mono text-xs text-muted-foreground mt-1">(≈ ${effectiveAmount.toFixed(2)} USD)</p>
                  </div>

                  <div>
                    <p className="text-xs font-mono text-muted-foreground mb-1.5 uppercase tracking-wider">Deposit Address</p>
                    <div className="flex items-center gap-2 bg-secondary/30 rounded-xl p-3 border border-border">
                      <p className="font-mono text-xs text-foreground break-all flex-1">{cryptoSession.address}</p>
                      <button
                        onClick={() => copyToClipboard(cryptoSession.address, 'address')}
                        className="shrink-0 p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-primary"
                      >
                        {copied === 'address' ? <Check className="w-4 h-4 text-primary" /> : <Copy className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-mono text-muted-foreground mb-1.5 uppercase tracking-wider">Exact Amount</p>
                    <div className="flex items-center gap-2 bg-secondary/30 rounded-xl p-3 border border-border">
                      <p className="font-mono text-sm font-bold text-foreground flex-1">{cryptoSession.amount} {cryptoSession.currency.toUpperCase()}</p>
                      <button
                        onClick={() => copyToClipboard(String(cryptoSession.amount), 'amount')}
                        className="shrink-0 p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-primary"
                      >
                        {copied === 'amount' ? <Check className="w-4 h-4 text-primary" /> : <Copy className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <p className="text-center font-mono text-xs text-muted-foreground/70">
                    Your balance will be credited automatically, or click verify once you've sent the payment.
                  </p>

                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      className="flex-1 font-mono text-xs"
                      onClick={handleDone}
                      disabled={isVerifying}
                    >
                      Close
                    </Button>
                    <Button
                      className="flex-[2] font-mono text-xs"
                      onClick={handleVerify}
                      disabled={isVerifying}
                    >
                      {isVerifying
                        ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Verifying…</>
                        : <><CheckCircle className="w-4 h-4 mr-2" /> Verify Payment</>}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
