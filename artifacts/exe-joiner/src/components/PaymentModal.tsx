import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { QRCodeSVG } from 'qrcode.react';
import { X, CreditCard, Bitcoin, Loader2, CheckCircle, Copy, Plus, Minus, Wallet, Tag, Check, MessageSquare } from 'lucide-react';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { 
  useCreateStripeSession, 
  useCreateCryptoSession, 
  useVerifyCryptoPayment,
  CreateCryptoSessionRequestCurrency
} from '@workspace/api-client-react';

interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  slotNumber: number;
  pricePerDay?: number;
  slotDurationHours?: number;
  hourlyPricingEnabled?: boolean;
  pricePerHour?: number;
  minHours?: number;
  userBalance?: number;
  onSuccess: () => void;
}

type Tab = 'crypto' | 'stripe' | 'balance' | 'paypal';

export function PaymentModal({
  isOpen,
  onClose,
  slotNumber,
  pricePerDay = 20,
  slotDurationHours = 24,
  hourlyPricingEnabled = false,
  pricePerHour = 5,
  minHours = 2,
  userBalance = 0,
  onSuccess,
}: PaymentModalProps) {
  const [tab, setTab] = useState<Tab>('crypto');
  const [currency, setCurrency] = useState<CreateCryptoSessionRequestCurrency>('BTC');
  const [selectedHours, setSelectedHours] = useState<number>(minHours);
  const [isBalanceLoading, setIsBalanceLoading] = useState(false);
  const { toast } = useToast();

  const [couponInput, setCouponInput] = useState('');
  const [isValidatingCoupon, setIsValidatingCoupon] = useState(false);
  const [appliedCoupon, setAppliedCoupon] = useState<{ couponId: number; discountAmount: number; finalPrice: number; code: string } | null>(null);

  useEffect(() => {
    setSelectedHours(minHours);
    setCouponInput('');
    setAppliedCoupon(null);
  }, [minHours, isOpen]);

  const { mutate: createStripe, isPending: isStripeLoading } = useCreateStripeSession();
  const { mutate: createCrypto, data: cryptoSession, isPending: isCryptoLoading, reset: resetCrypto } = useCreateCryptoSession();
  const { mutate: verifyCrypto, isPending: isVerifyLoading } = useVerifyCryptoPayment();

  const basePrice = hourlyPricingEnabled ? selectedHours * pricePerHour : pricePerDay;
  const totalPrice = appliedCoupon ? appliedCoupon.finalPrice : basePrice;

  const durationLabel = hourlyPricingEnabled ? `${selectedHours}h` : `${slotDurationHours}h`;

  const handleClose = () => {
    fetch(`${import.meta.env.BASE_URL}api/payments/cancel-pending`, {
      method: 'DELETE',
      credentials: 'include',
    }).catch(() => {});
    resetCrypto();
    onClose();
  };

  const handleApplyCoupon = async () => {
    if (!couponInput.trim()) return;
    setIsValidatingCoupon(true);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/coupons/validate`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: couponInput.trim().toUpperCase(), price: basePrice }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Invalid coupon');
      setAppliedCoupon({ ...data, code: couponInput.trim().toUpperCase() });
      toast({ title: 'Coupon applied!', description: `Saved $${data.discountAmount.toFixed(2)}`, className: 'bg-primary text-primary-foreground border-none' });
    } catch (e: any) {
      toast({ title: 'Invalid coupon', description: e.message, variant: 'destructive' });
    } finally {
      setIsValidatingCoupon(false);
    }
  };

  const removeCoupon = () => {
    setAppliedCoupon(null);
    setCouponInput('');
  };

  const handleBalancePay = async () => {
    setIsBalanceLoading(true);
    try {
      const body: any = { slotNumber };
      if (hourlyPricingEnabled) body.hours = selectedHours;
      if (appliedCoupon) body.couponId = appliedCoupon.couponId;
      const res = await fetch(`${import.meta.env.BASE_URL}api/balance/use`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Payment failed');
      toast({ title: "Slot Activated!", description: `Slot #${slotNumber} is now yours. Remaining balance: $${parseFloat(data.balance).toFixed(2)}`, className: "bg-primary text-primary-foreground border-none" });
      onSuccess();
      handleClose();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setIsBalanceLoading(false);
    }
  };

  const canPayWithBalance = userBalance >= totalPrice;

  const handleStripePay = () => {
    const data: any = { slotNumber };
    if (hourlyPricingEnabled) data.hours = selectedHours;
    if (appliedCoupon) data.couponId = appliedCoupon.couponId;
    createStripe({ data }, {
      onSuccess: (res) => { window.location.href = res.url; },
      onError: (err) => {
        toast({ title: "Error", description: err.message || "Failed to initialize Stripe", variant: "destructive" });
      }
    });
  };

  const handleCryptoGenerate = () => {
    const data: any = { slotNumber, currency };
    if (hourlyPricingEnabled) data.hours = selectedHours;
    if (appliedCoupon) data.couponId = appliedCoupon.couponId;
    createCrypto({ data }, {
      onError: (err) => {
        toast({ title: "Error", description: err.message || "Failed to generate crypto session", variant: "destructive" });
      }
    });
  };

  const handleVerify = () => {
    if (!cryptoSession) return;
    verifyCrypto({ data: { paymentId: cryptoSession.paymentId } }, {
      onSuccess: () => {
        toast({ title: "Payment Verified!", description: `Slot ${slotNumber} is now active.`, className: "bg-primary text-primary-foreground" });
        onSuccess();
        handleClose();
      },
      onError: (err) => {
        toast({ title: "Verification Failed", description: err.message || "Payment not found yet. Try again in a minute.", variant: "destructive" });
      }
    });
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied!", description: `${label} copied to clipboard.` });
  };

  if (!isOpen) return null;

  const HourSelector = () => (
    <div className="space-y-3">
      <label className="text-xs font-mono uppercase text-muted-foreground">Select Hours</label>
      <div className="flex items-center gap-3">
        <button
          onClick={() => setSelectedHours(h => Math.max(minHours, h - 1))}
          disabled={selectedHours <= minHours}
          className="w-10 h-10 border border-primary/30 flex items-center justify-center text-primary hover:bg-primary/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors chamfered"
        >
          <Minus className="w-4 h-4" />
        </button>
        <div className="flex-1 text-center">
          <span className="text-3xl font-display font-bold text-primary">{selectedHours}</span>
          <span className="text-muted-foreground font-mono text-sm ml-1">hr{selectedHours !== 1 ? 's' : ''}</span>
        </div>
        <button
          onClick={() => setSelectedHours(h => h + 1)}
          className="w-10 h-10 border border-primary/30 flex items-center justify-center text-primary hover:bg-primary/10 transition-colors chamfered"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>
      {minHours > 1 && (
        <p className="text-xs text-muted-foreground font-mono text-center">Minimum purchase: {minHours} hours</p>
      )}
      <div className="grid grid-cols-4 gap-1.5 pt-1">
        {[minHours, minHours + 2, minHours + 6, minHours + 22].filter((v, i, a) => a.indexOf(v) === i).map(h => (
          <button
            key={h}
            onClick={() => setSelectedHours(h)}
            className={cn(
              "py-1.5 text-xs font-mono border transition-all chamfered-btn",
              selectedHours === h
                ? "border-primary bg-primary/10 text-primary"
                : "border-primary/20 text-muted-foreground hover:border-primary/50"
            )}
          >
            {h}h
          </button>
        ))}
      </div>
    </div>
  );

  const PriceSummary = () => (
    <div className="bg-secondary/50 p-4 border border-primary/20 space-y-1">
      {appliedCoupon && (
        <div className="flex justify-between items-center">
          <span className="text-muted-foreground font-mono text-xs uppercase">Original</span>
          <span className="font-mono text-sm text-muted-foreground line-through">${basePrice.toFixed(2)}</span>
        </div>
      )}
      {appliedCoupon && (
        <div className="flex justify-between items-center">
          <span className="text-green-400 font-mono text-xs uppercase">Discount ({appliedCoupon.code})</span>
          <span className="font-mono text-sm text-green-400">-${appliedCoupon.discountAmount.toFixed(2)}</span>
        </div>
      )}
      <div className="flex justify-between items-center pt-1">
        <span className="text-muted-foreground font-mono text-sm uppercase">Total</span>
        <div className="text-right">
          <span className="text-2xl font-display font-bold text-primary glow-text">${totalPrice.toFixed(2)}</span>
          <p className="text-xs text-muted-foreground font-mono mt-0.5">
            {hourlyPricingEnabled
              ? `${selectedHours}h × $${pricePerHour.toFixed(2)}/hr`
              : `/ ${slotDurationHours}h · $${(pricePerDay / slotDurationHours).toFixed(2)}/hr`}
          </p>
        </div>
      </div>
    </div>
  );


  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0 }} 
          animate={{ opacity: 1 }} 
          exit={{ opacity: 0 }} 
          onClick={handleClose}
          className="absolute inset-0 bg-background/80 backdrop-blur-sm"
        />
        
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="relative w-full max-w-lg z-10"
        >
          <Card className="border-primary/50 shadow-2xl shadow-primary/20 bg-background/95">
            <div className="flex items-center justify-between p-6 border-b border-primary/20 bg-primary/5">
              <h2 className="text-xl font-display font-bold text-primary uppercase tracking-wider flex items-center gap-2">
                <span className="text-primary/50">[</span> 
                Purchase Slot {slotNumber} 
                <span className="text-primary/50">]</span>
              </h2>
              <button onClick={handleClose} className="text-muted-foreground hover:text-primary transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6">
              {canPayWithBalance && (
                <div className="mb-4 p-3.5 rounded-xl border border-primary/30 bg-primary/5 flex items-center gap-3">
                  <Wallet className="w-4 h-4 text-primary shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-mono text-xs text-muted-foreground">Your balance</p>
                    <p className="font-mono text-sm font-bold text-primary">${userBalance.toFixed(2)}</p>
                  </div>
                  <button
                    onClick={() => setTab('balance')}
                    className={cn(
                      "px-3 py-1.5 rounded-lg font-mono text-xs font-semibold transition-all shrink-0",
                      tab === 'balance' ? "bg-primary text-primary-foreground" : "border border-primary/30 text-primary hover:bg-primary/10"
                    )}
                  >
                    Use Balance
                  </button>
                </div>
              )}

              {/* Coupon input */}
              <div className="mb-4">
                {appliedCoupon ? (
                  <div className="flex items-center gap-2 p-2.5 border border-green-500/30 bg-green-500/5 rounded-lg">
                    <Check className="w-3.5 h-3.5 text-green-400 shrink-0" />
                    <span className="font-mono text-xs text-green-400 flex-1">Coupon <span className="font-bold">{appliedCoupon.code}</span> applied — saves ${appliedCoupon.discountAmount.toFixed(2)}</span>
                    <button onClick={removeCoupon} className="text-muted-foreground hover:text-red-400 transition-colors">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Tag className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                      <input
                        type="text"
                        placeholder="Coupon code"
                        value={couponInput}
                        onChange={e => setCouponInput(e.target.value.toUpperCase())}
                        onKeyDown={e => e.key === 'Enter' && handleApplyCoupon()}
                        className="w-full bg-secondary/50 border border-primary/20 text-foreground font-mono text-xs px-3 py-2 pl-8 focus:outline-none focus:border-primary/50 uppercase placeholder:normal-case"
                      />
                    </div>
                    <button
                      onClick={handleApplyCoupon}
                      disabled={isValidatingCoupon || !couponInput.trim()}
                      className="px-3 py-2 border border-primary/30 font-mono text-xs text-primary hover:bg-primary/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      {isValidatingCoupon ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Apply'}
                    </button>
                  </div>
                )}
              </div>

              <div className="flex p-1 bg-secondary rounded-none mb-6 chamfered">
                <button
                  onClick={() => setTab('crypto')}
                  className={cn(
                    "flex-1 py-2 text-sm font-mono uppercase tracking-wider transition-colors chamfered flex items-center justify-center gap-2",
                    tab === 'crypto' ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Bitcoin className="w-4 h-4" /> Crypto
                </button>
                <button
                  onClick={() => setTab('stripe')}
                  className={cn(
                    "flex-1 py-2 text-sm font-mono uppercase tracking-wider transition-colors chamfered flex items-center justify-center gap-2",
                    tab === 'stripe' ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <CreditCard className="w-4 h-4" /> Card
                </button>
                <button
                  onClick={() => setTab('paypal')}
                  className={cn(
                    "flex-1 py-2 text-sm font-mono uppercase tracking-wider transition-colors chamfered flex items-center justify-center gap-2",
                    tab === 'paypal' ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <MessageSquare className="w-4 h-4" /> PayPal
                </button>
              </div>

              {tab === 'stripe' && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
                  {hourlyPricingEnabled && <HourSelector />}
                  <PriceSummary />
                  <Button 
                    className="w-full h-14 text-lg" 
                    onClick={handleStripePay} 
                    disabled={isStripeLoading}
                  >
                    {isStripeLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Proceed to Checkout"}
                  </Button>
                </div>
              )}

              {tab === 'crypto' && !cryptoSession && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
                  {hourlyPricingEnabled && <HourSelector />}
                  <div className="space-y-3">
                    <label className="text-xs font-mono uppercase text-muted-foreground">Select Currency</label>
                    <div className="grid grid-cols-3 gap-2">
                      {Object.values(CreateCryptoSessionRequestCurrency).map(c => (
                        <button
                          key={c}
                          onClick={() => setCurrency(c)}
                          className={cn(
                            "py-3 border font-mono font-bold transition-all chamfered-btn text-xs",
                            currency === c 
                              ? "border-primary bg-primary/10 text-primary glow-box" 
                              : "border-primary/20 bg-transparent text-muted-foreground hover:border-primary/50"
                          )}
                        >
                          {c === 'BTC' ? 'Bitcoin' : c === 'LTC' ? 'Litecoin' : c === 'USDT' ? 'USDT' : c === 'ETH' ? 'Ethereum' : c === 'SOL' ? 'Solana' : c}
                        </button>
                      ))}
                    </div>
                  </div>
                  <PriceSummary />
                  <Button 
                    className="w-full h-14" 
                    onClick={handleCryptoGenerate}
                    disabled={isCryptoLoading}
                  >
                    {isCryptoLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Generate Payment Address"}
                  </Button>
                </div>
              )}

              {tab === 'crypto' && cryptoSession && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
                  <div className="flex justify-center p-4 bg-white chamfered">
                    <QRCodeSVG 
                      value={`${cryptoSession.currency.toLowerCase()}:${cryptoSession.address}?amount=${cryptoSession.amount}`} 
                      size={180}
                      level="H"
                      includeMargin
                    />
                  </div>

                  <div className="space-y-3">
                    <div className="bg-secondary p-3 border border-primary/20 chamfered">
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-xs font-mono text-muted-foreground uppercase">Amount ({cryptoSession.currency})</span>
                        <button onClick={() => copyToClipboard(cryptoSession.amount, "Amount")} className="text-primary hover:text-primary/80"><Copy className="w-4 h-4"/></button>
                      </div>
                      <div className="font-mono text-lg text-foreground font-bold break-all">
                        {cryptoSession.amount}
                      </div>
                    </div>

                    <div className="bg-secondary p-3 border border-primary/20 chamfered">
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-xs font-mono text-muted-foreground uppercase">Address</span>
                        <button onClick={() => copyToClipboard(cryptoSession.address, "Address")} className="text-primary hover:text-primary/80"><Copy className="w-4 h-4"/></button>
                      </div>
                      <div className="font-mono text-sm text-primary break-all">
                        {cryptoSession.address}
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-3">
                    <Button 
                      variant="outline" 
                      className="flex-1" 
                      onClick={() => resetCrypto()}
                      disabled={isVerifyLoading}
                    >
                      Cancel
                    </Button>
                    <Button 
                      className="flex-[2]" 
                      onClick={handleVerify}
                      disabled={isVerifyLoading}
                    >
                      {isVerifyLoading ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <CheckCircle className="w-5 h-5 mr-2" />}
                      Verify Payment
                    </Button>
                  </div>
                  <p className="text-center text-xs text-muted-foreground font-mono">
                    Click verify after sending the exact amount. <br/>Session expires in 15 minutes.
                  </p>
                </div>
              )}

              {tab === 'balance' && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
                  {hourlyPricingEnabled && <HourSelector />}
                  <div className="bg-secondary/30 p-4 rounded-xl border border-primary/20">
                    <div className="flex items-center justify-between mb-3">
                      <span className="font-mono text-xs text-muted-foreground uppercase">Available Balance</span>
                      <span className="font-mono text-sm font-bold text-primary">${userBalance.toFixed(2)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs text-muted-foreground uppercase">Slot Cost</span>
                      <span className="font-mono text-sm font-bold text-foreground">${totalPrice.toFixed(2)}</span>
                    </div>
                    <div className="h-px bg-border my-3" />
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs text-muted-foreground uppercase">After Purchase</span>
                      <span className="font-mono text-sm font-bold text-primary">${Math.max(0, userBalance - totalPrice).toFixed(2)}</span>
                    </div>
                  </div>
                  <Button
                    className="w-full h-14 text-base"
                    onClick={handleBalancePay}
                    disabled={isBalanceLoading || !canPayWithBalance}
                  >
                    {isBalanceLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Wallet className="w-4 h-4 mr-2" /> Pay with Balance</>}
                  </Button>
                </div>
              )}

              {tab === 'paypal' && (
                <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
                  <div className="flex flex-col items-center justify-center gap-3 py-8 text-center bg-secondary/30 border border-primary/20 chamfered">
                    <MessageSquare className="w-10 h-10 text-primary opacity-80" />
                    <div className="space-y-1">
                      <p className="font-mono text-sm font-bold text-foreground">Pay with PayPal</p>
                      <p className="font-mono text-xs text-muted-foreground">For PayPal payments, open a ticket in our Discord and a staff member will assist you.</p>
                    </div>
                    <a
                      href="https://discord.gg/PLACEHOLDER"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex items-center gap-2 px-5 py-2.5 bg-[#5865F2] hover:bg-[#4752C4] text-white font-mono text-xs font-bold uppercase tracking-wider transition-colors chamfered-btn"
                    >
                      <MessageSquare className="w-4 h-4" /> Join Discord
                    </a>
                  </div>
                </div>
              )}
            </div>
          </Card>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
