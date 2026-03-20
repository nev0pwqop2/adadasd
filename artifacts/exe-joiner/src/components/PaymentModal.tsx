import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { QRCodeSVG } from 'qrcode.react';
import { X, CreditCard, Bitcoin, Loader2, CheckCircle, Copy } from 'lucide-react';
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
  onSuccess: () => void;
}

type Tab = 'crypto' | 'stripe';

export function PaymentModal({ isOpen, onClose, slotNumber, onSuccess }: PaymentModalProps) {
  const [tab, setTab] = useState<Tab>('crypto');
  const [currency, setCurrency] = useState<CreateCryptoSessionRequestCurrency>('LTC');
  const { toast } = useToast();

  // Mutations
  const { mutate: createStripe, isPending: isStripeLoading } = useCreateStripeSession();
  const { mutate: createCrypto, data: cryptoSession, isPending: isCryptoLoading, reset: resetCrypto } = useCreateCryptoSession();
  const { mutate: verifyCrypto, isPending: isVerifyLoading } = useVerifyCryptoPayment();

  const handleClose = () => {
    resetCrypto();
    onClose();
  };

  const handleStripePay = () => {
    createStripe({ data: { slotNumber } }, {
      onSuccess: (data) => {
        window.location.href = data.url;
      },
      onError: (err) => {
        toast({ title: "Error", description: err.message || "Failed to initialize Stripe", variant: "destructive" });
      }
    });
  };

  const handleCryptoGenerate = () => {
    createCrypto({ data: { slotNumber, currency } }, {
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
              </div>

              {tab === 'stripe' && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
                  <div className="bg-secondary/50 p-4 border border-primary/20 text-center space-y-2">
                    <p className="text-muted-foreground font-mono text-sm uppercase">Total Amount</p>
                    <p className="text-4xl font-display font-bold text-primary glow-text">$4.99</p>
                    <p className="text-xs text-muted-foreground font-mono">/ month</p>
                  </div>
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
                  <div className="space-y-3">
                    <label className="text-xs font-mono uppercase text-muted-foreground">Select Currency</label>
                    <div className="grid grid-cols-3 gap-2">
                      {Object.values(CreateCryptoSessionRequestCurrency).map(c => (
                        <button
                          key={c}
                          onClick={() => setCurrency(c)}
                          className={cn(
                            "py-3 border font-mono font-bold transition-all chamfered-btn",
                            currency === c 
                              ? "border-primary bg-primary/10 text-primary glow-box" 
                              : "border-primary/20 bg-transparent text-muted-foreground hover:border-primary/50"
                          )}
                        >
                          {c}
                        </button>
                      ))}
                    </div>
                  </div>
                  
                  <div className="bg-secondary/50 p-4 border border-primary/20 text-center flex justify-between items-center">
                    <span className="text-muted-foreground font-mono text-sm uppercase">Price</span>
                    <span className="text-xl font-display font-bold text-primary">$4.99</span>
                  </div>

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
            </div>
          </Card>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
