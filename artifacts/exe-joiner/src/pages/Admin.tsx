import React, { useState } from 'react';
import { useLocation } from 'wouter';
import { useGetMe, useGetAdminSettings, useUpdateAdminSettings, useGetAdminUsers, useAdminUpdateUserSlots } from '@workspace/api-client-react';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { ArrowLeft, Save, Users, Settings, Shield, Loader2, RotateCcw, AlertTriangle } from 'lucide-react';
import { motion } from 'framer-motion';

export default function Admin() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: user, isLoading: isUserLoading, isError: isUserError } = useGetMe({ query: { retry: false } });
  const { data: settings, isLoading: isSettingsLoading, refetch: refetchSettings } = useGetAdminSettings({ query: { enabled: !!user?.isAdmin } });
  const { data: usersData, isLoading: isUsersLoading, refetch: refetchUsers } = useGetAdminUsers({ query: { enabled: !!user?.isAdmin } });

  const { mutate: updateSettings, isPending: isSaving } = useUpdateAdminSettings();
  const { mutate: updateUserSlots, isPending: isUpdatingSlots } = useAdminUpdateUserSlots();

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
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [userSlotCount, setUserSlotCount] = useState<string>('');
  const [confirmReset, setConfirmReset] = useState(false);
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
    }
  }, [settings]);

  const handleSaveSettings = () => {
    const count = parseInt(slotCount, 10);
    const price = parseFloat(pricePerDay);
    const hours = parseInt(slotDurationHours, 10);
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
    updateSettings({ data: { slotCount: count, pricePerDay: price, slotDurationHours: hours } as any }, {
      onSuccess: () => {
        toast({ title: "Settings saved", description: "Slot count and price updated.", className: "bg-primary text-primary-foreground" });
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
                {usersData?.users.map((u) => (
                  <div key={u.discordId} className="p-4 flex flex-col sm:flex-row sm:items-center gap-4">
                    <div className="flex items-center gap-3 flex-1">
                      {u.avatar ? (
                        <img src={`https://cdn.discordapp.com/avatars/${u.discordId}/${u.avatar}.png`} alt="" className="w-9 h-9 border border-primary/30" />
                      ) : (
                        <div className="w-9 h-9 bg-secondary border border-primary/30" />
                      )}
                      <div>
                        <p className="font-mono text-sm text-foreground font-bold">{u.username}</p>
                        <p className="font-mono text-xs text-muted-foreground">{u.discordId}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className={`font-mono text-sm px-3 py-1 border chamfered ${u.activeSlots > 0 ? 'border-primary/40 text-primary bg-primary/10' : 'border-primary/10 text-muted-foreground'}`}>
                        {u.activeSlots} / {u.totalSlots} active
                      </span>

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

        </main>

        <footer className="border-t border-primary/10 py-4">
          <p className="text-center text-xs font-mono text-muted-foreground uppercase tracking-widest">[ Admin Access // Restricted ]</p>
        </footer>
      </div>
    </div>
  );
}
