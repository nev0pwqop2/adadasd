import React, { useState } from 'react';
import { useLocation } from 'wouter';
import { useGetMe, useGetAdminSettings, useUpdateAdminSettings, useGetAdminUsers, useAdminUpdateUserSlots } from '@workspace/api-client-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { ArrowLeft, Save, Users, Settings, Shield, ShieldOff, Loader2, RotateCcw, AlertTriangle, Crown, Server, ChevronDown, ChevronUp, Search, Copy, ExternalLink } from 'lucide-react';
import { motion } from 'framer-motion';

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${import.meta.env.BASE_URL}${path}`, { credentials: 'include' });
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
}

export default function Admin() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: user, isLoading: isUserLoading, isError: isUserError } = useGetMe({ query: { retry: false } });
  const { data: settings, isLoading: isSettingsLoading, refetch: refetchSettings } = useGetAdminSettings({ query: { enabled: !!user?.isAdmin } });
  const { data: usersData, isLoading: isUsersLoading, refetch: refetchUsers } = useGetAdminUsers({ query: { enabled: !!user?.isAdmin } });

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

  const { mutate: resetAllSlots, isPending: isResetting } = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${import.meta.env.BASE_URL}api/admin/reset-all-slots`, { method: 'POST', credentials: 'include' });
      if (!res.ok) throw new Error('Failed to reset slots');
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "All slots reset", description: "Every slot has been deactivated.", className: "bg-red-600 text-white border-none" });
      setConfirmReset(false);
      refetchUsers();
    },
    onError: () => toast({ title: "Error", description: "Failed to reset slots.", variant: "destructive" }),
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
  const [confirmReset, setConfirmReset] = useState(false);

  type ServerEntry = { id: string; name: string; icon: string | null; userCount: number; users: { username: string; discordId: string }[] };
  const { data: serversData, isLoading: isServersLoading } = useQuery({
    queryKey: ['admin-servers'],
    queryFn: () => apiFetch<{ servers: ServerEntry[] }>('api/admin/servers'),
    enabled: !!user?.isAdmin,
    refetchInterval: 30000,
  });

  const HIDDEN_GUILD_DISCORD_IDS = new Set(['905033435817586749']);

  const copyServerId = (id: string) => {
    navigator.clipboard.writeText(id);
    setCopiedServerId(id);
    setTimeout(() => setCopiedServerId(null), 2000);
  };
  const [confirmResetLeaderboard, setConfirmResetLeaderboard] = useState(false);
  const [confirmResetDeposits, setConfirmResetDeposits] = useState(false);

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
                          </div>
                          <p className="font-mono text-xs text-muted-foreground">{u.discordId}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`font-mono text-sm px-3 py-1 border chamfered shrink-0 ${u.activeSlots > 0 ? 'border-primary/40 text-primary bg-primary/10' : 'border-primary/10 text-muted-foreground'}`}>
                          {u.activeSlots} / {u.totalSlots} active
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
                                  <Crown className="w-3 h-3 text-yellow-400 shrink-0" title="Server Owner" />
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
          {/* Danger Zone */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
            <Card className="border-red-500/30 bg-red-500/5">
              <div className="p-6 border-b border-red-500/20 flex items-center gap-3">
                <AlertTriangle className="w-5 h-5 text-red-400" />
                <h2 className="font-display font-bold uppercase tracking-wider text-red-400">Danger Zone</h2>
              </div>

              <div className="divide-y divide-red-500/10">
                {/* Reset All Slots */}
                <div className="p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <p className="font-mono text-sm text-foreground font-bold">Reset All Slots</p>
                    <p className="text-xs text-muted-foreground font-mono mt-1">Deactivates every slot for every user. This cannot be undone.</p>
                  </div>
                  {confirmReset ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-red-400 uppercase">Are you sure?</span>
                      <Button
                        size="sm"
                        className="bg-red-600 hover:bg-red-700 text-white border-none"
                        onClick={() => resetAllSlots()}
                        disabled={isResetting}
                      >
                        {isResetting ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Yes, Reset All'}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setConfirmReset(false)} className="border-primary/20">
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-red-500/40 text-red-400 hover:bg-red-500/10 hover:border-red-500 font-mono shrink-0"
                      onClick={() => setConfirmReset(true)}
                    >
                      <RotateCcw className="w-4 h-4 mr-2" />
                      Reset All Slots
                    </Button>
                  )}
                </div>

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
              <div className="p-6 border-b border-primary/20 flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="flex items-center gap-3 flex-1">
                  <Server className="w-5 h-5 text-primary" />
                  <div>
                    <h3 className="font-display font-bold uppercase tracking-widest text-primary">Server Explorer</h3>
                    <p className="text-xs font-mono text-muted-foreground mt-0.5">All Discord servers your users belong to</p>
                  </div>
                </div>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder="Search by name or ID..."
                    value={serverSearch}
                    onChange={e => setServerSearch(e.target.value)}
                    className="bg-background border border-border rounded-lg text-foreground font-mono pl-9 pr-3 py-2 text-xs w-64 focus:outline-none focus:border-primary/60 placeholder:text-muted-foreground/50"
                  />
                </div>
              </div>

              {isServersLoading ? (
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
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-border text-muted-foreground hover:text-primary hover:border-primary/50 font-mono text-xs"
                            onClick={() => window.open(`https://discord.com/channels/${s.id}`, '_blank')}
                          >
                            <ExternalLink className="w-3 h-3 mr-1" /> Open
                          </Button>
                        </div>
                      </div>
                    ))}
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
