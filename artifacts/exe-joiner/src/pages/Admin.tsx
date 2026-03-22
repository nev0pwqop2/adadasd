import React, { useState } from 'react';
import { useLocation } from 'wouter';
import { useGetMe, useGetAdminSettings, useUpdateAdminSettings, useGetAdminUsers, useAdminUpdateUserSlots } from '@workspace/api-client-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { ArrowLeft, Save, Users, Settings, Shield, ShieldOff, Loader2, RotateCcw, AlertTriangle, Crown, Server, ChevronDown, ChevronUp, Search, Copy, FlaskConical, Check, Key, ScrollText, CreditCard, Bitcoin, TrendingUp, Ban, Tag, Plus, Trash2, ToggleLeft, ToggleRight } from 'lucide-react';
import { motion } from 'framer-motion';

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${import.meta.env.BASE_URL}${path}`, { credentials: 'include' });
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
}

export default function Admin() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: user, isLoading: isUserLoading, isError: isUserError } = useGetMe({ query: { retry: false } as any });
  const { data: settings, isLoading: isSettingsLoading, refetch: refetchSettings } = useGetAdminSettings({ query: { enabled: !!user?.isAdmin } as any });
  const { data: usersData, isLoading: isUsersLoading, refetch: refetchUsers } = useGetAdminUsers({ query: { enabled: !!user?.isAdmin } as any });

  const SUPER_ADMIN_IDS = new Set(['905033435817586749', '1279091875378368595']);
  const isSuperAdmin = SUPER_ADMIN_IDS.has(user?.discordId ?? '');

  const { mutate: updateSettings, isPending: isSaving } = useUpdateAdminSettings();
  const { mutate: updateUserSlots, isPending: isUpdatingSlots } = useAdminUpdateUserSlots();

  const [togglingAdmin, setTogglingAdmin] = useState<string | null>(null);
  const { mutate: toggleAdmin } = useMutation({
    mutationFn: async (discordId: string) => {
      const res = await fetch(`${import.meta.env.BASE_URL}api/admin/users/${discordId}/toggle-admin`, { method: 'POST', credentials: 'include' });
      if (!res.ok) { const d = await res.json(); throw new Error(d.message || 'Failed'); }
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Role updated", description: data.message, className: "bg-primary text-primary-foreground" });
      setTogglingAdmin(null);
      refetchUsers();
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
      setTogglingAdmin(null);
    },
  });

  const [togglingBan, setTogglingBan] = useState<string | null>(null);
  const { mutate: toggleBan } = useMutation({
    mutationFn: async (discordId: string) => {
      const res = await fetch(`${import.meta.env.BASE_URL}api/admin/users/${discordId}/ban`, { method: 'POST', credentials: 'include' });
      if (!res.ok) { const d = await res.json(); throw new Error(d.message || 'Failed'); }
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: data.isBanned ? "User banned" : "User unbanned", description: data.message, className: data.isBanned ? "bg-red-600 text-white border-none" : "bg-primary text-primary-foreground" });
      setTogglingBan(null);
      refetchUsers();
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
      setTogglingBan(null);
    },
  });

  type CouponEntry = {
    id: number; code: string; discountType: string; discountValue: string;
    maxUses: number | null; usedCount: number; expiresAt: string | null; isActive: boolean; createdAt: string;
  };
  const { data: couponsData, isLoading: isCouponsLoading, refetch: refetchCoupons } = useQuery({
    queryKey: ['admin-coupons'],
    queryFn: () => apiFetch<{ coupons: CouponEntry[] }>('api/admin/coupons'),
    enabled: !!user?.isAdmin,
  });

  const [couponForm, setCouponForm] = useState({ code: '', discountType: 'percent', discountValue: '', maxUses: '', expiresAt: '' });
  const { mutate: createCoupon, isPending: isCreatingCoupon } = useMutation({
    mutationFn: async () => {
      const body: any = {
        code: couponForm.code,
        discountType: couponForm.discountType,
        discountValue: parseFloat(couponForm.discountValue),
        maxUses: couponForm.maxUses ? parseInt(couponForm.maxUses, 10) : null,
        expiresAt: couponForm.expiresAt || null,
      };
      const res = await fetch(`${import.meta.env.BASE_URL}api/admin/coupons`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const d = await res.json(); throw new Error(d.message || 'Failed'); }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Coupon created", className: "bg-primary text-primary-foreground" });
      setCouponForm({ code: '', discountType: 'percent', discountValue: '', maxUses: '', expiresAt: '' });
      refetchCoupons();
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const { mutate: deleteCoupon } = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`${import.meta.env.BASE_URL}api/admin/coupons/${id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error('Failed to delete');
      return res.json();
    },
    onSuccess: () => { toast({ title: "Coupon deleted" }); refetchCoupons(); },
    onError: () => toast({ title: "Error", description: "Failed to delete coupon", variant: "destructive" }),
  });

  const { mutate: toggleCoupon } = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`${import.meta.env.BASE_URL}api/admin/coupons/${id}/toggle`, { method: 'PATCH', credentials: 'include' });
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    onSuccess: () => refetchCoupons(),
    onError: () => toast({ title: "Error", description: "Failed to toggle coupon", variant: "destructive" }),
  });

  const { mutate: resetLeaderboard, isPending: isResettingLeaderboard } = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${import.meta.env.BASE_URL}api/admin/reset-leaderboard`, { method: 'POST', credentials: 'include' });
      if (!res.ok) throw new Error('Failed to reset leaderboard');
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Leaderboard reset", description: "All leaderboard data has been cleared.", className: "bg-red-600 text-white border-none" });
      setConfirmResetLeaderboard(false);
    },
    onError: () => toast({ title: "Error", description: "Failed to reset leaderboard.", variant: "destructive" }),
  });

  const { mutate: resetAllDeposits, isPending: isResettingDeposits } = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${import.meta.env.BASE_URL}api/admin/reset-all-deposits`, { method: 'POST', credentials: 'include' });
      if (!res.ok) throw new Error('Failed to reset deposits');
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "All deposits reset", description: "Every deposit record has been deleted.", className: "bg-red-600 text-white border-none" });
      setConfirmResetDeposits(false);
    },
    onError: () => toast({ title: "Error", description: "Failed to reset deposits.", variant: "destructive" }),
  });

  const [slotCount, setSlotCount] = useState<string>('');
  const [pricePerDay, setPricePerDay] = useState<string>('');
  const [slotDurationHours, setSlotDurationHours] = useState<string>('');
  const [hourlyPricingEnabled, setHourlyPricingEnabled] = useState<boolean>(false);
  const [pricePerHour, setPricePerHour] = useState<string>('');
  const [minHours, setMinHours] = useState<string>('');
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [userSlotCount, setUserSlotCount] = useState<string>('');
  const [expandedGuilds, setExpandedGuilds] = useState<string | null>(null);
  const [serverSearch, setServerSearch] = useState('');
  const [copiedServerId, setCopiedServerId] = useState<string | null>(null);

  const [testScriptResult, setTestScriptResult] = useState<{ scriptKey: string | null; script: string | null; expiresAt: string; luarmorConfigured: boolean } | null>(null);
  const [testKeyCopied, setTestKeyCopied] = useState(false);
  const [testScriptCopied, setTestScriptCopied] = useState(false);

  const { mutate: generateTestScript, isPending: isGeneratingTestScript } = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${import.meta.env.BASE_URL}api/admin/test-script`, { method: 'POST', credentials: 'include' });
      if (!res.ok) { const d = await res.json(); throw new Error(d.message || 'Failed'); }
      return res.json() as Promise<{ scriptKey: string | null; script: string | null; expiresAt: string; luarmorConfigured: boolean }>;
    },
    onSuccess: (data) => { setTestScriptResult(data); },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  type LogEntry = {
    id: string; username: string; discordId: string; avatar: string | null;
    method: string; currency: string | null; amount: string | null;
    slotNumber: number; hours: number | null; purchaseType: string;
    createdAt: string | null; completedAt: string | null;
  };

  const { data: logsData, isLoading: isLogsLoading } = useQuery({
    queryKey: ['admin-logs'],
    queryFn: () => apiFetch<{ logs: LogEntry[] }>('api/admin/logs'),
    enabled: !!user?.isAdmin,
    refetchInterval: 30000,
  });

  type ServerEntry = { id: string; name: string; icon: string | null; userCount: number; users: { username: string; discordId: string }[] };
  const { data: serversData, isLoading: isServersLoading } = useQuery({
    queryKey: ['admin-servers'],
    queryFn: () => apiFetch<{ servers: ServerEntry[] }>('api/admin/servers'),
    enabled: !!user?.isAdmin,
    refetchInterval: 30000,
  });

  type PeriodStats = { total: number; stripe: number; crypto: number; stripeCount: number; cryptoCount: number; count: number };
  type TransactionEntry = {
    id: string; username: string; discordId: string; avatar: string | null;
    method: string; isStripe: boolean; currency: string | null;
    rawAmount: string | null; usdAmount: string;
    purchaseType: string; slotNumber: number; completedAt: string | null;
  };
  type TransactionsResponse = {
    summary: { today: PeriodStats; week: PeriodStats; month: PeriodStats; allTime: PeriodStats };
    transactions: TransactionEntry[];
  };

  const { data: txData, isLoading: isTxLoading } = useQuery({
    queryKey: ['admin-transactions'],
    queryFn: () => apiFetch<TransactionsResponse>('api/admin/transactions'),
    enabled: !!user?.isAdmin,
    refetchInterval: 60000,
  });

  const HIDDEN_GUILD_DISCORD_IDS = new Set(['905033435817586749']);

  const copyServerId = (id: string) => {
    navigator.clipboard.writeText(id);
    setCopiedServerId(id);
    setTimeout(() => setCopiedServerId(null), 2000);
  };
  const [confirmResetLeaderboard, setConfirmResetLeaderboard] = useState(false);
  const [confirmResetDeposits, setConfirmResetDeposits] = useState(false);
  const [serverExplorerOpen, setServerExplorerOpen] = useState(false);

  React.useEffect(() => {
    if (isUserError) setLocation('/');
  }, [isUserError, setLocation]);

  React.useEffect(() => {
    if (user && !user.isAdmin) setLocation('/dashboard');
  }, [user, setLocation]);

  React.useEffect(() => {
    if (settings) {
      setSlotCount(String(settings.slotCount));
      setPricePerDay(String(settings.pricePerDay));
      setSlotDurationHours(String((settings as any).slotDurationHours ?? 24));
      setHourlyPricingEnabled(Boolean((settings as any).hourlyPricingEnabled));
      setPricePerHour(String((settings as any).pricePerHour ?? 5));
      setMinHours(String((settings as any).minHours ?? 2));
    }
  }, [settings]);

  const handleSaveSettings = () => {
    const count = parseInt(slotCount, 10);
    const price = parseFloat(pricePerDay);
    const hours = parseInt(slotDurationHours, 10);
    const pph = parseFloat(pricePerHour);
    const mh = parseInt(minHours, 10);
    if (isNaN(count) || count < 1 || count > 100) {
      toast({ title: "Invalid slot count", description: "Must be between 1 and 100.", variant: "destructive" });
      return;
    }
    if (isNaN(price) || price < 0) {
      toast({ title: "Invalid price", description: "Must be >= 0.", variant: "destructive" });
      return;
    }
    if (isNaN(hours) || hours < 1 || hours > 720) {
      toast({ title: "Invalid duration", description: "Must be between 1 and 720 hours.", variant: "destructive" });
      return;
    }
    if (hourlyPricingEnabled) {
      if (isNaN(pph) || pph < 0) {
        toast({ title: "Invalid price per hour", description: "Must be >= 0.", variant: "destructive" });
        return;
      }
      if (isNaN(mh) || mh < 1) {
        toast({ title: "Invalid minimum hours", description: "Must be at least 1.", variant: "destructive" });
        return;
      }
    }
    updateSettings({ data: { slotCount: count, pricePerDay: price, slotDurationHours: hours, hourlyPricingEnabled, pricePerHour: pph, minHours: mh } as any }, {
      onSuccess: () => {
        toast({ title: "Settings saved", description: "Settings updated successfully.", className: "bg-primary text-primary-foreground" });
        refetchSettings();
      },
      onError: () => toast({ title: "Error", description: "Failed to save settings.", variant: "destructive" }),
    });
  };

  const handleUpdateUserSlots = (discordId: string) => {
    const count = parseInt(userSlotCount, 10);
    if (isNaN(count) || count < 0) {
      toast({ title: "Invalid count", description: "Must be >= 0.", variant: "destructive" });
      return;
    }
    updateUserSlots({ discordId, data: { activeSlotCount: count } }, {
      onSuccess: () => {
        toast({ title: "Updated", description: `Slots updated for ${discordId}`, className: "bg-primary text-primary-foreground" });
        setEditingUser(null);
        setUserSlotCount('');
        refetchUsers();
      },
      onError: () => toast({ title: "Error", description: "Failed to update user slots.", variant: "destructive" }),
    });
  };

  if (isUserLoading || isSettingsLoading) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
        <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        <p className="font-mono text-primary animate-pulse tracking-widest uppercase text-sm">Loading Admin Panel...</p>
      </div>
    );
  }

  if (!user?.isAdmin) return null;

  const filteredServers = (serversData?.servers ?? []).filter((s: ServerEntry) =>
    !serverSearch.trim() ||
    s.name.toLowerCase().includes(serverSearch.toLowerCase()) ||
    s.id.includes(serverSearch)
  );

  function StatCard({ label, stats }: { label: string; stats: PeriodStats | undefined }) {
    if (!stats) return null;
    return (
      <div className="border border-primary/20 bg-background/60 p-4 space-y-3">
        <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest">{label}</p>
        <p className="font-display text-2xl font-bold text-primary">${stats.total.toFixed(2)}</p>
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1 text-xs font-mono text-muted-foreground">
              <CreditCard className="w-3 h-3 text-blue-400" /> Card
            </span>
            <span className="text-xs font-mono text-foreground font-bold">${stats.stripe.toFixed(2)} <span className="text-muted-foreground font-normal">({stats.stripeCount})</span></span>
          </div>
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1 text-xs font-mono text-muted-foreground">
              <Bitcoin className="w-3 h-3 text-orange-400" /> Crypto
            </span>
            <span className="text-xs font-mono text-foreground font-bold">${stats.crypto.toFixed(2)} <span className="text-muted-foreground font-normal">({stats.cryptoCount})</span></span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background relative overflow-x-hidden">
      <div className="fixed inset-0 z-0 opacity-[0.03] bg-cover bg-center pointer-events-none"
        style={{ backgroundImage: `url(${import.meta.env.BASE_URL}images/cyber-bg.png)` }} />

      <div className="relative z-10 flex flex-col min-h-screen">
        <header className="border-b border-primary/20 bg-card/80 backdrop-blur-md sticky top-0 z-40">
          <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="sm" onClick={() => setLocation('/dashboard')} className="text-muted-foreground hover:text-primary">
                <ArrowLeft className="w-4 h-4 mr-2" /> Back
              </Button>
              <div className="h-5 w-px bg-primary/20" />
              <div className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-yellow-400" />
                <h1 className="font-display font-bold uppercase tracking-widest text-yellow-400">Admin Panel</h1>
              </div>
            </div>
            <span className="font-mono text-xs text-muted-foreground hidden sm:block">ID: {user.discordId}</span>
          </div>
        </header>

        <main className="flex-1 max-w-5xl mx-auto px-4 py-8 w-full space-y-8">

          {/* Settings Card */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <Card className="border-yellow-500/30 bg-yellow-500/5">
              <div className="p-6 border-b border-yellow-500/20 flex items-center gap-3">
                <Settings className="w-5 h-5 text-yellow-400" />
                <h2 className="font-display font-bold uppercase tracking-wider text-yellow-400">System Settings</h2>
              </div>
              <div className="p-6 grid grid-cols-1 sm:grid-cols-3 gap-6">
                <div className="space-y-2">
                  <label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Total Slot Count</label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={slotCount}
                    onChange={e => setSlotCount(e.target.value)}
                    className="w-full bg-background border border-primary/30 text-foreground font-mono px-4 py-3 focus:outline-none focus:border-primary text-lg"
                  />
                  <p className="text-xs text-muted-foreground font-mono">Number of slots shown to all users</p>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Price Per Day (USD)</label>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={pricePerDay}
                    onChange={e => setPricePerDay(e.target.value)}
                    className="w-full bg-background border border-primary/30 text-foreground font-mono px-4 py-3 focus:outline-none focus:border-primary text-lg"
                  />
                  <p className="text-xs text-muted-foreground font-mono">Shown in the payment modal</p>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Slot Duration (Hours)</label>
                  <input
                    type="number"
                    min={1}
                    max={720}
                    value={slotDurationHours}
                    onChange={e => setSlotDurationHours(e.target.value)}
                    className="w-full bg-background border border-primary/30 text-foreground font-mono px-4 py-3 focus:outline-none focus:border-primary text-lg"
                  />
                  <p className="text-xs text-muted-foreground font-mono">How long each slot stays active (e.g. 24 = 1 day)</p>
                </div>

                <div className="space-y-3 pt-2 border-t border-primary/20">
                  <p className="text-xs font-mono text-primary uppercase tracking-wider font-bold">Hourly Pricing Mode</p>
                  <label className="flex items-center gap-3 cursor-pointer select-none group">
                    <div
                      onClick={() => setHourlyPricingEnabled(v => !v)}
                      className={`relative w-12 h-6 rounded-none transition-colors border cursor-pointer ${hourlyPricingEnabled ? 'bg-primary border-primary' : 'bg-secondary border-primary/30'}`}
                    >
                      <div className={`absolute top-0.5 w-5 h-5 bg-background transition-transform ${hourlyPricingEnabled ? 'translate-x-6' : 'translate-x-0.5'}`} />
                    </div>
                    <span className="text-sm font-mono text-foreground">
                      {hourlyPricingEnabled ? 'Enabled — users pick how many hours to buy' : 'Disabled — fixed price per slot'}
                    </span>
                  </label>
                </div>

                {hourlyPricingEnabled && (
                  <>
                    <div className="space-y-2">
                      <label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Price Per Hour (USD)</label>
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        value={pricePerHour}
                        onChange={e => setPricePerHour(e.target.value)}
                        className="w-full bg-background border border-primary/30 text-foreground font-mono px-4 py-3 focus:outline-none focus:border-primary text-lg"
                      />
                      <p className="text-xs text-muted-foreground font-mono">Charged per hour when hourly pricing is active</p>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Minimum Hours</label>
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={minHours}
                        onChange={e => setMinHours(e.target.value)}
                        className="w-full bg-background border border-primary/30 text-foreground font-mono px-4 py-3 focus:outline-none focus:border-primary text-lg"
                      />
                      <p className="text-xs text-muted-foreground font-mono">Minimum hours a user must purchase per slot</p>
                    </div>
                  </>
                )}
              </div>

              <div className="px-6 pb-6">
                <Button onClick={handleSaveSettings} disabled={isSaving} className="w-full sm:w-auto">
                  {isSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                  Save Settings
                </Button>
              </div>
            </Card>
          </motion.div>

          {/* Users Card */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
            <Card className="border-primary/20">
              <div className="p-6 border-b border-primary/20 flex items-center gap-3">
                <Users className="w-5 h-5 text-primary" />
                <h2 className="font-display font-bold uppercase tracking-wider text-primary">User Management</h2>
                <span className="ml-auto text-xs font-mono text-muted-foreground">{usersData?.users.length ?? 0} users</span>
              </div>
              <div className="divide-y divide-primary/10">
                {isUsersLoading && (
                  <div className="p-8 flex justify-center">
                    <Loader2 className="w-6 h-6 text-primary animate-spin" />
                  </div>
                )}
                {usersData?.users.length === 0 && (
                  <div className="p-8 text-center font-mono text-muted-foreground text-sm">No users yet.</div>
                )}
                {usersData?.users.map((u: any) => (
                  <div key={u.discordId} className="border-b border-primary/10 last:border-0">
                    <div className="p-4 flex flex-col sm:flex-row sm:items-center gap-4">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        {u.avatar ? (
                          <img src={`https://cdn.discordapp.com/avatars/${u.discordId}/${u.avatar}.png`} alt="" className="w-9 h-9 border border-primary/30 shrink-0" />
                        ) : (
                          <div className="w-9 h-9 bg-secondary border border-primary/30 shrink-0" />
                        )}
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-mono text-sm text-foreground font-bold truncate">{u.username}</p>
                            {u.isSuperAdmin && (
                              <span className="flex items-center gap-1 text-xs font-mono px-2 py-0.5 bg-yellow-500/10 border border-yellow-500/30 text-yellow-400">
                                <Crown className="w-3 h-3" /> Super Admin
                              </span>
                            )}
                            {u.isAdmin && !u.isSuperAdmin && (
                              <span className="flex items-center gap-1 text-xs font-mono px-2 py-0.5 bg-primary/10 border border-primary/30 text-primary">
                                <Shield className="w-3 h-3" /> Admin
                              </span>
                            )}
                            {u.isBanned && (
                              <span className="flex items-center gap-1 text-xs font-mono px-2 py-0.5 bg-red-500/10 border border-red-500/30 text-red-400">
                                <Ban className="w-3 h-3" /> Banned
                              </span>
                            )}
                          </div>
                          <p className="font-mono text-xs text-muted-foreground">{u.discordId}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`font-mono text-sm px-3 py-1 border chamfered shrink-0 ${u.activeSlots > 0 ? 'border-primary/40 text-primary bg-primary/10' : 'border-primary/10 text-muted-foreground'}`}>
                          {u.activeSlots} slot{u.activeSlots !== 1 ? 's' : ''} active
                        </span>

                        {u.guilds?.length > 0 && !HIDDEN_GUILD_DISCORD_IDS.has(u.discordId) && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setExpandedGuilds(expandedGuilds === u.discordId ? null : u.discordId)}
                            className="border-primary/20 text-muted-foreground hover:text-primary font-mono text-xs"
                          >
                            <Server className="w-3 h-3 mr-1" />
                            {u.guilds.length} Servers
                            {expandedGuilds === u.discordId ? <ChevronUp className="w-3 h-3 ml-1" /> : <ChevronDown className="w-3 h-3 ml-1" />}
                          </Button>
                        )}

                        {isSuperAdmin && !u.isSuperAdmin && (
                          togglingAdmin === u.discordId ? (
                            <Button size="sm" variant="outline" disabled className="border-primary/20 font-mono text-xs">
                              <Loader2 className="w-3 h-3 animate-spin" />
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => { setTogglingAdmin(u.discordId); toggleAdmin(u.discordId); }}
                              className={`font-mono text-xs border-primary/20 ${u.isAdmin ? 'text-red-400 hover:text-red-300' : 'text-primary hover:text-primary/80'}`}
                            >
                              {u.isAdmin ? <><ShieldOff className="w-3 h-3 mr-1" />Remove Admin</> : <><Shield className="w-3 h-3 mr-1" />Make Admin</>}
                            </Button>
                          )
                        )}

                        {!u.isSuperAdmin && (
                          togglingBan === u.discordId ? (
                            <Button size="sm" variant="outline" disabled className="border-red-500/20 font-mono text-xs">
                              <Loader2 className="w-3 h-3 animate-spin" />
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => { setTogglingBan(u.discordId); toggleBan(u.discordId); }}
                              className={`font-mono text-xs ${u.isBanned ? 'border-green-500/40 text-green-400 hover:bg-green-500/10' : 'border-red-500/40 text-red-400 hover:bg-red-500/10'}`}
                            >
                              <Ban className="w-3 h-3 mr-1" />
                              {u.isBanned ? 'Unban' : 'Ban'}
                            </Button>
                          )
                        )}

                        {editingUser === u.discordId ? (
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min={0}
                              max={u.totalSlots}
                              value={userSlotCount}
                              onChange={e => setUserSlotCount(e.target.value)}
                              placeholder="# active"
                              className="w-24 bg-background border border-primary/50 text-foreground font-mono px-3 py-1.5 text-sm focus:outline-none focus:border-primary"
                              autoFocus
                            />
                            <Button size="sm" onClick={() => handleUpdateUserSlots(u.discordId)} disabled={isUpdatingSlots}>
                              {isUpdatingSlots ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Set'}
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => { setEditingUser(null); setUserSlotCount(''); }} className="border-primary/20">
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <Button size="sm" variant="outline" onClick={() => { setEditingUser(u.discordId); setUserSlotCount(String(u.activeSlots)); }} className="border-primary/20 text-muted-foreground hover:text-primary font-mono text-xs">
                            Edit Slots
                          </Button>
                        )}
                      </div>
                    </div>

                    {expandedGuilds === u.discordId && u.guilds?.length > 0 && (
                      <div className="px-4 pb-4">
                        <div className="border border-primary/10 bg-background/50 p-3">
                          <p className="font-mono text-xs text-muted-foreground mb-2 uppercase tracking-wider">Discord Servers ({u.guilds.length})</p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-64 overflow-y-auto">
                            {u.guilds.map((g: { id: string; name: string; icon: string | null; owner: boolean }) => (
                              <div key={g.id} className="flex items-center gap-2 p-2 border border-primary/10 bg-primary/5">
                                {g.icon ? (
                                  <img
                                    src={`https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=32`}
                                    alt=""
                                    className="w-6 h-6 rounded-full shrink-0"
                                  />
                                ) : (
                                  <div className="w-6 h-6 rounded-full bg-secondary border border-primary/20 shrink-0 flex items-center justify-center">
                                    <Server className="w-3 h-3 text-muted-foreground" />
                                  </div>
                                )}
                                <span className="font-mono text-xs text-foreground truncate flex-1">{g.name}</span>
                                {g.owner && (
                                  <Crown className="w-3 h-3 text-yellow-400 shrink-0" aria-label="Server Owner" />
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          </motion.div>

          {/* Coupon Management */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
            <Card className="border-primary/20">
              <div className="p-6 border-b border-primary/20 flex items-center gap-3">
                <Tag className="w-5 h-5 text-primary" />
                <h2 className="font-display font-bold uppercase tracking-wider text-primary">Coupon Codes</h2>
                <span className="ml-auto text-xs font-mono text-muted-foreground">{couponsData?.coupons.length ?? 0} codes</span>
              </div>

              {/* Create form */}
              <div className="p-6 border-b border-primary/10 space-y-4">
                <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Create New Coupon</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                  <div className="space-y-1 col-span-2 sm:col-span-1">
                    <label className="text-xs font-mono text-muted-foreground">Code</label>
                    <input
                      type="text"
                      placeholder="SAVE20"
                      value={couponForm.code}
                      onChange={e => setCouponForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                      className="w-full bg-background border border-primary/30 text-foreground font-mono px-3 py-2 text-sm focus:outline-none focus:border-primary uppercase"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-mono text-muted-foreground">Type</label>
                    <select
                      value={couponForm.discountType}
                      onChange={e => setCouponForm(f => ({ ...f, discountType: e.target.value }))}
                      className="w-full bg-background border border-primary/30 text-foreground font-mono px-3 py-2 text-sm focus:outline-none focus:border-primary"
                    >
                      <option value="percent">Percent (%)</option>
                      <option value="fixed">Fixed ($)</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-mono text-muted-foreground">Value</label>
                    <input
                      type="number"
                      min={0}
                      placeholder={couponForm.discountType === 'percent' ? '20' : '5.00'}
                      value={couponForm.discountValue}
                      onChange={e => setCouponForm(f => ({ ...f, discountValue: e.target.value }))}
                      className="w-full bg-background border border-primary/30 text-foreground font-mono px-3 py-2 text-sm focus:outline-none focus:border-primary"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-mono text-muted-foreground">Max Uses</label>
                    <input
                      type="number"
                      min={1}
                      placeholder="Unlimited"
                      value={couponForm.maxUses}
                      onChange={e => setCouponForm(f => ({ ...f, maxUses: e.target.value }))}
                      className="w-full bg-background border border-primary/30 text-foreground font-mono px-3 py-2 text-sm focus:outline-none focus:border-primary"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-mono text-muted-foreground">Expires</label>
                    <input
                      type="datetime-local"
                      value={couponForm.expiresAt}
                      onChange={e => setCouponForm(f => ({ ...f, expiresAt: e.target.value }))}
                      className="w-full bg-background border border-primary/30 text-foreground font-mono px-3 py-2 text-sm focus:outline-none focus:border-primary"
                    />
                  </div>
                </div>
                <Button onClick={() => createCoupon()} disabled={isCreatingCoupon || !couponForm.code || !couponForm.discountValue} size="sm">
                  {isCreatingCoupon ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
                  Create Coupon
                </Button>
              </div>

              {/* List */}
              {isCouponsLoading ? (
                <div className="p-8 flex justify-center"><Loader2 className="w-6 h-6 text-primary animate-spin" /></div>
              ) : !couponsData?.coupons.length ? (
                <div className="p-8 text-center font-mono text-muted-foreground text-sm">No coupon codes yet.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full font-mono text-xs">
                    <thead>
                      <tr className="border-b border-primary/10 text-muted-foreground uppercase tracking-wider">
                        <th className="text-left px-4 py-3">Code</th>
                        <th className="text-left px-4 py-3">Discount</th>
                        <th className="text-left px-4 py-3">Uses</th>
                        <th className="text-left px-4 py-3">Expires</th>
                        <th className="text-left px-4 py-3">Status</th>
                        <th className="text-left px-4 py-3">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-primary/5">
                      {couponsData.coupons.map((c: CouponEntry) => (
                        <tr key={c.id} className="hover:bg-primary/5 transition-colors">
                          <td className="px-4 py-3 font-bold text-primary tracking-widest">{c.code}</td>
                          <td className="px-4 py-3 text-foreground">
                            {c.discountType === 'percent' ? `${parseFloat(c.discountValue)}% off` : `$${parseFloat(c.discountValue).toFixed(2)} off`}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {c.usedCount}{c.maxUses !== null ? ` / ${c.maxUses}` : ' / ∞'}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {c.expiresAt ? new Date(c.expiresAt).toLocaleDateString() : '—'}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-0.5 border text-xs ${c.isActive ? 'border-green-500/30 text-green-400 bg-green-500/10' : 'border-red-500/30 text-red-400 bg-red-500/10'}`}>
                              {c.isActive ? 'Active' : 'Disabled'}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => toggleCoupon(c.id)}
                                className="text-muted-foreground hover:text-primary transition-colors"
                                title={c.isActive ? 'Disable' : 'Enable'}
                              >
                                {c.isActive ? <ToggleRight className="w-4 h-4 text-green-400" /> : <ToggleLeft className="w-4 h-4" />}
                              </button>
                              <button
                                onClick={() => deleteCoupon(c.id)}
                                className="text-muted-foreground hover:text-red-400 transition-colors"
                                title="Delete"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </motion.div>

          {/* Danger Zone */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
            <Card className="border-red-500/30 bg-red-500/5">
              <div className="p-6 border-b border-red-500/20 flex items-center gap-3">
                <AlertTriangle className="w-5 h-5 text-red-400" />
                <h2 className="font-display font-bold uppercase tracking-wider text-red-400">Danger Zone</h2>
              </div>

              <div className="divide-y divide-red-500/10">
                {/* Reset Leaderboard */}
                <div className="p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <p className="font-mono text-sm text-foreground font-bold">Reset Leaderboard</p>
                    <p className="text-xs text-muted-foreground font-mono mt-1">Clears all completed payment records, resetting the leaderboard to zero. This cannot be undone.</p>
                  </div>
                  {confirmResetLeaderboard ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-red-400 uppercase">Are you sure?</span>
                      <Button
                        size="sm"
                        className="bg-red-600 hover:bg-red-700 text-white border-none"
                        onClick={() => resetLeaderboard()}
                        disabled={isResettingLeaderboard}
                      >
                        {isResettingLeaderboard ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Yes, Reset'}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setConfirmResetLeaderboard(false)} className="border-primary/20">
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-red-500/40 text-red-400 hover:bg-red-500/10 hover:border-red-500 font-mono shrink-0"
                      onClick={() => setConfirmResetLeaderboard(true)}
                    >
                      <RotateCcw className="w-4 h-4 mr-2" />
                      Reset Leaderboard
                    </Button>
                  )}
                </div>

                {/* Reset All Deposits */}
                <div className="p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <p className="font-mono text-sm text-foreground font-bold">Reset All Deposits</p>
                    <p className="text-xs text-muted-foreground font-mono mt-1">Permanently deletes every deposit record for all users. This cannot be undone.</p>
                  </div>
                  {confirmResetDeposits ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-red-400 uppercase">Are you sure?</span>
                      <Button
                        size="sm"
                        className="bg-red-600 hover:bg-red-700 text-white border-none"
                        onClick={() => resetAllDeposits()}
                        disabled={isResettingDeposits}
                      >
                        {isResettingDeposits ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Yes, Delete All'}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setConfirmResetDeposits(false)} className="border-primary/20">
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-red-500/40 text-red-400 hover:bg-red-500/10 hover:border-red-500 font-mono shrink-0"
                      onClick={() => setConfirmResetDeposits(true)}
                    >
                      <RotateCcw className="w-4 h-4 mr-2" />
                      Reset All Deposits
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          </motion.div>

          {/* SERVER EXPLORER */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
            <Card className="border-primary/20 bg-card/50">
              <div
                className="p-6 flex flex-col sm:flex-row sm:items-center gap-4 cursor-pointer select-none"
                onClick={() => setServerExplorerOpen(v => !v)}
              >
                <div className="flex items-center gap-3 flex-1">
                  <Server className="w-5 h-5 text-primary" />
                  <div>
                    <h3 className="font-display font-bold uppercase tracking-widest text-primary">Server Explorer</h3>
                    <p className="text-xs font-mono text-muted-foreground mt-0.5">All Discord servers your users belong to</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {serverExplorerOpen && (
                    <div className="relative" onClick={e => e.stopPropagation()}>
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                      <input
                        type="text"
                        placeholder="Search by name or ID..."
                        value={serverSearch}
                        onChange={e => setServerSearch(e.target.value)}
                        className="bg-background border border-border rounded-lg text-foreground font-mono pl-9 pr-3 py-2 text-xs w-64 focus:outline-none focus:border-primary/60 placeholder:text-muted-foreground/50"
                      />
                    </div>
                  )}
                  {serverExplorerOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
                </div>
              </div>

              {serverExplorerOpen && (isServersLoading ? (
                <div className="p-8 flex justify-center">
                  <Loader2 className="w-6 h-6 text-primary animate-spin" />
                </div>
              ) : !serversData?.servers.length ? (
                <div className="p-8 text-center font-mono text-muted-foreground text-sm">No server data yet — users must log in again to share their servers.</div>
              ) : filteredServers.length === 0 ? (
                <div className="p-8 text-center font-mono text-muted-foreground text-sm">No servers match your search.</div>
              ) : (
                  <div className="divide-y divide-primary/10">
                    {filteredServers.map((s: ServerEntry) => (
                      <div key={s.id} className="p-4 flex items-center gap-4">
                        {s.icon ? (
                          <img
                            src={`https://cdn.discordapp.com/icons/${s.id}/${s.icon}.png?size=48`}
                            alt=""
                            className="w-10 h-10 rounded-full border border-primary/20 shrink-0"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-secondary border border-primary/20 shrink-0 flex items-center justify-center">
                            <Server className="w-4 h-4 text-muted-foreground" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="font-mono text-sm text-foreground font-bold truncate">{s.name}</p>
                          <p className="font-mono text-xs text-muted-foreground truncate">{s.id}</p>
                          {s.users.length > 0 && (
                            <p className="font-mono text-xs text-primary/70 mt-0.5 truncate">
                              {s.users.map(u => u.username).slice(0, 3).join(', ')}{s.users.length > 3 ? ` +${s.users.length - 3} more` : ''}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="font-mono text-xs px-2 py-1 rounded border border-border text-muted-foreground">
                            {s.userCount} user{s.userCount !== 1 ? 's' : ''}
                          </span>
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-border text-muted-foreground hover:text-primary hover:border-primary/50 font-mono text-xs"
                            onClick={() => copyServerId(s.id)}
                          >
                            {copiedServerId === s.id ? (
                              <span className="text-green-400">Copied!</span>
                            ) : (
                              <><Copy className="w-3 h-3 mr-1" /> Copy ID</>
                            )}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
              ))}
            </Card>
          </motion.div>

          {/* Purchase Logs */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.32 }}>
            <Card className="border-primary/20">
              <div className="p-6 border-b border-primary/20 flex items-center gap-3">
                <ScrollText className="w-5 h-5 text-primary" />
                <h2 className="font-display font-bold uppercase tracking-wider text-primary">Purchase Logs</h2>
                <span className="ml-auto text-xs font-mono text-muted-foreground">{logsData?.logs.length ?? 0} records</span>
              </div>
              {isLogsLoading ? (
                <div className="p-8 flex justify-center"><Loader2 className="w-6 h-6 text-primary animate-spin" /></div>
              ) : !logsData?.logs.length ? (
                <div className="p-8 text-center font-mono text-muted-foreground text-sm">No completed purchases yet.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full font-mono text-xs">
                    <thead>
                      <tr className="border-b border-primary/10 text-muted-foreground uppercase tracking-wider">
                        <th className="text-left px-4 py-3">User</th>
                        <th className="text-left px-4 py-3">Type</th>
                        <th className="text-left px-4 py-3">Method</th>
                        <th className="text-left px-4 py-3">Amount</th>
                        <th className="text-left px-4 py-3">Hours</th>
                        <th className="text-left px-4 py-3">Slot</th>
                        <th className="text-left px-4 py-3">Time</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-primary/5">
                      {logsData.logs.map((log: LogEntry) => {
                        const isStripe = log.method === 'stripe' || log.method?.includes('stripe');
                        const isCrypto = log.method === 'crypto' || log.method?.includes('crypto');
                        const isBalance = log.method === 'balance';
                        const methodLabel = isStripe ? 'Card' : isCrypto ? `Crypto (${log.currency ?? '?'})` : isBalance ? 'Balance' : log.method;
                        const typeLabel = log.purchaseType === 'preorder' ? 'Pre-order' : log.purchaseType === 'balance_deposit' ? 'Deposit' : 'Slot';
                        const typeColor = log.purchaseType === 'preorder' ? 'text-orange-400' : log.purchaseType === 'balance_deposit' ? 'text-blue-400' : 'text-green-400';
                        const amountLabel = log.amount ? (isStripe || isBalance ? `$${parseFloat(log.amount).toFixed(2)}` : `${log.amount} ${log.currency ?? ''}`) : '—';
                        const timeLabel = log.completedAt ? new Date(log.completedAt).toLocaleString() : '—';
                        return (
                          <tr key={log.id} className="hover:bg-primary/5 transition-colors">
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                {log.avatar ? (
                                  <img src={`https://cdn.discordapp.com/avatars/${log.discordId}/${log.avatar}.png`} alt="" className="w-6 h-6 border border-primary/20 shrink-0" />
                                ) : (
                                  <div className="w-6 h-6 bg-secondary border border-primary/20 shrink-0" />
                                )}
                                <span className="text-foreground font-bold truncate max-w-[100px]">{log.username}</span>
                              </div>
                            </td>
                            <td className={`px-4 py-3 font-bold ${typeColor}`}>{typeLabel}</td>
                            <td className="px-4 py-3 text-muted-foreground">{methodLabel}</td>
                            <td className="px-4 py-3 text-primary font-bold">{amountLabel}</td>
                            <td className="px-4 py-3 text-muted-foreground">{log.hours ? `${log.hours}h` : '—'}</td>
                            <td className="px-4 py-3 text-muted-foreground">{log.slotNumber > 0 ? `#${log.slotNumber}` : '—'}</td>
                            <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{timeLabel}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </motion.div>

          {/* Transactions / Revenue */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.34 }}>
            <Card className="border-green-500/30 bg-green-500/5">
              <div className="p-6 border-b border-green-500/20 flex items-center gap-3">
                <TrendingUp className="w-5 h-5 text-green-400" />
                <h2 className="font-display font-bold uppercase tracking-wider text-green-400">Revenue</h2>
                <span className="ml-auto text-xs font-mono text-muted-foreground">{txData?.transactions.length ?? 0} sales</span>
              </div>

              {isTxLoading ? (
                <div className="p-8 flex justify-center"><Loader2 className="w-6 h-6 text-green-400 animate-spin" /></div>
              ) : (
                <>
                  {/* Summary cards */}
                  <div className="p-6 grid grid-cols-2 sm:grid-cols-4 gap-4 border-b border-green-500/10">
                    <StatCard label="Today" stats={txData?.summary.today} />
                    <StatCard label="This Week" stats={txData?.summary.week} />
                    <StatCard label="This Month" stats={txData?.summary.month} />
                    <StatCard label="All Time" stats={txData?.summary.allTime} />
                  </div>

                  {/* Transaction list */}
                  {!txData?.transactions.length ? (
                    <div className="p-8 text-center font-mono text-muted-foreground text-sm">No revenue yet.</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full font-mono text-xs">
                        <thead>
                          <tr className="border-b border-green-500/10 text-muted-foreground uppercase tracking-wider">
                            <th className="text-left px-4 py-3">User</th>
                            <th className="text-left px-4 py-3">Type</th>
                            <th className="text-left px-4 py-3">Method</th>
                            <th className="text-left px-4 py-3">USD</th>
                            <th className="text-left px-4 py-3">Raw</th>
                            <th className="text-left px-4 py-3">Date</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-green-500/5">
                          {txData.transactions.map((tx: TransactionEntry) => {
                            const currLabel = tx.currency ?? '?';
                            const rawLabel = tx.isStripe ? `$${parseFloat(tx.rawAmount ?? '0').toFixed(2)}` : `${tx.rawAmount} ${currLabel}`;
                            const typeColor = tx.purchaseType === 'preorder' ? 'text-orange-400' : 'text-green-400';
                            return (
                              <tr key={tx.id} className="hover:bg-green-500/5 transition-colors">
                                <td className="px-4 py-3">
                                  <div className="flex items-center gap-2">
                                    {tx.avatar ? (
                                      <img src={`https://cdn.discordapp.com/avatars/${tx.discordId}/${tx.avatar}.png`} alt="" className="w-6 h-6 border border-green-500/20 shrink-0" />
                                    ) : (
                                      <div className="w-6 h-6 bg-secondary border border-green-500/10 shrink-0" />
                                    )}
                                    <span className="text-foreground font-bold truncate max-w-[100px]">{tx.username}</span>
                                  </div>
                                </td>
                                <td className={`px-4 py-3 font-bold ${typeColor}`}>
                                  {tx.purchaseType === 'preorder' ? 'Pre-order' : `Slot #${tx.slotNumber}`}
                                </td>
                                <td className="px-4 py-3 text-muted-foreground">
                                  <span className="flex items-center gap-1">
                                    {tx.isStripe
                                      ? <CreditCard className="w-3 h-3 text-blue-400 shrink-0" />
                                      : <Bitcoin className="w-3 h-3 text-orange-400 shrink-0" />}
                                    {tx.isStripe ? 'Card' : currLabel}
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-green-400 font-bold">${tx.usdAmount}</td>
                                <td className="px-4 py-3 text-muted-foreground">{rawLabel}</td>
                                <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                                  {tx.completedAt ? new Date(tx.completedAt).toLocaleString() : '—'}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </Card>
          </motion.div>

          {/* Developer Tools */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}>
            <Card className="border-blue-500/30 bg-blue-500/5">
              <div className="p-6 border-b border-blue-500/20 flex items-center gap-3">
                <FlaskConical className="w-5 h-5 text-blue-400" />
                <h2 className="font-display font-bold uppercase tracking-wider text-blue-400">Developer Tools</h2>
              </div>
              <div className="p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-blue-500/10">
                <div>
                  <p className="font-mono text-sm text-foreground font-bold">Test Script (1 Minute)</p>
                  <p className="text-xs text-muted-foreground font-mono mt-1">Generates a real Luarmor key for yourself that expires in 60 seconds. Use it to verify expiry and loader delivery.</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-blue-500/40 text-blue-400 hover:bg-blue-500/10 hover:border-blue-500 font-mono shrink-0"
                  onClick={() => generateTestScript()}
                  disabled={isGeneratingTestScript}
                >
                  {isGeneratingTestScript ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <FlaskConical className="w-4 h-4 mr-2" />}
                  Generate Test Script
                </Button>
              </div>
              {testScriptResult && (
                <div className="px-6 pb-6 space-y-4">
                  <div className="border border-blue-500/20 bg-background/60 p-4 space-y-4">
                    {!testScriptResult.luarmorConfigured && (
                      <p className="text-xs font-mono text-yellow-400 bg-yellow-500/10 border border-yellow-500/20 px-3 py-2">
                        Luarmor is not configured — no real key was generated. Set LUARMOR_API_KEY and LUARMOR_PROJECT_ID.
                      </p>
                    )}
                    <div>
                      <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-2 flex items-center gap-1"><Key className="w-3 h-3" /> Script Key</p>
                      {testScriptResult.scriptKey ? (
                        <div className="flex items-start gap-2 bg-secondary/60 border border-blue-500/20 p-3">
                          <p className="font-mono text-xs text-blue-300 break-all flex-1">{testScriptResult.scriptKey}</p>
                          <button
                            onClick={async () => { await navigator.clipboard.writeText(testScriptResult.scriptKey!); setTestKeyCopied(true); setTimeout(() => setTestKeyCopied(false), 2000); }}
                            className="shrink-0 text-muted-foreground hover:text-blue-400 transition-colors"
                          >
                            {testKeyCopied ? <Check className="w-3.5 h-3.5 text-blue-400" /> : <Copy className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      ) : (
                        <p className="text-xs font-mono text-muted-foreground/50">No key generated</p>
                      )}
                    </div>

                    <div>
                      <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-2 flex items-center gap-1"><Key className="w-3 h-3" /> Full Loader Script</p>
                      {testScriptResult.script ? (
                        <div className="flex items-start gap-2 bg-secondary/60 border border-blue-500/20 p-3">
                          <pre className="font-mono text-xs text-blue-300 break-all flex-1 whitespace-pre-wrap">{testScriptResult.script}</pre>
                          <button
                            onClick={async () => { await navigator.clipboard.writeText(testScriptResult.script!); setTestScriptCopied(true); setTimeout(() => setTestScriptCopied(false), 2000); }}
                            className="shrink-0 text-muted-foreground hover:text-blue-400 transition-colors"
                          >
                            {testScriptCopied ? <Check className="w-3.5 h-3.5 text-blue-400" /> : <Copy className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      ) : (
                        <p className="text-xs font-mono text-yellow-400/80">Key generated but LUARMOR_SCRIPT_URL is not set — set it in Render env vars to get the full loader.</p>
                      )}
                    </div>

                    <p className="text-[10px] font-mono text-muted-foreground/50">
                      Expires: {new Date(testScriptResult.expiresAt).toLocaleTimeString()} (1 minute from generation)
                    </p>
                  </div>
                  <Button size="sm" variant="ghost" className="text-muted-foreground font-mono text-xs" onClick={() => setTestScriptResult(null)}>
                    Dismiss
                  </Button>
                </div>
              )}
            </Card>
          </motion.div>

        </main>

        <footer className="border-t border-primary/10 py-4">
          <p className="text-center text-xs font-mono text-muted-foreground uppercase tracking-widest">[ Admin Access // Restricted ]</p>
        </footer>
      </div>
    </div>
  );
}
