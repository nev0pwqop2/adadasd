import React, { useState } from "react";
import { useLocation } from "wouter";
import Navbar from "@/components/Navbar";
import {
  useGetMe,
  useGetAdminSettings,
  useUpdateAdminSettings,
  useGetAdminUsers,
  useAdminUpdateUserSlots,
} from "@workspace/api-client-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import {
  Save, Users, Settings, Shield, ShieldOff, Loader2, RotateCcw,
  AlertTriangle, Crown, Server, ChevronDown, ChevronUp, Search,
  Copy, FlaskConical, Check, Key, CreditCard, Bitcoin, TrendingUp,
  Ban, Tag, Gavel, Plus, Trash2, ToggleLeft, ToggleRight, Pause,
  Play, Layers, CheckCircle,
} from "lucide-react";

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${import.meta.env.BASE_URL}${path}`, {
    credentials: "include",
    ...options,
  });
  if (!res.ok) {
    let msg = `Request failed: ${res.status}`;
    try { const j = await res.json(); msg = j.message ?? j.error ?? msg; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

type Tab = "settings" | "users" | "slots" | "payments" | "bids" | "coupons" | "tools";

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "settings", label: "Settings", icon: <Settings className="w-4 h-4" /> },
  { id: "users",    label: "Users",    icon: <Users className="w-4 h-4" /> },
  { id: "slots",    label: "Slots",    icon: <Layers className="w-4 h-4" /> },
  { id: "payments", label: "Payments", icon: <CreditCard className="w-4 h-4" /> },
  { id: "bids",     label: "Bids",     icon: <Gavel className="w-4 h-4" /> },
  { id: "coupons",  label: "Coupons",  icon: <Tag className="w-4 h-4" /> },
  { id: "tools",    label: "Tools",    icon: <FlaskConical className="w-4 h-4" /> },
];

export default function Admin() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<Tab>("settings");

  const { data: user, isLoading: isUserLoading, isError: isUserError } = useGetMe({ query: { retry: false } as any });
  const { data: settings, isLoading: isSettingsLoading, refetch: refetchSettings } = useGetAdminSettings({ query: { enabled: !!user?.isAdmin } as any });
  const { data: usersData, isLoading: isUsersLoading, refetch: refetchUsers } = useGetAdminUsers({ query: { enabled: !!user?.isAdmin } as any });

  const SUPER_ADMIN_IDS = new Set(["905033435817586749","1279091875378368595","1411024429365989456","1485902008601804900","633039714160738342","335796369921015808"]);
  const isSuperAdmin = SUPER_ADMIN_IDS.has(user?.discordId ?? "");

  const { mutate: updateSettings, isPending: isSaving } = useUpdateAdminSettings();
  const { mutate: updateUserSlots, isPending: isUpdatingSlots } = useAdminUpdateUserSlots();

  // ── Types ──────────────────────────────────────────────────────────────────
  type AdminSlot = { slotNumber: number; isActive: boolean; isPaused: boolean; pausedAt: string | null; expiresAt: string | null; owner: { username: string; discordId: string; avatar: string | null } | null };
  type CouponEntry = { id: number; code: string; discountType: string; discountValue: string; maxUses: number | null; usedCount: number; expiresAt: string | null; isActive: boolean; createdAt: string };
  type AllPaymentEntry = { id: string; username: string; discordId: string; avatar: string | null; status: string; method: string; currency: string | null; amount: string | null; usdAmount: string | null; slotNumber: number; address: string | null; txHash: string | null; stripeSessionId: string | null; expiresAt: string | null; couponId: number | null; purchaseType: string; createdAt: string | null; updatedAt: string | null };
  type AdminBid = { id: number; amount: number; username: string; discordId: string; userId: string; createdAt: string };
  type PeriodStats = { total: number; stripe: number; crypto: number; stripeCount: number; cryptoCount: number; count: number };
  type TransactionsResponse = { summary: { today: PeriodStats; week: PeriodStats; month: PeriodStats; allTime: PeriodStats; pendingStripeTotal: number }; transactions: any[] };
  type ServerEntry = { id: string; name: string; icon: string | null; userCount: number; users: { username: string; discordId: string }[] };

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data: adminSlotsData, refetch: refetchAdminSlots } = useQuery<{ slots: AdminSlot[] }>({
    queryKey: ["admin-slots"],
    queryFn: () => apiFetch("api/admin/slots"),
    enabled: isSuperAdmin,
    refetchInterval: 15000,
  });
  const { data: couponsData, isLoading: isCouponsLoading, refetch: refetchCoupons } = useQuery({
    queryKey: ["admin-coupons"],
    queryFn: () => apiFetch<{ coupons: CouponEntry[] }>("api/admin/coupons"),
    enabled: !!user?.isAdmin,
  });
  const { data: allPaymentsData, isLoading: isAllPaymentsLoading, refetch: refetchAllPayments } = useQuery({
    queryKey: ["admin-all-payments"],
    queryFn: () => apiFetch<{ payments: AllPaymentEntry[]; total: number }>("api/admin/all-payments"),
    enabled: !!user?.isAdmin,
    refetchInterval: 30000,
  });
  const { data: adminBidsData, isLoading: isAdminBidsLoading, refetch: refetchAdminBids } = useQuery({
    queryKey: ["admin-bids"],
    queryFn: () => apiFetch<{ bids: AdminBid[] }>("api/admin/bids"),
    enabled: !!user?.isAdmin,
    refetchInterval: 15000,
  });
  const { data: txData, isLoading: isTxLoading } = useQuery({
    queryKey: ["admin-transactions"],
    queryFn: () => apiFetch<TransactionsResponse>("api/admin/transactions"),
    enabled: !!user?.isAdmin,
    refetchInterval: 60000,
  });
  const { data: serversData, isLoading: isServersLoading } = useQuery({
    queryKey: ["admin-servers"],
    queryFn: () => apiFetch<{ servers: ServerEntry[] }>("api/admin/servers"),
    enabled: !!user?.isAdmin,
  });

  // ── Settings state ────────────────────────────────────────────────────────
  const [slotCount, setSlotCount] = useState("");
  const [pricePerDay, setPricePerDay] = useState("");
  const [slotDurationHours, setSlotDurationHours] = useState("");
  const [hourlyPricingEnabled, setHourlyPricingEnabled] = useState(false);
  const [pricePerHour, setPricePerHour] = useState("");
  const [minHours, setMinHours] = useState("");
  const [paymentsEnabled, setPaymentsEnabled] = useState(true);
  const [paymentsToggling, setPaymentsToggling] = useState(false);

  // ── User management state ─────────────────────────────────────────────────
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [userSlotCount, setUserSlotCount] = useState("");
  const [editingBalance, setEditingBalance] = useState<string | null>(null);
  const [balanceAmount, setBalanceAmount] = useState("");
  const [togglingAdmin, setTogglingAdmin] = useState<string | null>(null);
  const [togglingBan, setTogglingBan] = useState<string | null>(null);
  const [togglingPause, setTogglingPause] = useState<number | null>(null);
  const [expandedGuilds, setExpandedGuilds] = useState<string | null>(null);
  const HIDDEN_GUILD_DISCORD_IDS = new Set(["905033435817586749"]);

  // ── Payments state ────────────────────────────────────────────────────────
  const [paymentsStatusFilter, setPaymentsStatusFilter] = useState("all");
  const [verifyingPaymentId, setVerifyingPaymentId] = useState<string | null>(null);

  // ── Coupon form state ────────────────────────────────────────────────────
  const [couponForm, setCouponForm] = useState({ code: "", discountType: "percent", discountValue: "", maxUses: "", expiresAt: "" });

  // ── Dev tools state ───────────────────────────────────────────────────────
  const [testScriptResult, setTestScriptResult] = useState<{ scriptKey: string | null; script: string | null; expiresAt: string; luarmorConfigured: boolean } | null>(null);
  const [testKeyCopied, setTestKeyCopied] = useState(false);
  const [testScriptCopied, setTestScriptCopied] = useState(false);
  const [testDmStatus, setTestDmStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [pollerStatus, setPollerStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [forcePaymentId, setForcePaymentId] = useState("");
  const [forceCompleteStatus, setForceCompleteStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [forceCompleteMsg, setForceCompleteMsg] = useState("");

  // ── Danger zone state ─────────────────────────────────────────────────────
  const [confirmResetLeaderboard, setConfirmResetLeaderboard] = useState(false);
  const [confirmResetDeposits, setConfirmResetDeposits] = useState(false);

  // ── Server explorer state ─────────────────────────────────────────────────
  const [serverSearch, setServerSearch] = useState("");
  const [copiedServerId, setCopiedServerId] = useState<string | null>(null);
  const [isFulfillingBid, setIsFulfillingBid] = useState(false);

  // ── Mutations ─────────────────────────────────────────────────────────────
  const { mutate: togglePause } = useMutation({
    mutationFn: async (slotNumber: number) => {
      const res = await fetch(`${import.meta.env.BASE_URL}api/admin/slots/${slotNumber}/toggle-pause`, { method: "POST", credentials: "include" });
      if (!res.ok) { const d = await res.json(); throw new Error(d.message || "Failed"); }
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: data.isPaused ? "Slot paused" : "Slot unpaused", description: data.message });
      setTogglingPause(null); refetchAdminSlots();
    },
    onError: (err: any) => { toast({ title: "Error", description: err.message, variant: "destructive" }); setTogglingPause(null); },
  });

  const { mutate: toggleAdmin } = useMutation({
    mutationFn: async (discordId: string) => {
      const res = await fetch(`${import.meta.env.BASE_URL}api/admin/users/${discordId}/toggle-admin`, { method: "POST", credentials: "include" });
      if (!res.ok) { const d = await res.json(); throw new Error(d.message || "Failed"); }
      return res.json();
    },
    onSuccess: (data) => { toast({ title: "Role updated", description: data.message }); setTogglingAdmin(null); refetchUsers(); },
    onError: (err: any) => { toast({ title: "Error", description: err.message, variant: "destructive" }); setTogglingAdmin(null); },
  });

  const { mutate: addBalance, isPending: isAddingBalance } = useMutation({
    mutationFn: async ({ discordId, amount }: { discordId: string; amount: number }) => {
      const res = await fetch(`${import.meta.env.BASE_URL}api/admin/users/${discordId}/add-balance`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amount }) });
      if (!res.ok) { const d = await res.json(); throw new Error(d.message || "Failed"); }
      return res.json();
    },
    onSuccess: (data) => { toast({ title: "Balance updated", description: data.message }); setEditingBalance(null); setBalanceAmount(""); refetchUsers(); },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const { mutate: toggleBan } = useMutation({
    mutationFn: async (discordId: string) => {
      const res = await fetch(`${import.meta.env.BASE_URL}api/admin/users/${discordId}/ban`, { method: "POST", credentials: "include" });
      if (!res.ok) { const d = await res.json(); throw new Error(d.message || "Failed"); }
      return res.json();
    },
    onSuccess: (data) => { toast({ title: data.isBanned ? "User banned" : "User unbanned", description: data.message }); setTogglingBan(null); refetchUsers(); },
    onError: (err: any) => { toast({ title: "Error", description: err.message, variant: "destructive" }); setTogglingBan(null); },
  });

  const { mutate: createCoupon, isPending: isCreatingCoupon } = useMutation({
    mutationFn: async () => {
      const body: any = { code: couponForm.code, discountType: couponForm.discountType, discountValue: parseFloat(couponForm.discountValue), maxUses: couponForm.maxUses ? parseInt(couponForm.maxUses) : null, expiresAt: couponForm.expiresAt || null };
      const res = await fetch(`${import.meta.env.BASE_URL}api/admin/coupons`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) { const d = await res.json(); throw new Error(d.message || "Failed"); }
      return res.json();
    },
    onSuccess: () => { toast({ title: "Coupon created" }); setCouponForm({ code: "", discountType: "percent", discountValue: "", maxUses: "", expiresAt: "" }); refetchCoupons(); },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const { mutate: deleteCoupon } = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`${import.meta.env.BASE_URL}api/admin/coupons/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => { toast({ title: "Coupon deleted" }); refetchCoupons(); },
    onError: () => toast({ title: "Error", description: "Failed to delete", variant: "destructive" }),
  });

  const { mutate: toggleCoupon } = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`${import.meta.env.BASE_URL}api/admin/coupons/${id}/toggle`, { method: "PATCH", credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => refetchCoupons(),
    onError: () => toast({ title: "Error", description: "Failed to toggle", variant: "destructive" }),
  });

  const { mutate: verifyPayment } = useMutation({
    mutationFn: (paymentId: string) => apiFetch<{ success: boolean; message: string }>(`api/admin/payments/${paymentId}/verify`, { method: "POST" }),
    onMutate: (paymentId) => setVerifyingPaymentId(paymentId),
    onSettled: () => setVerifyingPaymentId(null),
    onSuccess: (data) => { toast({ title: "Payment verified", description: data.message }); refetchAllPayments(); },
    onError: (err: Error) => toast({ title: "Verification failed", description: err.message, variant: "destructive" }),
  });

  const { mutate: fulfillTopBid } = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${import.meta.env.BASE_URL}api/admin/bids/fulfill`, { method: "POST", credentials: "include" });
      if (!res.ok) { const d = await res.json(); throw new Error(d.message || "Failed"); }
      return res.json();
    },
    onSuccess: (data) => { toast({ title: "Bid fulfilled!", description: data.message }); setIsFulfillingBid(false); refetchAdminBids(); },
    onError: (err: any) => { toast({ title: "Error", description: err.message, variant: "destructive" }); setIsFulfillingBid(false); },
  });

  const { mutate: resetLeaderboard, isPending: isResettingLeaderboard } = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${import.meta.env.BASE_URL}api/admin/reset-leaderboard`, { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => { toast({ title: "Leaderboard reset" }); setConfirmResetLeaderboard(false); },
    onError: () => toast({ title: "Error", description: "Failed to reset leaderboard", variant: "destructive" }),
  });

  const { mutate: resetAllDeposits, isPending: isResettingDeposits } = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${import.meta.env.BASE_URL}api/admin/reset-all-deposits`, { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => { toast({ title: "All deposits reset" }); setConfirmResetDeposits(false); },
    onError: () => toast({ title: "Error", description: "Failed", variant: "destructive" }),
  });

  const { mutate: generateTestScript, isPending: isGeneratingTestScript } = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${import.meta.env.BASE_URL}api/admin/test-script`, { method: "POST", credentials: "include" });
      if (!res.ok) { const d = await res.json(); throw new Error(d.message || "Failed"); }
      return res.json();
    },
    onSuccess: (data) => setTestScriptResult(data),
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  // ── Effects ────────────────────────────────────────────────────────────────
  React.useEffect(() => { if (isUserError) setLocation("/"); }, [isUserError, setLocation]);
  React.useEffect(() => { if (user && !user.isAdmin) setLocation("/dashboard"); }, [user, setLocation]);
  React.useEffect(() => {
    if (settings) {
      setSlotCount(String(settings.slotCount));
      setPricePerDay(String(settings.pricePerDay));
      setSlotDurationHours(String((settings as any).slotDurationHours ?? 24));
      setHourlyPricingEnabled(Boolean((settings as any).hourlyPricingEnabled));
      setPricePerHour(String((settings as any).pricePerHour ?? 5));
      setMinHours(String((settings as any).minHours ?? 2));
      setPaymentsEnabled((settings as any).paymentsEnabled !== false);
    }
  }, [settings]);

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleSaveSettings = () => {
    const count = parseInt(slotCount, 10);
    const price = parseFloat(pricePerDay);
    const hours = parseInt(slotDurationHours, 10);
    const pph = parseFloat(pricePerHour);
    const mh = parseInt(minHours, 10);
    if (isNaN(count) || count < 1 || count > 100) return toast({ title: "Invalid slot count", description: "Must be 1–100", variant: "destructive" });
    if (isNaN(price) || price < 0) return toast({ title: "Invalid price", variant: "destructive" });
    if (isNaN(hours) || hours < 1 || hours > 720) return toast({ title: "Invalid duration", description: "Must be 1–720 hours", variant: "destructive" });
    updateSettings({ data: { slotCount: count, pricePerDay: price, slotDurationHours: hours, hourlyPricingEnabled, pricePerHour: pph, minHours: mh } as any }, {
      onSuccess: () => { toast({ title: "Settings saved" }); refetchSettings(); },
      onError: () => toast({ title: "Error", description: "Failed to save", variant: "destructive" }),
    });
  };

  const handleUpdateUserSlots = (discordId: string) => {
    const count = parseInt(userSlotCount, 10);
    if (isNaN(count) || count < 0) return toast({ title: "Invalid count", variant: "destructive" });
    updateUserSlots({ discordId, data: { activeSlotCount: count } }, {
      onSuccess: () => { toast({ title: "Updated" }); setEditingUser(null); setUserSlotCount(""); refetchUsers(); },
      onError: () => toast({ title: "Error", variant: "destructive" }),
    });
  };

  const copyServerId = (id: string) => {
    navigator.clipboard.writeText(id);
    setCopiedServerId(id);
    setTimeout(() => setCopiedServerId(null), 2000);
  };

  // ── Loading / auth ─────────────────────────────────────────────────────────
  if (isUserLoading || isSettingsLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }
  if (!user?.isAdmin) return null;

  const filteredServers = (serversData?.servers ?? []).filter(s =>
    !serverSearch.trim() || s.name.toLowerCase().includes(serverSearch.toLowerCase()) || s.id.includes(serverSearch)
  );

  // ── Helpers ────────────────────────────────────────────────────────────────
  function StatCard({ label, stats }: { label: string; stats: PeriodStats | undefined }) {
    if (!stats) return null;
    return (
      <div className="border border-white/[0.06] bg-white/[0.02] p-4 space-y-2">
        <p className="text-xs text-muted-foreground uppercase tracking-widest font-mono">{label}</p>
        <p className="text-2xl font-bold text-primary">${stats.total.toFixed(2)}</p>
        <div className="space-y-1 text-xs font-mono text-muted-foreground">
          <div className="flex justify-between"><span className="flex items-center gap-1"><CreditCard className="w-3 h-3 text-blue-400" />Card</span><span className="text-foreground">${stats.stripe.toFixed(2)} ({stats.stripeCount})</span></div>
          <div className="flex justify-between"><span className="flex items-center gap-1"><Bitcoin className="w-3 h-3 text-orange-400" />Crypto</span><span className="text-foreground">${stats.crypto.toFixed(2)} ({stats.cryptoCount})</span></div>
        </div>
      </div>
    );
  }

  const methodLabel = (p: AllPaymentEntry) => {
    if (p.method?.includes("stripe")) return "Card";
    if (p.method?.includes("crypto") || p.method?.includes("nowpayments")) return `Crypto${p.currency ? ` (${p.currency})` : ""}`;
    if (p.method === "balance" || p.method === "preorder-balance") return "Balance";
    return p.method ?? "—";
  };

  const amountLabel = (p: AllPaymentEntry) => {
    if (p.usdAmount) return `$${parseFloat(p.usdAmount).toFixed(2)}`;
    if (p.amount) {
      const isCard = p.method?.includes("stripe") || p.method === "balance";
      return isCard ? `$${parseFloat(p.amount).toFixed(2)}` : `${p.amount}${p.currency ? ` ${p.currency}` : ""}`;
    }
    return "—";
  };

  const statusBadge = (status: string) => {
    const cfg: Record<string, { cls: string }> = {
      pending:   { cls: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30" },
      completed: { cls: "bg-green-500/10 text-green-400 border-green-500/30" },
      failed:    { cls: "bg-red-500/10 text-red-400 border-red-500/30" },
      expired:   { cls: "bg-orange-500/10 text-orange-400 border-orange-500/30" },
    };
    const c = cfg[status] ?? { cls: "bg-primary/10 text-primary border-primary/30" };
    return <span className={`px-2 py-0.5 text-[10px] font-mono border uppercase tracking-wide ${c.cls}`}>{status}</span>;
  };

  const typeColor = (purchaseType: string) =>
    purchaseType === "preorder" ? "text-orange-400" :
    purchaseType === "balance_deposit" ? "text-blue-400" : "text-green-400";

  const typeLabel = (purchaseType: string) =>
    purchaseType === "preorder" ? "Pre-order" :
    purchaseType === "balance_deposit" ? "Deposit" : "Slot";

  const input = "w-full bg-background border border-primary/30 text-foreground font-mono px-3 py-2 text-sm focus:outline-none focus:border-primary";

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar current="admin" />

      <main className="flex-1 max-w-5xl mx-auto px-4 py-6 w-full space-y-4">

        {/* Tab bar */}
        <div className="flex flex-wrap gap-1 border-b border-white/[0.06] pb-0">
          {TABS.filter(t => t.id !== "slots" || isSuperAdmin).map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-mono transition-colors border-b-2 -mb-px ${
                activeTab === t.id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.icon}
              {t.label}
              {t.id === "bids" && (adminBidsData?.bids.length ?? 0) > 0 && (
                <span className="ml-1 px-1.5 py-0.5 text-[10px] bg-primary/20 text-primary rounded-full font-bold">
                  {adminBidsData!.bids.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ── SETTINGS ──────────────────────────────────────────────────────── */}
        {activeTab === "settings" && (
          <Card className="border-white/[0.06] bg-white/[0.02]">
            <div className="p-5 border-b border-white/[0.06]">
              <h2 className="font-semibold text-sm text-foreground">System Settings</h2>
            </div>
            <div className="p-5 grid grid-cols-1 sm:grid-cols-3 gap-5">
              <div className="space-y-1.5">
                <label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Total Slots</label>
                <input type="number" min={1} max={100} value={slotCount} onChange={e => setSlotCount(e.target.value)} className={input} />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Price Per Day (USD)</label>
                <input type="number" min={0} step={0.01} value={pricePerDay} onChange={e => setPricePerDay(e.target.value)} className={input} />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Slot Duration (Hours)</label>
                <input type="number" min={1} max={720} value={slotDurationHours} onChange={e => setSlotDurationHours(e.target.value)} className={input} />
              </div>

              <div className="sm:col-span-3 pt-3 border-t border-white/[0.06] space-y-3">
                <label className="flex items-center gap-3 cursor-pointer select-none">
                  <div
                    onClick={() => setHourlyPricingEnabled(v => !v)}
                    className={`relative w-11 h-6 border cursor-pointer transition-colors ${hourlyPricingEnabled ? "bg-primary border-primary" : "bg-secondary border-primary/30"}`}
                  >
                    <div className={`absolute top-0.5 w-5 h-5 bg-background transition-transform ${hourlyPricingEnabled ? "translate-x-5" : "translate-x-0.5"}`} />
                  </div>
                  <span className="text-sm font-mono text-foreground">Hourly Pricing — {hourlyPricingEnabled ? "enabled" : "disabled"}</span>
                </label>

                {hourlyPricingEnabled && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    <div className="space-y-1.5">
                      <label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Price Per Hour (USD)</label>
                      <input type="number" min={0} step={0.01} value={pricePerHour} onChange={e => setPricePerHour(e.target.value)} className={input} />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Minimum Hours</label>
                      <input type="number" min={1} step={1} value={minHours} onChange={e => setMinHours(e.target.value)} className={input} />
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="px-5 pb-5">
              <Button onClick={handleSaveSettings} disabled={isSaving} size="sm">
                {isSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                Save Settings
              </Button>
            </div>
          </Card>
        )}

        {/* ── USERS ─────────────────────────────────────────────────────────── */}
        {activeTab === "users" && (
          <Card className="border-white/[0.06]">
            <div className="p-5 border-b border-white/[0.06] flex items-center justify-between">
              <h2 className="font-semibold text-sm text-foreground">Users</h2>
              <span className="text-xs font-mono text-muted-foreground">{usersData?.users.length ?? 0} total</span>
            </div>
            {isUsersLoading ? (
              <div className="p-10 flex justify-center"><Loader2 className="w-6 h-6 text-primary animate-spin" /></div>
            ) : !usersData?.users.length ? (
              <div className="p-10 text-center text-sm font-mono text-muted-foreground">No users yet.</div>
            ) : (
              <div className="divide-y divide-white/[0.04]">
                {usersData.users.map((u: any) => (
                  <div key={u.discordId} className="p-4 space-y-3">
                    {/* User header */}
                    <div className="flex items-center gap-3">
                      {u.avatar ? (
                        <img src={`https://cdn.discordapp.com/avatars/${u.discordId}/${u.avatar}.png`} alt="" className="w-8 h-8 rounded-full border border-white/10 shrink-0" />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-secondary border border-white/10 shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-sm font-bold text-foreground">{u.username}</span>
                          {u.isSuperAdmin && <span className="text-[10px] font-mono px-1.5 py-0.5 bg-yellow-500/10 border border-yellow-500/20 text-yellow-400">Super Admin</span>}
                          {u.isAdmin && !u.isSuperAdmin && <span className="text-[10px] font-mono px-1.5 py-0.5 bg-primary/10 border border-primary/20 text-primary">Admin</span>}
                          {u.isBanned && <span className="text-[10px] font-mono px-1.5 py-0.5 bg-red-500/10 border border-red-500/20 text-red-400">Banned</span>}
                        </div>
                        <p className="text-xs font-mono text-muted-foreground">{u.discordId}</p>
                      </div>
                      <span className={`text-xs font-mono shrink-0 ${u.activeSlots > 0 ? "text-primary" : "text-muted-foreground"}`}>
                        {u.activeSlots} slot{u.activeSlots !== 1 ? "s" : ""}
                      </span>
                    </div>

                    {/* Actions */}
                    <div className="flex flex-wrap items-center gap-2 pl-11">
                      {/* Balance */}
                      {editingBalance === u.discordId ? (
                        <div className="flex items-center gap-2">
                          <input type="number" step="0.01" value={balanceAmount} onChange={e => setBalanceAmount(e.target.value)} placeholder="e.g. 10 or -5" className="w-28 bg-background border border-green-500/40 text-foreground font-mono px-2 py-1 text-xs focus:outline-none" autoFocus />
                          <Button size="sm" className="h-7 text-xs bg-green-600 hover:bg-green-700 text-white border-none" onClick={() => addBalance({ discordId: u.discordId, amount: parseFloat(balanceAmount) })} disabled={isAddingBalance || !balanceAmount}>
                            {isAddingBalance ? <Loader2 className="w-3 h-3 animate-spin" /> : "Apply"}
                          </Button>
                          <Button size="sm" variant="outline" className="h-7 text-xs border-white/10" onClick={() => { setEditingBalance(null); setBalanceAmount(""); }}>Cancel</Button>
                        </div>
                      ) : (
                        <Button size="sm" variant="outline" className="h-7 text-xs border-green-500/30 text-green-400 hover:bg-green-500/10" onClick={() => { setEditingBalance(u.discordId); setBalanceAmount(""); }}>
                          <Plus className="w-3 h-3 mr-1" />Balance ${parseFloat(u.balance ?? "0").toFixed(2)}
                        </Button>
                      )}

                      {/* Edit slots */}
                      {editingUser === u.discordId ? (
                        <div className="flex items-center gap-2">
                          <input type="number" min={0} max={u.totalSlots} value={userSlotCount} onChange={e => setUserSlotCount(e.target.value)} placeholder="# active" className="w-20 bg-background border border-primary/40 text-foreground font-mono px-2 py-1 text-xs focus:outline-none" autoFocus />
                          <Button size="sm" className="h-7 text-xs" onClick={() => handleUpdateUserSlots(u.discordId)} disabled={isUpdatingSlots}>
                            {isUpdatingSlots ? <Loader2 className="w-3 h-3 animate-spin" /> : "Set"}
                          </Button>
                          <Button size="sm" variant="outline" className="h-7 text-xs border-white/10" onClick={() => { setEditingUser(null); setUserSlotCount(""); }}>Cancel</Button>
                        </div>
                      ) : (
                        <Button size="sm" variant="outline" className="h-7 text-xs border-white/10 text-muted-foreground hover:text-foreground" onClick={() => { setEditingUser(u.discordId); setUserSlotCount(String(u.activeSlots)); }}>
                          Edit Slots
                        </Button>
                      )}

                      {/* Admin toggle */}
                      {isSuperAdmin && !u.isSuperAdmin && (
                        togglingAdmin === u.discordId ? <Button size="sm" variant="outline" disabled className="h-7 text-xs border-white/10"><Loader2 className="w-3 h-3 animate-spin" /></Button> : (
                          <Button size="sm" variant="outline" className={`h-7 text-xs border-white/10 ${u.isAdmin ? "text-red-400 hover:bg-red-500/10" : "text-primary hover:bg-primary/10"}`} onClick={() => { setTogglingAdmin(u.discordId); toggleAdmin(u.discordId); }}>
                            {u.isAdmin ? <><ShieldOff className="w-3 h-3 mr-1" />Remove Admin</> : <><Shield className="w-3 h-3 mr-1" />Make Admin</>}
                          </Button>
                        )
                      )}

                      {/* Ban toggle */}
                      {!u.isSuperAdmin && (
                        togglingBan === u.discordId ? <Button size="sm" variant="outline" disabled className="h-7 text-xs border-white/10"><Loader2 className="w-3 h-3 animate-spin" /></Button> : (
                          <Button size="sm" variant="outline" className={`h-7 text-xs ${u.isBanned ? "border-green-500/30 text-green-400 hover:bg-green-500/10" : "border-red-500/30 text-red-400 hover:bg-red-500/10"}`} onClick={() => { setTogglingBan(u.discordId); toggleBan(u.discordId); }}>
                            <Ban className="w-3 h-3 mr-1" />{u.isBanned ? "Unban" : "Ban"}
                          </Button>
                        )
                      )}

                      {/* Guilds */}
                      {u.guilds?.length > 0 && !HIDDEN_GUILD_DISCORD_IDS.has(u.discordId) && (
                        <Button size="sm" variant="outline" className="h-7 text-xs border-white/10 text-muted-foreground hover:text-foreground" onClick={() => setExpandedGuilds(expandedGuilds === u.discordId ? null : u.discordId)}>
                          <Server className="w-3 h-3 mr-1" />{u.guilds.length} Servers
                          {expandedGuilds === u.discordId ? <ChevronUp className="w-3 h-3 ml-1" /> : <ChevronDown className="w-3 h-3 ml-1" />}
                        </Button>
                      )}
                    </div>

                    {/* Expanded guilds */}
                    {expandedGuilds === u.discordId && u.guilds?.length > 0 && (
                      <div className="pl-11">
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5 max-h-48 overflow-y-auto">
                          {u.guilds.map((g: any) => (
                            <div key={g.id} className="flex items-center gap-2 p-2 border border-white/[0.04] bg-white/[0.02] text-xs font-mono">
                              {g.icon ? <img src={`https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=32`} alt="" className="w-5 h-5 rounded-full shrink-0" /> : <div className="w-5 h-5 rounded-full bg-secondary shrink-0" />}
                              <span className="truncate text-muted-foreground flex-1">{g.name}</span>
                              {g.owner && <Crown className="w-3 h-3 text-yellow-400 shrink-0" />}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}

        {/* ── SLOTS (super admin) ───────────────────────────────────────────── */}
        {activeTab === "slots" && isSuperAdmin && (
          <Card className="border-amber-500/20">
            <div className="p-5 border-b border-amber-500/10 flex items-center justify-between">
              <h2 className="font-semibold text-sm text-foreground">Slot Control</h2>
              <span className="text-xs font-mono text-muted-foreground">{adminSlotsData?.slots.filter(s => s.isActive).length ?? 0} active</span>
            </div>
            <div className="p-5">
              {!adminSlotsData && <div className="flex items-center gap-2 text-muted-foreground text-sm font-mono"><Loader2 className="w-4 h-4 animate-spin" />Loading…</div>}
              {adminSlotsData?.slots.filter(s => s.isActive).length === 0 && <p className="text-muted-foreground text-sm font-mono">No active slots right now.</p>}
              {adminSlotsData && adminSlotsData.slots.filter(s => s.isActive).length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {adminSlotsData.slots.filter(s => s.isActive).map(slot => {
                    const isPaused = slot.isPaused;
                    const msLeft = slot.expiresAt
                      ? isPaused && slot.pausedAt
                        ? Math.max(0, new Date(slot.expiresAt).getTime() - new Date(slot.pausedAt).getTime())
                        : Math.max(0, new Date(slot.expiresAt).getTime() - Date.now())
                      : null;
                    const totalSec = msLeft != null ? Math.floor(msLeft / 1000) : null;
                    const d = totalSec != null ? Math.floor(totalSec / 86400) : null;
                    const h = totalSec != null ? Math.floor((totalSec % 86400) / 3600) : null;
                    const m = totalSec != null ? Math.floor((totalSec % 3600) / 60) : null;
                    const sec = totalSec != null ? totalSec % 60 : null;
                    const timeStr = totalSec != null
                      ? d! > 0 ? `${d}d ${h}h ${String(m).padStart(2,"0")}m` : `${h}h ${String(m).padStart(2,"0")}m ${String(sec).padStart(2,"0")}s`
                      : null;

                    return (
                      <div key={slot.slotNumber} className={`border rounded-xl flex flex-col items-center p-4 gap-3 ${isPaused ? "border-amber-500/25 bg-amber-500/5" : "border-white/[0.06] bg-white/[0.02]"}`}>
                        <div className="w-full flex items-center justify-between">
                          <span className="font-mono text-[11px] text-muted-foreground">#{String(slot.slotNumber).padStart(2,"0")}</span>
                          <span className={`text-[11px] font-mono flex items-center gap-1 ${isPaused ? "text-amber-400" : "text-primary"}`}>
                            <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${isPaused ? "bg-amber-400" : "bg-primary"}`} />
                            {isPaused ? "Paused" : "Active"}
                          </span>
                        </div>
                        {slot.owner?.avatar ? (
                          <img src={`https://cdn.discordapp.com/avatars/${slot.owner.discordId}/${slot.owner.avatar}.webp?size=64`} alt="" className="w-14 h-14 rounded-full border border-white/10" />
                        ) : (
                          <div className="w-14 h-14 rounded-full bg-secondary border border-white/10" />
                        )}
                        <p className="text-sm text-foreground/70 font-medium truncate max-w-full text-center">{slot.owner?.username ?? "Unknown"}</p>
                        {timeStr && (
                          <p className={`text-[11px] font-mono ${isPaused ? "text-amber-400/70" : "text-muted-foreground"}`}>{timeStr}</p>
                        )}
                        <button
                          disabled={togglingPause === slot.slotNumber}
                          onClick={() => { setTogglingPause(slot.slotNumber); togglePause(slot.slotNumber); }}
                          className={`w-full h-8 rounded-lg border text-xs font-mono flex items-center justify-center gap-1.5 transition-colors ${isPaused ? "border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10" : "border-amber-500/30 text-amber-400 hover:bg-amber-500/10"}`}
                        >
                          {togglingPause === slot.slotNumber ? <Loader2 className="w-3 h-3 animate-spin" /> : isPaused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
                          {isPaused ? "Resume" : "Pause"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </Card>
        )}

        {/* ── PAYMENTS ──────────────────────────────────────────────────────── */}
        {activeTab === "payments" && (
          <div className="space-y-4">
            {/* Revenue summary */}
            {!isTxLoading && txData && (
              <Card className="border-white/[0.06]">
                <div className="p-5 border-b border-white/[0.06] flex items-center gap-3">
                  <TrendingUp className="w-4 h-4 text-green-400" />
                  <h2 className="font-semibold text-sm text-foreground">Revenue</h2>
                </div>
                {(txData.summary.pendingStripeTotal ?? 0) > 0 && (
                  <div className="mx-5 mt-4 px-3 py-2 border border-yellow-500/30 bg-yellow-500/5 text-yellow-400 font-mono text-xs">
                    ⚠️ ${txData.summary.pendingStripeTotal.toFixed(2)} pending Stripe — set <code>STRIPE_WEBHOOK_SECRET</code> to auto-complete.
                  </div>
                )}
                <div className="p-5 grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <StatCard label="Today" stats={txData.summary.today} />
                  <StatCard label="This Week" stats={txData.summary.week} />
                  <StatCard label="This Month" stats={txData.summary.month} />
                  <StatCard label="All Time" stats={txData.summary.allTime} />
                </div>
              </Card>
            )}

            {/* All payments */}
            <Card className="border-white/[0.06]">
              <div className="p-5 border-b border-white/[0.06] flex items-center justify-between">
                <h2 className="font-semibold text-sm text-foreground">All Payments <span className="text-xs text-muted-foreground font-normal ml-2">{allPaymentsData?.total ?? "…"} total</span></h2>
                <button onClick={() => refetchAllPayments()} className="text-xs font-mono text-muted-foreground hover:text-primary flex items-center gap-1 transition-colors">
                  <RotateCcw className="w-3 h-3" />Refresh
                </button>
              </div>

              {/* Status filter */}
              <div className="px-5 py-3 border-b border-white/[0.04] flex flex-wrap gap-1.5">
                {["all","pending","completed","failed","expired"].map(s => {
                  const counts: Record<string,number> = {};
                  allPaymentsData?.payments.forEach(p => { counts[p.status] = (counts[p.status] ?? 0) + 1; });
                  const count = s === "all" ? (allPaymentsData?.total ?? 0) : (counts[s] ?? 0);
                  return (
                    <button key={s} onClick={() => setPaymentsStatusFilter(s)}
                      className={`px-2.5 py-1 text-xs font-mono border transition-colors capitalize ${paymentsStatusFilter === s ? "border-primary/40 text-primary bg-primary/10" : "border-white/10 text-muted-foreground hover:text-foreground"}`}>
                      {s} ({count})
                    </button>
                  );
                })}
              </div>

              {isAllPaymentsLoading ? (
                <div className="p-10 flex justify-center"><Loader2 className="w-6 h-6 text-primary animate-spin" /></div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full font-mono text-xs">
                    <thead>
                      <tr className="border-b border-white/[0.04] text-muted-foreground uppercase tracking-wider">
                        <th className="text-left px-4 py-3">User</th>
                        <th className="text-left px-4 py-3">Status</th>
                        <th className="text-left px-4 py-3">Type</th>
                        <th className="text-left px-4 py-3">Method</th>
                        <th className="text-left px-4 py-3">Amount</th>
                        <th className="text-left px-4 py-3">Slot</th>
                        <th className="text-left px-4 py-3">Ref</th>
                        <th className="text-left px-4 py-3">Date</th>
                        <th className="text-left px-4 py-3"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.03]">
                      {(paymentsStatusFilter === "all" ? allPaymentsData?.payments : allPaymentsData?.payments.filter(p => p.status === paymentsStatusFilter))?.map(p => {
                        const ref = p.txHash ?? p.stripeSessionId ?? p.address ?? null;
                        return (
                          <tr key={p.id} className="hover:bg-white/[0.02] transition-colors">
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                {p.avatar ? <img src={`https://cdn.discordapp.com/avatars/${p.discordId}/${p.avatar}.png`} alt="" className="w-5 h-5 rounded-full shrink-0" /> : <div className="w-5 h-5 rounded-full bg-secondary shrink-0" />}
                                <span className="text-foreground font-bold truncate max-w-[80px]">{p.username}</span>
                              </div>
                            </td>
                            <td className="px-4 py-3">{statusBadge(p.status)}</td>
                            <td className={`px-4 py-3 font-bold ${typeColor(p.purchaseType)}`}>{typeLabel(p.purchaseType)}</td>
                            <td className="px-4 py-3 text-muted-foreground">{methodLabel(p)}</td>
                            <td className="px-4 py-3 text-foreground font-bold">{amountLabel(p)}</td>
                            <td className="px-4 py-3 text-muted-foreground">{p.slotNumber > 0 ? `#${p.slotNumber}` : "—"}</td>
                            <td className="px-4 py-3 text-muted-foreground">
                              {ref ? (
                                <button onClick={() => navigator.clipboard.writeText(ref)} className="flex items-center gap-1 hover:text-primary transition-colors group" title={ref}>
                                  <span className="truncate max-w-[80px]">{ref.slice(0,8)}…</span>
                                  <Copy className="w-3 h-3 opacity-0 group-hover:opacity-100 shrink-0" />
                                </button>
                              ) : "—"}
                            </td>
                            <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{p.createdAt ? new Date(p.createdAt).toLocaleDateString() : "—"}</td>
                            <td className="px-4 py-3">
                              {p.status === "pending" && (p.method?.includes("stripe") || p.method?.includes("crypto") || p.method === "crypto") && (
                                <button onClick={() => verifyPayment(p.id)} disabled={verifyingPaymentId === p.id}
                                  className="px-2 py-1 text-[10px] font-mono border border-green-500/40 text-green-400 hover:bg-green-500/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1">
                                  {verifyingPaymentId === p.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}
                                  Verify
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {!allPaymentsData?.payments.length && <div className="p-10 text-center font-mono text-muted-foreground text-sm">No payments found.</div>}
                </div>
              )}
            </Card>
          </div>
        )}

        {/* ── BIDS ──────────────────────────────────────────────────────────── */}
        {activeTab === "bids" && (
          <Card className="border-white/[0.06]">
            <div className="p-5 border-b border-white/[0.06] flex items-center justify-between">
              <h2 className="font-semibold text-sm text-foreground">Bid Queue</h2>
              <span className="text-xs font-mono text-muted-foreground">{adminBidsData?.bids.length ?? 0} active</span>
            </div>
            {isAdminBidsLoading ? (
              <div className="p-10 flex justify-center"><Loader2 className="w-6 h-6 text-primary animate-spin" /></div>
            ) : !adminBidsData?.bids.length ? (
              <div className="p-10 text-center font-mono text-sm text-muted-foreground">No active bids.</div>
            ) : (
              <div className="p-5 space-y-4">
                <div className="overflow-hidden border border-white/[0.06] rounded-lg">
                  <table className="w-full font-mono text-xs">
                    <thead>
                      <tr className="border-b border-white/[0.04] bg-white/[0.02] text-muted-foreground">
                        <th className="text-left p-3">#</th>
                        <th className="text-left p-3">User</th>
                        <th className="text-right p-3">Bid</th>
                        <th className="text-right p-3">Placed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {adminBidsData.bids.map((bid, i) => (
                        <tr key={bid.id} className={`border-b border-white/[0.03] ${i === 0 ? "bg-primary/5" : ""}`}>
                          <td className="p-3 text-muted-foreground">{i + 1}</td>
                          <td className="p-3 text-foreground">{bid.username}</td>
                          <td className="p-3 text-right font-bold text-primary">${bid.amount.toFixed(2)}</td>
                          <td className="p-3 text-right text-muted-foreground">{new Date(bid.createdAt).toLocaleDateString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center justify-between p-4 border border-white/[0.06] bg-white/[0.02] rounded-lg">
                  <div>
                    <p className="font-mono text-sm font-bold text-foreground">Fulfill Top Bid</p>
                    <p className="font-mono text-xs text-muted-foreground mt-0.5">
                      Activates slot for <span className="text-primary">{adminBidsData.bids[0]?.username}</span> (${adminBidsData.bids[0]?.amount.toFixed(2)}), refunds {adminBidsData.bids.length - 1} other{adminBidsData.bids.length - 1 !== 1 ? "s" : ""}
                    </p>
                  </div>
                  {!isFulfillingBid ? (
                    <Button size="sm" className="text-xs" onClick={() => setIsFulfillingBid(true)}>
                      <Gavel className="w-3.5 h-3.5 mr-1.5" />Fulfill
                    </Button>
                  ) : (
                    <div className="flex gap-2">
                      <Button size="sm" className="text-xs bg-green-600 hover:bg-green-700" onClick={() => fulfillTopBid()}>Confirm</Button>
                      <Button size="sm" variant="outline" className="text-xs border-white/10" onClick={() => setIsFulfillingBid(false)}>Cancel</Button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </Card>
        )}

        {/* ── COUPONS ───────────────────────────────────────────────────────── */}
        {activeTab === "coupons" && (
          <Card className="border-white/[0.06]">
            <div className="p-5 border-b border-white/[0.06] flex items-center justify-between">
              <h2 className="font-semibold text-sm text-foreground">Coupon Codes</h2>
              <span className="text-xs font-mono text-muted-foreground">{couponsData?.coupons.length ?? 0} codes</span>
            </div>

            {/* Create form */}
            <div className="p-5 border-b border-white/[0.04] space-y-3">
              <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider">New Coupon</p>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <div className="space-y-1 col-span-2 sm:col-span-1">
                  <label className="text-xs font-mono text-muted-foreground">Code</label>
                  <input type="text" placeholder="SAVE20" value={couponForm.code} onChange={e => setCouponForm(f => ({ ...f, code: e.target.value.toUpperCase() }))} className={input + " uppercase"} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-mono text-muted-foreground">Type</label>
                  <select value={couponForm.discountType} onChange={e => setCouponForm(f => ({ ...f, discountType: e.target.value }))} className={input}>
                    <option value="percent">Percent (%)</option>
                    <option value="fixed">Fixed ($)</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-mono text-muted-foreground">Value</label>
                  <input type="number" min={0} placeholder={couponForm.discountType === "percent" ? "20" : "5.00"} value={couponForm.discountValue} onChange={e => setCouponForm(f => ({ ...f, discountValue: e.target.value }))} className={input} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-mono text-muted-foreground">Max Uses</label>
                  <input type="number" min={1} placeholder="∞" value={couponForm.maxUses} onChange={e => setCouponForm(f => ({ ...f, maxUses: e.target.value }))} className={input} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-mono text-muted-foreground">Expires</label>
                  <input type="datetime-local" value={couponForm.expiresAt} onChange={e => setCouponForm(f => ({ ...f, expiresAt: e.target.value }))} className={input} />
                </div>
              </div>
              <Button size="sm" onClick={() => createCoupon()} disabled={isCreatingCoupon || !couponForm.code || !couponForm.discountValue}>
                {isCreatingCoupon ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
                Create Coupon
              </Button>
            </div>

            {/* List */}
            {isCouponsLoading ? (
              <div className="p-10 flex justify-center"><Loader2 className="w-6 h-6 text-primary animate-spin" /></div>
            ) : !couponsData?.coupons.length ? (
              <div className="p-10 text-center font-mono text-sm text-muted-foreground">No coupon codes yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full font-mono text-xs">
                  <thead>
                    <tr className="border-b border-white/[0.04] text-muted-foreground uppercase tracking-wider">
                      <th className="text-left px-4 py-3">Code</th>
                      <th className="text-left px-4 py-3">Discount</th>
                      <th className="text-left px-4 py-3">Uses</th>
                      <th className="text-left px-4 py-3">Expires</th>
                      <th className="text-left px-4 py-3">Status</th>
                      <th className="text-left px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.03]">
                    {couponsData.coupons.map((c: CouponEntry) => (
                      <tr key={c.id} className="hover:bg-white/[0.02] transition-colors">
                        <td className="px-4 py-3 font-bold text-primary tracking-widest">{c.code}</td>
                        <td className="px-4 py-3 text-foreground">{c.discountType === "percent" ? `${parseFloat(c.discountValue)}% off` : `$${parseFloat(c.discountValue).toFixed(2)} off`}</td>
                        <td className="px-4 py-3 text-muted-foreground">{c.usedCount}{c.maxUses !== null ? ` / ${c.maxUses}` : " / ∞"}</td>
                        <td className="px-4 py-3 text-muted-foreground">{c.expiresAt ? new Date(c.expiresAt).toLocaleDateString() : "—"}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 border text-[10px] ${c.isActive ? "border-green-500/30 text-green-400" : "border-red-500/30 text-red-400"}`}>{c.isActive ? "Active" : "Off"}</span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <button onClick={() => toggleCoupon(c.id)} className="text-muted-foreground hover:text-primary transition-colors" title={c.isActive ? "Disable" : "Enable"}>
                              {c.isActive ? <ToggleRight className="w-4 h-4 text-green-400" /> : <ToggleLeft className="w-4 h-4" />}
                            </button>
                            <button onClick={() => deleteCoupon(c.id)} className="text-muted-foreground hover:text-red-400 transition-colors" title="Delete">
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
        )}

        {/* ── TOOLS ─────────────────────────────────────────────────────────── */}
        {activeTab === "tools" && (
          <div className="space-y-4">

            {/* Payments on/off */}
            <Card className={paymentsEnabled ? "border-primary/20 bg-primary/[0.02]" : "border-red-500/20 bg-red-500/[0.02]"}>
              <div className="p-5 flex items-center justify-between gap-4">
                <div>
                  <h2 className={`font-semibold text-sm ${paymentsEnabled ? "text-foreground" : "text-red-400"}`}>Payments</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {paymentsEnabled ? "All payment methods are active." : "Payments are disabled — users cannot purchase slots or deposit."}
                  </p>
                </div>
                <button
                  disabled={paymentsToggling}
                  onClick={async () => {
                    const next = !paymentsEnabled;
                    setPaymentsToggling(true);
                    try {
                      await apiFetch("api/admin/settings", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ paymentsEnabled: next }),
                      });
                      setPaymentsEnabled(next);
                      toast({ title: next ? "Payments enabled" : "Payments disabled", description: next ? "Users can now make payments." : "All payment methods are now blocked." });
                    } catch (e: any) {
                      toast({ title: "Error", description: e.message, variant: "destructive" });
                    } finally {
                      setPaymentsToggling(false);
                    }
                  }}
                  className={`relative w-11 h-6 border cursor-pointer transition-colors disabled:opacity-50 ${paymentsEnabled ? "bg-primary border-primary" : "bg-secondary border-red-500/30"}`}
                >
                  <div className={`absolute top-0.5 w-5 h-5 bg-background transition-transform ${paymentsEnabled ? "translate-x-5" : "translate-x-0.5"}`} />
                </button>
              </div>
            </Card>

            {/* Payment Recovery */}
            {isSuperAdmin && (
              <Card className="border-yellow-500/20 bg-yellow-500/[0.02]">
                <div className="p-5 border-b border-yellow-500/20">
                  <h2 className="font-semibold text-sm text-yellow-400">Payment Recovery</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">Manually fix stuck or unregistered payments.</p>
                </div>
                <div className="divide-y divide-white/[0.04]">
                  {/* Run poller */}
                  <div className="p-5 flex items-center justify-between gap-4">
                    <div>
                      <p className="font-mono text-sm font-bold text-foreground">Run Payment Poller Now</p>
                      <p className="text-xs text-muted-foreground font-mono mt-0.5">Force-checks all pending crypto payments against NOWPayments API and completes any that are confirmed.</p>
                    </div>
                    <Button size="sm" variant="outline" className="border-yellow-500/30 text-yellow-400 shrink-0"
                      disabled={pollerStatus === "running"}
                      onClick={async () => {
                        setPollerStatus("running");
                        try {
                          await apiFetch("api/admin/payments/run-poller", { method: "POST" });
                          setPollerStatus("done");
                          toast({ title: "Poller ran", description: "All pending crypto payments have been checked." });
                        } catch (e: any) {
                          setPollerStatus("error");
                          toast({ title: "Poller failed", description: e.message, variant: "destructive" });
                        }
                        setTimeout(() => setPollerStatus("idle"), 4000);
                      }}>
                      {pollerStatus === "running" ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <RotateCcw className="w-4 h-4 mr-2" />}
                      {pollerStatus === "done" ? "Done!" : pollerStatus === "error" ? "Failed" : "Run Poller"}
                    </Button>
                  </div>

                  {/* Force complete */}
                  <div className="p-5 space-y-3">
                    <div>
                      <p className="font-mono text-sm font-bold text-foreground">Force Complete Payment</p>
                      <p className="text-xs text-muted-foreground font-mono mt-0.5">Manually complete a specific payment by its ID. Activates the slot or credits balance immediately, no questions asked.</p>
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Payment UUID (from DB)"
                        value={forcePaymentId}
                        onChange={e => setForcePaymentId(e.target.value)}
                        className="flex-1 bg-background border border-white/10 text-foreground font-mono text-xs px-3 py-2 focus:outline-none focus:border-yellow-500/50"
                      />
                      <Button size="sm" variant="outline" className="border-yellow-500/30 text-yellow-400 shrink-0"
                        disabled={forceCompleteStatus === "running" || !forcePaymentId.trim()}
                        onClick={async () => {
                          setForceCompleteStatus("running");
                          setForceCompleteMsg("");
                          try {
                            const r = await apiFetch<{ message: string }>("api/admin/payments/force-complete", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ paymentId: forcePaymentId.trim() }),
                            });
                            setForceCompleteStatus("done");
                            setForceCompleteMsg(r.message);
                            setForcePaymentId("");
                          } catch (e: any) {
                            setForceCompleteStatus("error");
                            setForceCompleteMsg(e.message);
                          }
                          setTimeout(() => { setForceCompleteStatus("idle"); setForceCompleteMsg(""); }, 6000);
                        }}>
                        {forceCompleteStatus === "running" ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle className="w-4 h-4 mr-2" />}
                        Force Complete
                      </Button>
                    </div>
                    {forceCompleteMsg && (
                      <p className={`text-xs font-mono px-3 py-2 border ${forceCompleteStatus === "done" ? "text-green-400 bg-green-500/5 border-green-500/20" : "text-red-400 bg-red-500/5 border-red-500/20"}`}>
                        {forceCompleteMsg}
                      </p>
                    )}
                  </div>
                </div>
              </Card>
            )}

            {/* Dev tools */}
            <Card className="border-white/[0.06]">
              <div className="p-5 border-b border-white/[0.06]">
                <h2 className="font-semibold text-sm text-foreground">Developer Tools</h2>
              </div>
              <div className="divide-y divide-white/[0.04]">
                {/* Test script */}
                <div className="p-5 flex items-center justify-between gap-4">
                  <div>
                    <p className="font-mono text-sm font-bold text-foreground">Test Script</p>
                    <p className="text-xs text-muted-foreground font-mono mt-0.5">Generates a real Luarmor key for yourself that expires in 60 seconds.</p>
                  </div>
                  <Button size="sm" variant="outline" className="border-white/10 shrink-0" onClick={() => generateTestScript()} disabled={isGeneratingTestScript}>
                    {isGeneratingTestScript ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <FlaskConical className="w-4 h-4 mr-2" />}
                    Generate
                  </Button>
                </div>
                {testScriptResult && (
                  <div className="px-5 pb-5 space-y-3">
                    {!testScriptResult.luarmorConfigured && (
                      <p className="text-xs font-mono text-yellow-400 bg-yellow-500/5 border border-yellow-500/20 px-3 py-2">Luarmor not configured — no real key was generated.</p>
                    )}
                    {testScriptResult.scriptKey && (
                      <div>
                        <p className="text-[10px] font-mono text-muted-foreground mb-1.5 flex items-center gap-1"><Key className="w-3 h-3" />Script Key</p>
                        <div className="flex items-start gap-2 bg-secondary/40 border border-white/[0.06] p-3">
                          <p className="font-mono text-xs text-blue-300 break-all flex-1">{testScriptResult.scriptKey}</p>
                          <button onClick={async () => { await navigator.clipboard.writeText(testScriptResult.scriptKey!); setTestKeyCopied(true); setTimeout(() => setTestKeyCopied(false), 2000); }} className="shrink-0 text-muted-foreground hover:text-primary transition-colors">
                            {testKeyCopied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </div>
                    )}
                    {testScriptResult.script && (
                      <div>
                        <p className="text-[10px] font-mono text-muted-foreground mb-1.5 flex items-center gap-1"><Key className="w-3 h-3" />Loader Script</p>
                        <div className="flex items-start gap-2 bg-secondary/40 border border-white/[0.06] p-3">
                          <pre className="font-mono text-xs text-blue-300 break-all flex-1 whitespace-pre-wrap">{testScriptResult.script}</pre>
                          <button onClick={async () => { await navigator.clipboard.writeText(testScriptResult.script!); setTestScriptCopied(true); setTimeout(() => setTestScriptCopied(false), 2000); }} className="shrink-0 text-muted-foreground hover:text-primary transition-colors">
                            {testScriptCopied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </div>
                    )}
                    <p className="text-[10px] font-mono text-muted-foreground">Expires: {new Date(testScriptResult.expiresAt).toLocaleTimeString()}</p>
                    <Button size="sm" variant="ghost" className="text-muted-foreground text-xs" onClick={() => setTestScriptResult(null)}>Dismiss</Button>
                  </div>
                )}

                {/* Test DM */}
                <div className="p-5 flex items-center justify-between gap-4">
                  <div>
                    <p className="font-mono text-sm font-bold text-foreground">Test Discord DM</p>
                    <p className="text-xs text-muted-foreground font-mono mt-0.5">Sends a test DM to your own Discord account.</p>
                  </div>
                  <Button size="sm" variant="outline" className="border-white/10 shrink-0" disabled={testDmStatus === "sending"} onClick={async () => {
                    setTestDmStatus("sending");
                    try {
                      const res = await fetch(`${import.meta.env.BASE_URL}api/admin/test-dm`, { method: "POST", credentials: "include" });
                      setTestDmStatus(res.ok ? "sent" : "error");
                    } catch { setTestDmStatus("error"); }
                    setTimeout(() => setTestDmStatus("idle"), 4000);
                  }}>
                    {testDmStatus === "sending" ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <FlaskConical className="w-4 h-4 mr-2" />}
                    {testDmStatus === "sent" ? "Sent!" : testDmStatus === "error" ? "Failed" : "Send Test DM"}
                  </Button>
                </div>
              </div>
            </Card>

            {/* Server explorer */}
            <Card className="border-white/[0.06]">
              <div className="p-5 border-b border-white/[0.06] flex items-center justify-between">
                <h2 className="font-semibold text-sm text-foreground">Server Explorer</h2>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <input type="text" placeholder="Search…" value={serverSearch} onChange={e => setServerSearch(e.target.value)} className="bg-background border border-white/10 text-foreground font-mono pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:border-primary/50 w-44" />
                </div>
              </div>
              {isServersLoading ? (
                <div className="p-10 flex justify-center"><Loader2 className="w-6 h-6 text-primary animate-spin" /></div>
              ) : !filteredServers.length ? (
                <div className="p-10 text-center font-mono text-sm text-muted-foreground">{serverSearch ? "No servers match your search." : "No server data yet."}</div>
              ) : (
                <div className="divide-y divide-white/[0.04]">
                  {filteredServers.map(s => (
                    <div key={s.id} className="p-4 flex items-center gap-3">
                      {s.icon ? <img src={`https://cdn.discordapp.com/icons/${s.id}/${s.icon}.png?size=48`} alt="" className="w-9 h-9 rounded-full border border-white/10 shrink-0" /> : <div className="w-9 h-9 rounded-full bg-secondary border border-white/10 shrink-0 flex items-center justify-center"><Server className="w-4 h-4 text-muted-foreground" /></div>}
                      <div className="flex-1 min-w-0">
                        <p className="font-mono text-sm font-bold text-foreground truncate">{s.name}</p>
                        <p className="font-mono text-xs text-muted-foreground">{s.id}</p>
                      </div>
                      <span className="font-mono text-xs text-muted-foreground shrink-0">{s.userCount} users</span>
                      <Button size="sm" variant="outline" className="border-white/10 text-muted-foreground hover:text-primary text-xs shrink-0" onClick={() => copyServerId(s.id)}>
                        {copiedServerId === s.id ? <span className="text-green-400">Copied!</span> : <><Copy className="w-3 h-3 mr-1" />Copy ID</>}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Danger zone */}
            <Card className="border-red-500/20">
              <div className="p-5 border-b border-red-500/10 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-400" />
                <h2 className="font-semibold text-sm text-red-400">Danger Zone</h2>
              </div>
              <div className="divide-y divide-red-500/10">
                <div className="p-5 flex items-center justify-between gap-4">
                  <div>
                    <p className="font-mono text-sm font-bold text-foreground">Reset Leaderboard</p>
                    <p className="text-xs text-muted-foreground font-mono mt-0.5">Clears all completed payment records. Cannot be undone.</p>
                  </div>
                  {confirmResetLeaderboard ? (
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs font-mono text-red-400">Sure?</span>
                      <Button size="sm" className="bg-red-600 hover:bg-red-700 text-white border-none" onClick={() => resetLeaderboard()} disabled={isResettingLeaderboard}>
                        {isResettingLeaderboard ? <Loader2 className="w-3 h-3 animate-spin" /> : "Yes, Reset"}
                      </Button>
                      <Button size="sm" variant="outline" className="border-white/10" onClick={() => setConfirmResetLeaderboard(false)}>Cancel</Button>
                    </div>
                  ) : (
                    <Button size="sm" variant="outline" className="border-red-500/30 text-red-400 hover:bg-red-500/10 shrink-0" onClick={() => setConfirmResetLeaderboard(true)}>
                      <RotateCcw className="w-3.5 h-3.5 mr-1.5" />Reset
                    </Button>
                  )}
                </div>
                <div className="p-5 flex items-center justify-between gap-4">
                  <div>
                    <p className="font-mono text-sm font-bold text-foreground">Reset All Deposits</p>
                    <p className="text-xs text-muted-foreground font-mono mt-0.5">Permanently deletes every deposit record. Cannot be undone.</p>
                  </div>
                  {confirmResetDeposits ? (
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs font-mono text-red-400">Sure?</span>
                      <Button size="sm" className="bg-red-600 hover:bg-red-700 text-white border-none" onClick={() => resetAllDeposits()} disabled={isResettingDeposits}>
                        {isResettingDeposits ? <Loader2 className="w-3 h-3 animate-spin" /> : "Yes, Delete"}
                      </Button>
                      <Button size="sm" variant="outline" className="border-white/10" onClick={() => setConfirmResetDeposits(false)}>Cancel</Button>
                    </div>
                  ) : (
                    <Button size="sm" variant="outline" className="border-red-500/30 text-red-400 hover:bg-red-500/10 shrink-0" onClick={() => setConfirmResetDeposits(true)}>
                      <RotateCcw className="w-3.5 h-3.5 mr-1.5" />Reset
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}
