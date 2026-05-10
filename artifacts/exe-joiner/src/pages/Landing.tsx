import React, { useEffect, useState, useRef } from 'react';
import { useGetMe } from '@workspace/api-client-react';
import Navbar from '@/components/Navbar';
import { useQuery } from '@tanstack/react-query';

const ERROR_MESSAGES: Record<string, string> = {
  token_exchange_failed: 'Login failed — Discord rejected the token exchange.',
  rate_limited: 'Discord is rate limiting. Wait 1–2 minutes and try again.',
  discord_denied: 'You cancelled the Discord login.',
  invalid_state: 'Login session expired. Please try again.',
  no_code: 'No authorisation code received from Discord.',
  user_fetch_failed: 'Could not retrieve your Discord profile.',
  server_error: 'An unexpected server error occurred.',
};

type BrainrotEntry = { name: string; value: string };
type FeedGroup = {
  id: string;
  time: Date;
  entries: BrainrotEntry[];
  category: 'PEAKLIGHTS' | 'HIGHLIGHTS' | 'MIDLIGHTS' | 'DUEL';
  topValue: number;
};

type ReviewEntry = {
  id: number; rating: number; body: string; createdAt: string;
  username: string; avatar: string | null; discordId: string;
};

function fmtVal(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B/s`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M/s`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K/s`;
  return `$${n}/s`;
}

function getCategory(v: number, duel: boolean): FeedGroup['category'] {
  if (duel) return 'DUEL';
  if (v >= 250_000_000) return 'PEAKLIGHTS';
  if (v >= 80_000_000) return 'HIGHLIGHTS';
  return 'MIDLIGHTS';
}

function parseAllBrainrots(all: string, fallbackValue: number): BrainrotEntry[] {
  if (!all) return [];
  const parts = all.split(', ');
  return parts.slice(0, 8).map(part => {
    const m = part.match(/^([\d]+x\s)?(.+?)(?:\s\((\$[\d.]+[KMBs\/]+)\))?$/);
    return {
      name: m ? (m[1] || '') + (m[2] || part) : part,
      value: m?.[3] ?? fmtVal(fallbackValue),
    };
  });
}

const FEED_DELAY_MS = 3 * 60 * 60 * 1000; // 3 hours

type PendingGroup = FeedGroup & { displayAt: number };

function useLiveFeed() {
  const [groups, setGroups] = useState<FeedGroup[]>([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<PendingGroup[]>([]);
  const flushRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Flush pending items that have waited long enough
    flushRef.current = setInterval(() => {
      const now = Date.now();
      const ready: FeedGroup[] = [];
      const still: PendingGroup[] = [];
      for (const item of pendingRef.current) {
        if (now >= item.displayAt) {
          const { displayAt: _d, ...group } = item;
          ready.push(group);
        } else {
          still.push(item);
        }
      }
      pendingRef.current = still;
      if (ready.length > 0) {
        setGroups(prev => [...ready, ...prev].slice(0, 25));
      }
    }, 5000);

    function connect() {
      try {
        const ws = new WebSocket('wss://gigue.onrender.com');
        wsRef.current = ws;
        ws.onopen = () => setConnected(true);
        ws.onmessage = (e) => {
          try {
            const data = JSON.parse(e.data);
            if (!data.bestName || data.success || data.info) return;
            if ((data.bestValue || 0) < 10_000_000) return;
            const group: PendingGroup = {
              id: `${Date.now()}-${Math.random()}`,
              time: new Date(),
              entries: parseAllBrainrots(data.allBrainrots || data.bestName, data.bestValue || 0),
              category: getCategory(data.bestValue || 0, !!data.duel),
              topValue: data.bestValue || 0,
              displayAt: Date.now() + FEED_DELAY_MS,
            };
            pendingRef.current = [...pendingRef.current, group];
          } catch {}
        };
        ws.onclose = () => {
          setConnected(false);
          timerRef.current = setTimeout(connect, 3000);
        };
        ws.onerror = () => ws.close();
      } catch {}
    }
    connect();
    return () => {
      wsRef.current?.close();
      if (timerRef.current) clearTimeout(timerRef.current);
      if (flushRef.current) clearInterval(flushRef.current);
    };
  }, []);

  return { groups, connected };
}

function timeStr(d: Date) {
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

const CAT_STYLES: Record<string, string> = {
  PEAKLIGHTS: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  HIGHLIGHTS: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
  MIDLIGHTS:  'bg-[#5a3a00]/60 text-[#c8831a] border-[#8a5500]/40',
  DUEL:       'bg-red-500/15 text-red-300 border-red-500/25',
};

function nameColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue},60%,60%)`;
}

const brainrotImageCache = new Map<string, string | null>();

async function fetchBrainrotImage(rawName: string): Promise<string | null> {
  const name = rawName.replace(/^\d+x\s*/, '').trim();
  if (brainrotImageCache.has(name)) return brainrotImageCache.get(name)!;
  brainrotImageCache.set(name, null);
  try {
    const encoded = encodeURIComponent(name);
    const url = `https://stealabrainrot.fandom.com/api.php?action=query&prop=pageimages&format=json&piprop=thumbnail&pithumbsize=120&titles=${encoded}&origin=*`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const pages = data?.query?.pages ?? {};
    for (const page of Object.values(pages) as any[]) {
      if (page?.thumbnail?.source) {
        brainrotImageCache.set(name, page.thumbnail.source);
        return page.thumbnail.source;
      }
    }
  } catch {}
  return null;
}

function BrainrotAvatar({ name }: { name: string }) {
  const color = nameColor(name);
  const initials = name.replace(/^\d+x\s*/, '').trim().slice(0, 2).toUpperCase();
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [imgErr, setImgErr] = useState(false);

  useEffect(() => {
    const clean = name.replace(/^\d+x\s*/, '').trim();
    const cached = brainrotImageCache.get(clean);
    if (cached !== undefined) { setImgSrc(cached); return; }
    fetchBrainrotImage(name).then(src => setImgSrc(src));
  }, [name]);

  if (imgSrc && !imgErr) {
    return (
      <img src={imgSrc} alt={name} onError={() => setImgErr(true)}
        className="w-6 h-6 rounded-md flex-shrink-0 object-cover" />
    );
  }

  return (
    <div className="w-6 h-6 rounded-md flex-shrink-0 flex items-center justify-center text-[8px] font-bold"
      style={{ background: color + '22', border: `1px solid ${color}44`, color }}>
      {initials}
    </div>
  );
}

function CategoryBadge({ cat }: { cat: string }) {
  return (
    <span className={`text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded border ${CAT_STYLES[cat] ?? CAT_STYLES.MIDLIGHTS}`}>
      {cat}
    </span>
  );
}

function StarRow({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5">
      {[1,2,3,4,5].map(i => (
        <svg key={i} width="11" height="11" viewBox="0 0 24 24"
          fill={i <= rating ? '#f5a623' : 'none'}
          stroke={i <= rating ? '#f5a623' : '#ffffff20'}
          strokeWidth="1.5">
          <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/>
        </svg>
      ))}
    </div>
  );
}

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${import.meta.env.BASE_URL}${path}`);
  if (!res.ok) throw new Error('Failed');
  return res.json();
}

export default function Landing() {
  const { data: user } = useGetMe({ query: { retry: false, staleTime: 30000 } as any });
  const { groups, connected } = useLiveFeed();
  const feedRef = useRef<HTMLDivElement>(null);

  const params = new URLSearchParams(window.location.search);
  const errorCode = params.get('error');

  useEffect(() => {
    const ref = params.get('ref');
    if (ref) sessionStorage.setItem('ref_code', ref);
  }, []);

  const handleLogin = () => {
    const ref = sessionStorage.getItem('ref_code');
    const refParam = ref ? `?ref=${encodeURIComponent(ref)}` : '';
    window.location.href = `${import.meta.env.BASE_URL}api/auth/discord${refParam}`;
  };

  const { data: slotsData } = useQuery({
    queryKey: ['slots-public-landing'],
    queryFn: () => apiFetch<{ slots: any[]; totalSlots: number; nextExpiresAt: string | null }>('api/slots'),
    refetchInterval: 15000,
    retry: false,
  });

  const { data: reviewsData } = useQuery<{ reviews: ReviewEntry[] }>({
    queryKey: ['public-reviews'],
    queryFn: async () => {
      const res = await fetch(`${import.meta.env.BASE_URL}api/reviews`);
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    staleTime: 60000,
  });

  const reviews = reviewsData?.reviews ?? [];
  const activeSlots = slotsData?.slots?.filter((s: any) => s.isActive).length ?? 0;
  const totalSlots = slotsData?.totalSlots ?? 5;
  const base = import.meta.env.BASE_URL;

  return (
    <div className="min-h-screen bg-[#110d08] text-white flex flex-col overflow-x-hidden">
      <div className="pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(ellipse_90%_55%_at_50%_100%,hsla(30,70%,18%,0.55),transparent)]" />

      <Navbar current="home" />

      {/* ── Hero Section ── */}
      <main className="relative z-10 w-full max-w-6xl mx-auto px-5 pt-12 pb-6">

        {/* Top ticker pill */}
        <div className="mb-8">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-white/10 bg-white/[0.04] text-[10px] font-semibold text-white/40 tracking-widest uppercase">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            LIVE · PEAKLIGHTS · HIGHLIGHTS · MIDLIGHTS
          </span>
        </div>

        {/* Split hero */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-start">

          {/* Left — Hero copy */}
          <div className="flex flex-col">
            <img
              src={`${base}exe-logo.gif`}
              alt="Exe Notifier"
              className="w-20 h-20 object-contain mb-8 drop-shadow-[0_0_40px_rgba(245,166,35,0.45)]"
            />

            <h1 className="text-4xl sm:text-5xl font-extrabold leading-[1.1] mb-1 text-white">
              Real-time alerts.
            </h1>
            <h1 className="text-4xl sm:text-5xl font-extrabold leading-[1.1] text-[#f5a623] mb-6">
              Zero delay.
            </h1>

            <p className="text-sm sm:text-base text-white/40 max-w-sm mb-8 leading-relaxed">
              Get notified the moment it matters. Choose your plan and never miss high-gen logs again.
            </p>

            {errorCode && (
              <div className="mb-5 px-4 py-2.5 rounded-xl border border-red-500/25 bg-red-500/8 text-xs text-red-400 max-w-xs">
                {ERROR_MESSAGES[errorCode] ?? `Error: ${errorCode}`}
              </div>
            )}

            {user ? (
              <div className="flex flex-wrap items-center gap-3">
                <a href={`${base}dashboard`} className="px-6 h-10 rounded-xl bg-[#f5a623] text-black font-bold text-sm hover:bg-[#e8961a] transition-colors shadow-[0_4px_20px_rgba(245,166,35,0.4)] flex items-center">
                  Dashboard
                </a>
                <a href={`${base}plans`} className="px-6 h-10 rounded-xl border border-white/12 bg-white/[0.05] text-sm font-medium text-white/60 hover:text-white/90 hover:border-white/20 transition-colors flex items-center">
                  View plans
                </a>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <a href={`${base}plans`} className="px-6 h-10 rounded-xl bg-[#f5a623] text-black font-bold text-sm hover:bg-[#e8961a] transition-colors shadow-[0_4px_20px_rgba(245,166,35,0.4)] flex items-center">
                  View plans
                </a>
                <button
                  onClick={handleLogin}
                  className="px-6 h-10 rounded-xl border border-white/12 bg-white/[0.05] text-sm font-medium text-white/60 hover:text-white/90 hover:border-white/20 transition-colors flex items-center gap-2"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057c.002.022.015.04.033.05a19.89 19.89 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994.076-.076.041-.106-.041-.106a13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/>
                  </svg>
                  Login with Discord
                </button>
              </div>
            )}
          </div>

          {/* Right — Live feed */}
          <div className="rounded-2xl border border-white/8 bg-[#15100a] overflow-hidden flex flex-col" style={{ maxHeight: 480 }}>
            <div className="px-4 py-3 border-b border-white/8 flex items-center justify-between flex-shrink-0">
              <div>
                <span className="font-bold text-white text-sm">Live feed</span>
                <p className="text-[10px] text-white/30 mt-0.5">Midlights · Highlights · Peaklights · streaming now</p>
              </div>
              <div className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${connected ? 'bg-emerald-400 animate-pulse' : 'bg-white/20'}`} />
                <span className={`text-xs font-semibold ${connected ? 'text-emerald-400' : 'text-white/30'}`}>
                  {connected ? 'Live' : 'Connecting…'}
                </span>
              </div>
            </div>

            <div ref={feedRef} className="overflow-y-auto flex-1 scrollbar-none p-3 space-y-2">
              {groups.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3">
                  <div className="w-5 h-5 border-2 border-[#f5a623]/25 border-t-[#f5a623] rounded-full animate-spin" />
                  <p className="text-xs text-white/20">Waiting for events…</p>
                </div>
              ) : (
                groups.map(group => (
                  <div key={group.id} className="rounded-xl border border-white/6 bg-white/[0.025] p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] text-white/25 font-mono">{timeStr(group.time)}</span>
                      <CategoryBadge cat={group.category} />
                    </div>
                    <div className="space-y-2">
                      {group.entries.map((e, i) => (
                        <div key={i} className="flex items-center gap-2.5">
                          <BrainrotAvatar name={e.name} />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-white/80 truncate">{e.name}</p>
                          </div>
                          <span className="text-xs font-mono font-semibold text-white/55 flex-shrink-0">{e.value}</span>
                        </div>
                      ))}
                    </div>
                    {group.entries.length > 1 && (
                      <p className="text-[10px] text-white/20 mt-1.5">{group.entries.length} brainrot(s) in this log</p>
                    )}
                  </div>
                ))
              )}
            </div>

            <div className="px-4 py-2.5 border-t border-white/6 flex items-center gap-4 flex-shrink-0">
              <a href={`${base}leaderboard`} className="text-[11px] text-[#f5a623]/50 hover:text-[#f5a623] transition-colors">View leaderboard →</a>
              <a href={`${base}renters`} className="text-[11px] text-[#f5a623]/50 hover:text-[#f5a623] transition-colors">Active renters →</a>
            </div>
          </div>
        </div>

        {/* ── Stats Bar ── */}
        <div className="mt-12 grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { value: '500+', label: 'Total users' },
            { value: String(activeSlots > 0 ? activeSlots : totalSlots), label: 'Active slots' },
            { value: '24h', label: 'Max duration' },
            { value: '100%', label: 'Uptime' },
          ].map(({ value, label }) => (
            <div key={label} className="flex flex-col items-center justify-center py-4 px-3 rounded-2xl border border-white/8 bg-[#15100a]">
              <span className="text-xl font-extrabold text-white">{value}</span>
              <span className="text-[10px] uppercase tracking-widest text-white/30 mt-0.5">{label}</span>
            </div>
          ))}
        </div>

        {/* ── Reviews ── */}
        {reviews.length > 0 && (
          <div className="mt-20 w-full">
            <div className="text-center mb-8">
              <h2 className="text-2xl font-bold text-white mb-1">What our users say</h2>
              <p className="text-xs text-white/30">Real reviews from verified buyers</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {reviews.map(r => (
                <div key={r.id} className="flex flex-col gap-3 p-4 rounded-2xl border border-white/8 bg-[#15100a] text-left">
                  <div className="flex items-center gap-2.5">
                    {r.avatar ? (
                      <img src={`https://cdn.discordapp.com/avatars/${r.discordId}/${r.avatar}.png`} alt="" className="w-8 h-8 rounded-full flex-shrink-0" />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-white/10 flex-shrink-0 flex items-center justify-center text-xs font-bold text-white/50">
                        {r.username?.[0]?.toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-white truncate">{r.username}</p>
                      <StarRow rating={r.rating} />
                    </div>
                  </div>
                  <p className="text-xs text-white/50 leading-relaxed">{r.body}</p>
                  <p className="text-[10px] text-white/20 mt-auto">
                    {new Date(r.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="mt-16 pt-6 border-t border-white/6 flex items-center justify-between flex-wrap gap-4">
          <p className="text-xs text-white/20">© {new Date().getFullYear()} Exe Notifier. All rights reserved.</p>
          <div className="flex items-center gap-4">
            <a href={`${base}plans`} className="text-xs text-white/25 hover:text-white/50 transition-colors">Plans</a>
            <a href={`${base}renters`} className="text-xs text-white/25 hover:text-white/50 transition-colors">Renters</a>
            <a href={`${base}leaderboard`} className="text-xs text-white/25 hover:text-white/50 transition-colors">Leaderboard</a>
          </div>
        </div>
      </main>
    </div>
  );
}
