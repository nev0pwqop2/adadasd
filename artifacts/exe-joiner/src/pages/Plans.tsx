import React from 'react';
import { useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Zap, Clock, Shield, DiscIcon as Discord } from 'lucide-react';
import { motion } from 'framer-motion';

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${import.meta.env.BASE_URL}${path}`);
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
}

type PublicSettings = {
  slotCount: number;
  pricePerDay: number;
  slotDurationHours: number;
  hourlyPricingEnabled: boolean;
  pricePerHour: number;
  minHours: number;
  activeCount: number;
};

export default function PlansPage() {
  const [, setLocation] = useLocation();

  const { data, isLoading } = useQuery({
    queryKey: ['public-settings'],
    queryFn: () => apiFetch<PublicSettings>('api/slots/public-settings'),
  });

  const available = data ? data.slotCount - data.activeCount : null;

  const features = [
    { icon: <Zap className="w-4 h-4 text-[#f5a623]" />, text: 'Instant script key delivery via DM' },
    { icon: <Shield className="w-4 h-4 text-[#f5a623]" />, text: 'Luarmor-protected key with HWID lock' },
    { icon: <Discord className="w-4 h-4 text-[#f5a623]" />, text: 'HWID reset available in dashboard' },
    { icon: <Clock className="w-4 h-4 text-[#f5a623]" />, text: 'Auto-renewed or expires cleanly' },
  ];

  return (
    <div className="min-h-screen bg-[#0e0e10] text-white">
      {/* Navbar */}
      <nav className="sticky top-0 z-50 w-full bg-[#111113]/90 backdrop-blur border-b border-white/[0.06] px-4 md:px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <img src={`${import.meta.env.BASE_URL}exe-logo.png`} alt="EXE" className="w-7 h-7 rounded-lg" />
          <span className="font-bold text-[15px] text-white/90">Exe Joiner</span>
        </div>
        <nav className="hidden sm:flex items-center gap-6">
          {[
            { label: 'Home',        href: `${import.meta.env.BASE_URL}` },
            { label: 'Plans',       href: `${import.meta.env.BASE_URL}plans`, active: true },
            { label: 'Leaderboard', href: `${import.meta.env.BASE_URL}leaderboard` },
            { label: 'Dashboard',  href: `${import.meta.env.BASE_URL}dashboard` },
          ].map(({ label, href, active }) => (
            <a
              key={label}
              href={href}
              className={`text-sm transition-colors ${active ? 'text-[#f5a623] font-semibold' : 'text-white/45 hover:text-white/75'}`}
            >
              {label}
            </a>
          ))}
        </nav>
        <button
          onClick={() => setLocation('/')}
          className="flex items-center gap-1.5 text-sm text-white/50 hover:text-white/80 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
      </nav>

      {/* Content */}
      <div className="max-w-2xl mx-auto px-4 py-14 text-center">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
          <p className="text-xs font-semibold uppercase tracking-widest text-[#f5a623]/70 mb-3">Pricing</p>
          <h1 className="text-3xl md:text-4xl font-extrabold text-white leading-tight mb-3">
            One plan. <span className="text-[#f5a623]">No tricks.</span>
          </h1>
          <p className="text-sm text-white/40 mb-10">
            Rent a limited slot and get your script key the moment you pay.
          </p>
        </motion.div>

        {isLoading ? (
          <div className="flex justify-center py-16">
            <div className="w-6 h-6 border-2 border-[#f5a623] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="rounded-2xl border border-[#f5a623]/20 bg-[#f5a623]/[0.04] p-8 text-left"
          >
            {/* Availability badge */}
            <div className="flex items-center justify-between mb-6">
              <span className="text-xs font-semibold uppercase tracking-wider text-white/30">Slot rental</span>
              {available !== null && (
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                  available > 0 ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'
                }`}>
                  {available > 0 ? `${available} slot${available !== 1 ? 's' : ''} available` : 'Sold out'}
                </span>
              )}
            </div>

            {/* Price */}
            <div className="mb-6">
              {data?.hourlyPricingEnabled ? (
                <>
                  <div className="flex items-end gap-2 mb-1">
                    <span className="text-5xl font-extrabold text-white">${data.pricePerHour.toFixed(2)}</span>
                    <span className="text-lg text-white/40 mb-1.5">/hr</span>
                  </div>
                  <p className="text-xs text-white/35">
                    Minimum {data.minHours}h &mdash; up to {data.slotDurationHours}h max per rental
                  </p>
                </>
              ) : (
                <>
                  <div className="flex items-end gap-2 mb-1">
                    <span className="text-5xl font-extrabold text-white">${data?.pricePerDay.toFixed(2)}</span>
                    <span className="text-lg text-white/40 mb-1.5">/{data?.slotDurationHours}h</span>
                  </div>
                  <p className="text-xs text-white/35">
                    Flat rate &mdash; {data?.slotDurationHours} hours of access per rental
                  </p>
                </>
              )}
            </div>

            {/* Features */}
            <ul className="space-y-3 mb-8">
              {features.map(({ icon, text }) => (
                <li key={text} className="flex items-center gap-3 text-sm text-white/70">
                  {icon}
                  {text}
                </li>
              ))}
            </ul>

            {/* Slot stats */}
            <div className="flex gap-4 mb-8">
              <div className="flex-1 rounded-xl bg-white/[0.03] border border-white/[0.06] p-3 text-center">
                <p className="text-xl font-bold text-white">{data?.slotCount}</p>
                <p className="text-xs text-white/30 mt-0.5">Total slots</p>
              </div>
              <div className="flex-1 rounded-xl bg-white/[0.03] border border-white/[0.06] p-3 text-center">
                <p className="text-xl font-bold text-white">{data?.activeCount}</p>
                <p className="text-xs text-white/30 mt-0.5">Active now</p>
              </div>
              <div className="flex-1 rounded-xl bg-white/[0.03] border border-white/[0.06] p-3 text-center">
                <p className="text-xl font-bold text-[#f5a623]">{data?.slotDurationHours}h</p>
                <p className="text-xs text-white/30 mt-0.5">Duration</p>
              </div>
            </div>

            {/* CTA */}
            <a
              href={`${import.meta.env.BASE_URL}dashboard`}
              className="block w-full text-center bg-[#f5a623] hover:bg-[#f5a623]/90 text-black font-bold text-sm py-3 rounded-xl transition-colors"
            >
              Get a slot
            </a>
            <p className="text-center text-xs text-white/25 mt-3">
              Pay with Stripe, crypto (BTC, ETH, LTC, USDT, SOL), or wallet balance
            </p>
          </motion.div>
        )}
      </div>
    </div>
  );
}
