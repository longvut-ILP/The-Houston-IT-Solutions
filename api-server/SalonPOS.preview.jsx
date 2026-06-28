import { useState, useMemo, useEffect } from "react";
import {
  Calendar, ShoppingCart, LayoutDashboard, Settings, Scissors, Package,
  CreditCard, Banknote, AlertTriangle, CheckCircle2, Clock, UserPlus,
  Building2, DollarSign, FileSpreadsheet, Users, Coins, Download, RefreshCw,
  WifiOff, LogOut, Lock,
} from "lucide-react";

/* ===========================================================================
 * SalonPOS — STANDALONE PREVIEW (mock data, no backend).
 * Mirrors the real SalonPOS.jsx but replaces the API client with an in-memory
 * mock so the whole app is clickable here. Try logging in as the owner
 * (owner@polished.test) or a tech (mai@polished.test) — any password works.
 * =========================================================================== */

// ---- engine (matches src/lib/commissionEngine.ts) -------------------------
const applyBps = (c, bps) => Math.round((c * bps) / 10000);
const cardFee = (c, cfg) => (c <= 0 ? 0 : applyBps(c, cfg.ccFeePctBps) + cfg.ccFeeFixedCents);
function computeW2Ticket(t, tech, cfg) {
  const ccFeeOnService = cardFee(t.service, cfg);
  const productCost = applyBps(t.service, cfg.productCostPctBps);
  const netService = Math.max(0, t.service - ccFeeOnService - productCost);
  const serviceCommission = applyBps(netService, tech.serviceCommissionBps);
  const retailCommission = applyBps(t.retail, tech.retailCommissionBps);
  const commissionWages = serviceCommission + retailCommission;
  return { ccFeeOnService, productCost, netService, serviceCommission, retailCommission,
    commissionWages, cardTip: t.ccTip, cashTip: t.cashTip,
    techTakeHome: commissionWages + t.ccTip + t.cashTip };
}
function computeRenterPayout(t, cfg) {
  const routable = t.service + t.ccTip;
  const fee = cardFee(routable, cfg);
  return { instantPayout: Math.max(0, routable - fee), cardFee: fee, cashTip: t.cashTip, salonRetail: t.retail };
}
function computeFlsa({ commissionWagesCents, hoursWorked, minWageCentsPerHour }) {
  const minWageFloorCents = Math.round(hoursWorked * minWageCentsPerHour);
  const minWageTopUpCents = Math.max(0, minWageFloorCents - commissionWagesCents);
  const straight = commissionWagesCents + minWageTopUpCents;
  const overtimeHours = Math.max(0, hoursWorked - 40);
  const regularRateCentsPerHour = hoursWorked > 0 ? Math.round(straight / hoursWorked) : 0;
  const overtimePremiumCents = overtimeHours > 0 ? Math.round(0.5 * regularRateCentsPerHour * overtimeHours) : 0;
  return { minWageFloorCents, minWageTopUpCents, overtimeHours, regularRateCentsPerHour,
    overtimePremiumCents, grossPayCents: straight + overtimePremiumCents };
}
function poolTipsByHours(total, parts) {
  const totalHours = parts.reduce((s, p) => s + p.hours, 0);
  if (totalHours <= 0 || total <= 0) return parts.map((p) => ({ ...p, shareCents: 0 }));
  const raw = parts.map((p) => {
    const exact = (total * p.hours) / totalHours;
    const f = Math.floor(exact);
    return { ...p, f, rem: exact - f };
  });
  let left = total - raw.reduce((s, r) => s + r.f, 0);
  raw.sort((a, b) => b.rem - a.rem);
  for (let i = 0; i < raw.length && left > 0; i++, left--) raw[i].f += 1;
  return raw.map((r) => ({ ...r, shareCents: r.f }));
}
const fmt = (c) => { const s = c < 0 ? "-" : ""; const v = Math.abs(c || 0);
  return `${s}$${Math.floor(v / 100).toLocaleString()}.${String(v % 100).padStart(2, "0")}`; };
const pct = (bps) => `${(bps / 100).toFixed(bps % 100 ? 2 : 0)}%`;

// ---- mock API (in-memory) -------------------------------------------------
const isoAt = (h, m = 0) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.toISOString(); };
const mock = {
  settings: { ccFeePctBps: 290, ccFeeFixedCents: 30, productCostPctBps: 1000,
    minWageCentsPerHour: 1600, tipPoolingEnabled: false, timezone: "America/New_York" },
  techs: [
    { id: "t1", name: "Mai Tran", employmentType: "W2", serviceCommissionBps: 5000, retailCommissionBps: 1000, rentCents: null, rentCadence: null },
    { id: "t2", name: "Linda Pham", employmentType: "W2", serviceCommissionBps: 4500, retailCommissionBps: 1000, rentCents: null, rentCadence: null },
    { id: "t3", name: "Kevin Ng", employmentType: "1099", serviceCommissionBps: 0, retailCommissionBps: 0, rentCents: 25000, rentCadence: "WEEKLY" },
  ],
  weeklyHours: { t1: 38, t2: 44 },
  clock: { t1: { clockedIn: false, since: null, hoursToday: 7.5 },
           t2: { clockedIn: false, since: null, hoursToday: 6 } },
  appts: [
    { id: "a1", tech_id: "t1", client_label: "Walk-in", service_desc: "Gel Manicure", starts_at: isoAt(9), status: "DONE" },
    { id: "a2", tech_id: "t2", client_label: "Sara K.", service_desc: "Pedicure + Polish", starts_at: isoAt(10, 30), status: "DONE" },
    { id: "a3", tech_id: "t3", client_label: "Walk-in", service_desc: "Full Set Acrylic", starts_at: isoAt(12), status: "DONE" },
    { id: "a4", tech_id: "t1", client_label: "Jen L.", service_desc: "Dip Powder", starts_at: isoAt(13, 30), status: "IN_CHAIR" },
    { id: "a5", tech_id: "t2", client_label: "Booking", service_desc: "Gel Fill", starts_at: isoAt(15), status: "BOOKED" },
  ],
  tickets: [
    { id: "k1", techId: "t1", service: 6500, retail: 0, ccTip: 1300, cashTip: 0 },
    { id: "k2", techId: "t1", service: 4500, retail: 2400, ccTip: 900, cashTip: 0 },
    { id: "k3", techId: "t2", service: 8000, retail: 0, ccTip: 0, cashTip: 1500 },
    { id: "k4", techId: "t3", service: 9500, retail: 0, ccTip: 2000, cashTip: 0 },
  ],
  users: {
    "owner@polished.test": { id: "owner", name: "Owner Admin", role: "OWNER", salonId: "s1" },
    "mai@polished.test": { id: "t1", name: "Mai Tran", role: "TECH", salonId: "s1" },
    "linda@polished.test": { id: "t2", name: "Linda Pham", role: "TECH", salonId: "s1" },
  },
  user: null,
};
const wait = (v) => new Promise((r) => setTimeout(() => r(v), 120)); // tiny latency
const todayISOstr = () => new Date().toISOString().slice(0, 10);
function mondayISO() { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.toISOString().slice(0, 10); }

const api = {
  API_BASE: "mock://in-memory",
  getUser: () => mock.user,
  today: () => todayISOstr(),
  todayISO: () => todayISOstr(),
  weekStart: () => mondayISO(),
  workweekStart: () => mondayISO(),
  loadCalendar: async () => wait({ today: todayISOstr(), weekStart: mondayISO(), timezone: mock.settings.timezone }),
  async login(email) {
    const u = mock.users[email] || mock.users["owner@polished.test"];
    mock.user = u;
    return wait(u);
  },
  logout() { mock.user = null; },
  getSettings: async () => wait({ ...mock.settings }),
  getStaff: async () => wait(mock.techs.map((t) => ({ ...t }))),
  getAppointments: async () => wait(mock.appts.map((a) => ({ ...a }))),
  getTickets: async () => wait(mock.tickets.map((t) => ({ ...t }))),
  async getPayroll(start, techId) {
    const row = (t) => {
      const wages = mock.tickets.filter((k) => k.techId === t.id)
        .reduce((s, k) => s + computeW2Ticket(k, t, mock.settings).commissionWages, 0);
      const hoursWorked = mock.weeklyHours[t.id] || 0;
      return { techId: t.id, techName: t.name, hoursWorked, commissionWagesCents: wages,
        flsa: computeFlsa({ commissionWagesCents: wages, hoursWorked, minWageCentsPerHour: mock.settings.minWageCentsPerHour }) };
    };
    const w2 = mock.techs.filter((t) => t.employmentType === "W2");
    if (techId) { const t = w2.find((x) => x.id === techId); return wait(t ? row(t) : null); }
    return wait(w2.map(row));
  },
  async getTipPool() {
    const w2 = mock.techs.filter((t) => t.employmentType === "W2");
    const total = mock.tickets.filter((k) => w2.some((t) => t.id === k.techId)).reduce((s, k) => s + k.ccTip, 0);
    const parts = w2.filter((t) => (mock.clock[t.id]?.hoursToday || 0) > 0)
      .map((t) => ({ techId: t.id, techName: t.name, hours: mock.clock[t.id].hoursToday }));
    const shares = poolTipsByHours(total, parts);
    return wait({ totalCardTipsCents: total, shares });
  },
  async putSettings(config) { mock.settings = { ...mock.settings, ...config }; return wait({ ...mock.settings }); },
  async updateStaffComp(staffId, body) {
    const t = mock.techs.find((x) => x.id === staffId);
    if (t) {
      t.employmentType = body.employmentType;
      if (body.employmentType === "W2") { t.serviceCommissionBps = body.serviceCommissionBps; t.retailCommissionBps = body.retailCommissionBps; t.rentCents = null; }
      else { t.rentCents = body.rentAmountCents; t.rentCadence = body.rentCadence; t.serviceCommissionBps = 0; t.retailCommissionBps = 0; }
    }
    return wait(null);
  },
  async createAppointment(body) {
    const id = `a${Date.now()}`;
    mock.appts.push({ id, tech_id: body.techId, client_label: body.clientLabel || "Walk-in",
      service_desc: body.serviceDesc || "New service", starts_at: body.startsAt, status: "IN_CHAIR" });
    return wait({ id });
  },
  async checkout(payload) {
    const tech = mock.techs.find((t) => t.id === payload.techId);
    const service = (payload.lineItems || []).filter((l) => l.kind === "SERVICE").reduce((s, l) => s + l.amountCents, 0);
    const retail = (payload.lineItems || []).filter((l) => l.kind === "RETAIL").reduce((s, l) => s + l.amountCents, 0);
    const ccTip = (payload.tips || []).filter((t) => t.method === "CARD").reduce((s, t) => s + t.amountCents, 0);
    const cashTip = (payload.tips || []).filter((t) => t.method === "CASH").reduce((s, t) => s + t.amountCents, 0);
    mock.tickets.push({ id: `k${Date.now()}`, techId: payload.techId, service, retail, ccTip, cashTip });
    if (payload.appointmentId) { const a = mock.appts.find((x) => x.id === payload.appointmentId); if (a) a.status = "DONE"; }
    const isW2 = tech.employmentType === "W2";
    return wait({ path: isW2 ? "W2" : "1099", payoutStatus: isW2 ? undefined : "PAID" });
  },
  async clockStatus(techId) { return wait(mock.clock[techId] ? { ...mock.clock[techId] } : { clockedIn: false, since: null, hoursToday: 0 }); },
  async clockIn(techId) { mock.clock[techId] = { ...(mock.clock[techId] || { hoursToday: 0 }), clockedIn: true, since: new Date().toISOString() }; return wait({ ...mock.clock[techId] }); },
  async clockOut(techId) { const c = mock.clock[techId] || { hoursToday: 0 }; mock.clock[techId] = { ...c, clockedIn: false, since: null }; return wait({ ...mock.clock[techId] }); },
  async commitPayroll(start) { const lines = mock.techs.filter((t) => t.employmentType === "W2"); return wait({ lines, startsOn: start, endsOn: start }); },
  async commitTipPool() { const r = await this.getTipPool(); return { ...r, alreadyExisted: false, shares: r.shares }; },
};

// ---- shape adapters (same as production) ----------------------------------
const SLOTS = ["9:00", "9:30", "10:00", "10:30", "11:00", "11:30", "12:00", "12:30", "1:00", "1:30", "2:00", "2:30", "3:00", "3:30"];
const STATUS = {
  done: { tone: "green", label: "Checked out", icon: CheckCircle2, cell: "border-green-200 bg-green-50" },
  in_chair: { tone: "amber", label: "In chair", icon: Clock, cell: "border-amber-200 bg-amber-50" },
  booked: { tone: "blue", label: "Booked", icon: Calendar, cell: "border-blue-200 bg-blue-50" },
};
const ST = { BOOKED: "booked", IN_CHAIR: "in_chair", DONE: "done", CANCELLED: "cancelled", NO_SHOW: "no_show" };
const toSlot = (iso) => { const d = new Date(iso); const h = d.getHours(); const m = d.getMinutes() < 30 ? "00" : "30"; return `${h > 12 ? h - 12 : h}:${m}`; };
function slotToISO(slot) { const [hS, mS] = slot.split(":"); let h = parseInt(hS, 10); const m = parseInt(mS, 10); if (h >= 1 && h <= 8) h += 12; const d = new Date(); d.setHours(h, m, 0, 0); return d.toISOString(); }
const adaptAppt = (r) => ({ id: r.id, techId: r.tech_id, client: r.client_label || "Client",
  service: r.service_desc || "", status: ST[r.status] || "booked", time: toSlot(r.starts_at) });
const flsaView = (wp) => wp ? { hours: wp.hoursWorked, commission: wp.commissionWagesCents,
  floor: wp.flsa.minWageFloorCents, topUp: wp.flsa.minWageTopUpCents, otHours: wp.flsa.overtimeHours,
  otPremium: wp.flsa.overtimePremiumCents, rate: wp.flsa.regularRateCentsPerHour, gross: wp.flsa.grossPayCents } : null;

// ---- UI atoms -------------------------------------------------------------
const Card = ({ children, className = "" }) => <div className={`rounded-2xl border border-gray-200 bg-white shadow-sm ${className}`}>{children}</div>;
const Badge = ({ children, tone = "gray" }) => {
  const t = { gray: "bg-gray-100 text-gray-700", green: "bg-green-100 text-green-700", blue: "bg-blue-100 text-blue-700", amber: "bg-amber-100 text-amber-800", purple: "bg-purple-100 text-purple-700" };
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${t[tone]}`}>{children}</span>;
};
const Row = ({ label, value, strong, tone }) => (
  <div className="flex items-center justify-between py-1.5">
    <span className={`text-sm ${strong ? "font-semibold text-gray-900" : "text-gray-500"}`}>{label}</span>
    <span className={`text-sm tabular-nums ${strong ? "font-bold" : ""} ${tone === "neg" ? "text-rose-600" : tone === "pos" ? "text-emerald-600" : "text-gray-900"}`}>{value}</span>
  </div>
);
const MoneyInput = ({ label, icon: Icon, value, set }) => (
  <label className="block">
    <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-gray-500"><Icon size={13} /> {label}</span>
    <div className="flex items-center rounded-xl border border-gray-200 px-3 py-2">
      <span className="text-gray-400">$</span>
      <input type="number" min="0" step="0.01" value={(value / 100).toString()}
        onChange={(e) => set(Math.round(parseFloat(e.target.value || "0") * 100))} className="w-full bg-transparent pl-1 text-sm outline-none" />
    </div>
  </label>
);
const CfgNum = ({ label, value, onChange, suffix, step = "1" }) => (
  <label className="block">
    <span className="mb-1 block text-xs font-medium text-gray-500">{label}</span>
    <div className="flex items-center rounded-xl border border-gray-200 px-3 py-2">
      <input type="number" step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value || "0"))} className="w-full bg-transparent text-sm outline-none" />
      {suffix && <span className="text-xs text-gray-400">{suffix}</span>}
    </div>
  </label>
);

// ---- Login ----------------------------------------------------------------
function Login({ onLogin }) {
  const [email, setEmail] = useState("owner@polished.test");
  const [password, setPassword] = useState("demo");
  const [busy, setBusy] = useState(false);
  const submit = async (e) => { e.preventDefault(); setBusy(true); try { await onLogin(email, password); } finally { setBusy(false); } };
  return (
    <div className="flex min-h-[600px] items-center justify-center bg-gray-50 px-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-600 text-white"><Scissors size={18} /></div>
          <div><div className="text-sm font-bold leading-tight">Polished POS</div><div className="text-xs text-gray-500 leading-tight">Sign in (demo)</div></div>
        </div>
        <label className="mb-3 block"><span className="mb-1 block text-xs font-medium text-gray-500">Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none" /></label>
        <label className="mb-4 block"><span className="mb-1 block text-xs font-medium text-gray-500">Password</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none" /></label>
        <button type="submit" disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-purple-600 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
          <Lock size={15} /> {busy ? "Signing in…" : "Sign in"}
        </button>
        <p className="mt-3 text-center text-xs text-gray-400">Try <b>owner@polished.test</b> (full access) or <b>mai@polished.test</b> (tech). Any password.</p>
      </form>
    </div>
  );
}

// ===========================================================================
export default function SalonPOSPreview() {
  const [user, setUser] = useState(null);
  const [tab, setTab] = useState("schedule");
  const [config, setConfig] = useState(null);
  const [techs, setTechs] = useState([]);
  const [appts, setAppts] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [pending, setPending] = useState(null);
  const [loading, setLoading] = useState(false);

  const loadAll = async () => {
    setLoading(true);
    await api.loadCalendar();
    const [cfg, staff, apptRows, tks] = await Promise.all([api.getSettings(), api.getStaff(), api.getAppointments(), api.getTickets()]);
    setConfig(cfg); setTechs(staff);
    setAppts(apptRows.map(adaptAppt).filter((a) => ["booked", "in_chair", "done"].includes(a.status)));
    setTickets(tks); setLoading(false);
  };
  useEffect(() => { if (user) loadAll(); }, [user]); // eslint-disable-line

  const handleLogin = async (email, password) => { setUser(await api.login(email, password)); };
  const handleLogout = () => { api.logout(); setUser(null); setConfig(null); setTechs([]); setAppts([]); setTickets([]); setTab("schedule"); };
  const refreshTickets = async () => setTickets(await api.getTickets());
  const refreshAppts = async () => setAppts((await api.getAppointments()).map(adaptAppt).filter((a) => ["booked", "in_chair", "done"].includes(a.status)));
  const goCheckout = (appt) => { setPending(appt); setTab("checkout"); };
  const handleCheckout = async (payload) => { const r = await api.checkout(payload); await Promise.all([refreshTickets(), refreshAppts()]); return r; };
  const handleAddWalkIn = async (techId) => {
    const taken = new Set(appts.filter((a) => a.techId === techId).map((a) => a.time));
    const slot = SLOTS.find((s) => !taken.has(s)) || SLOTS[SLOTS.length - 1];
    await api.createAppointment({ techId, clientLabel: "Walk-in", serviceDesc: "New service", startsAt: slotToISO(slot) });
    await refreshAppts();
  };
  const handleSaveSettings = async (cfg) => setConfig(await api.putSettings(cfg));
  const handleSaveComp = async (id, body) => { await api.updateStaffComp(id, body); setTechs(await api.getStaff()); };

  const isManager = user && (user.role === "OWNER" || user.role === "ADMIN");
  const tabs = [
    { id: "schedule", label: "Turns", icon: Calendar },
    { id: "checkout", label: "Checkout", icon: ShoppingCart },
    { id: "dashboard", label: "Tech Dashboard", icon: LayoutDashboard },
    ...(isManager ? [{ id: "owner", label: "Owner", icon: DollarSign }, { id: "admin", label: "Admin Config", icon: Settings }] : []),
  ];

  if (!user) return <Login onLogin={handleLogin} />;

  return (
    <div className="min-h-[600px] bg-gray-50 text-gray-900">
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-600 text-white"><Scissors size={18} /></div>
          <div><div className="text-sm font-bold leading-tight">Polished POS</div><div className="text-xs text-gray-500 leading-tight">Salon &amp; Commission Manager</div></div>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone="purple">Preview</Badge>
          <span className="hidden text-xs text-gray-500 sm:inline">{user.name} · {user.role}</span>
          <button onClick={loadAll} className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600"><RefreshCw size={13} /> Refresh</button>
          <button onClick={handleLogout} className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600"><LogOut size={13} /> Sign out</button>
        </div>
      </header>
      <nav className="flex gap-1 border-b border-gray-200 bg-white px-4">
        {tabs.map((t) => { const Icon = t.icon; const active = tab === t.id; return (
          <button key={t.id} onClick={() => setTab(t.id)} className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium ${active ? "border-purple-600 text-purple-700" : "border-transparent text-gray-500"}`}><Icon size={16} /> {t.label}</button>
        ); })}
      </nav>
      <main className="mx-auto max-w-6xl p-6">
        {loading && <div className="flex items-center justify-center gap-2 py-20 text-gray-400"><RefreshCw size={18} className="animate-spin" /> Loading…</div>}
        {!loading && config && techs.length > 0 && (
          <>
            {tab === "schedule" && <Schedule techs={techs} appts={appts} onAddWalkIn={handleAddWalkIn} onCheckout={goCheckout} />}
            {tab === "checkout" && <Checkout techs={techs} config={config} user={user} pending={pending} clearPending={() => setPending(null)} onComplete={handleCheckout} />}
            {tab === "dashboard" && <Dashboard techs={techs} config={config} tickets={tickets} user={user} />}
            {tab === "owner" && <Owner techs={techs} config={config} tickets={tickets} />}
            {tab === "admin" && <Admin config={config} techs={techs} onSaveSettings={handleSaveSettings} onSaveComp={handleSaveComp} />}
          </>
        )}
      </main>
    </div>
  );
}

// ---- Schedule -------------------------------------------------------------
function Schedule({ techs, appts, onAddWalkIn, onCheckout }) {
  const [walkTech, setWalkTech] = useState(techs[0].id);
  const [busy, setBusy] = useState(false);
  const add = async () => { setBusy(true); try { await onAddWalkIn(walkTech); } finally { setBusy(false); } };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h2 className="text-lg font-bold">Today's Turns</h2><p className="text-sm text-gray-500">Each booking links to a tech so commission tracks automatically at checkout.</p></div>
        <div className="flex items-center gap-2">
          <select value={walkTech} onChange={(e) => setWalkTech(e.target.value)} className="rounded-xl border border-gray-200 px-2 py-2 text-sm">{techs.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
          <button onClick={add} disabled={busy} className="flex items-center gap-2 rounded-xl bg-purple-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"><UserPlus size={16} /> Add walk-in</button>
        </div>
      </div>
      <Card className="overflow-hidden"><div className="overflow-x-auto"><div className="min-w-[640px]">
        <div className="grid border-b border-gray-200 bg-gray-50" style={{ gridTemplateColumns: `64px repeat(${techs.length}, 1fr)` }}>
          <div className="px-2 py-2 text-xs font-medium text-gray-400">Time</div>
          {techs.map((t) => <div key={t.id} className="border-l border-gray-200 px-3 py-2"><div className="text-sm font-semibold">{t.name}</div><Badge tone={t.employmentType === "W2" ? "blue" : "purple"}>{t.employmentType === "W2" ? "W-2" : "1099"}</Badge></div>)}
        </div>
        {SLOTS.map((slot) => (
          <div key={slot} className="grid border-b border-gray-100" style={{ gridTemplateColumns: `64px repeat(${techs.length}, 1fr)` }}>
            <div className="px-2 py-2 text-xs text-gray-400">{slot}</div>
            {techs.map((t) => { const appt = appts.find((a) => a.techId === t.id && a.time === slot); const s = appt ? STATUS[appt.status] : null; const Icon = s?.icon; return (
              <div key={t.id} className="border-l border-gray-100 p-1">{appt && s ? (
                <div className={`h-full rounded-lg border p-2 ${s.cell}`}>
                  <div className="flex items-center justify-between"><span className="text-xs font-semibold">{appt.client}</span><Icon size={12} className="text-gray-500" /></div>
                  <div className="text-[11px] text-gray-500">{appt.service}</div>
                  {appt.status !== "done" && <button onClick={() => onCheckout(appt)} className="mt-1 w-full rounded-md bg-white/70 py-1 text-[11px] font-medium text-purple-700 ring-1 ring-purple-200">Check out →</button>}
                </div>) : null}</div>
            ); })}
          </div>
        ))}
      </div></div></Card>
      <div className="flex flex-wrap gap-3 text-xs text-gray-500">{Object.values(STATUS).map((s) => <span key={s.label} className="flex items-center gap-1.5"><span className={`h-3 w-3 rounded border ${s.cell}`} />{s.label}</span>)}</div>
    </div>
  );
}

// ---- Checkout -------------------------------------------------------------
function Checkout({ techs, config, user, pending, clearPending, onComplete }) {
  const isTech = user?.role === "TECH";
  const [techId, setTechId] = useState(pending?.techId || (isTech ? user.id : techs[0].id));
  const [service, setService] = useState(8000);
  const [retail, setRetail] = useState(2000);
  const [ccTip, setCcTip] = useState(1500);
  const [cashTip, setCashTip] = useState(0);
  const [done, setDone] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (pending?.techId) setTechId(pending.techId); }, [pending]);
  const tech = techs.find((t) => t.id === techId) || techs[0];
  const ticket = { service, retail, ccTip, cashTip };
  const isW2 = tech.employmentType === "W2";
  const w2 = useMemo(() => computeW2Ticket(ticket, tech, config), [service, retail, ccTip, cashTip, tech, config]);
  const renter = useMemo(() => computeRenterPayout(ticket, config), [service, retail, ccTip, cashTip, config]);
  const ticketTotal = service + retail + ccTip;
  const complete = async () => {
    setBusy(true);
    try {
      const lineItems = []; if (service > 0) lineItems.push({ kind: "SERVICE", amountCents: service }); if (retail > 0) lineItems.push({ kind: "RETAIL", amountCents: retail });
      const tips = []; if (ccTip > 0) tips.push({ method: "CARD", amountCents: ccTip }); if (cashTip > 0) tips.push({ method: "CASH", amountCents: cashTip });
      await onComplete({ techId, appointmentId: pending?.id ?? null, lineItems, tips });
      setDone({ name: tech.name, isW2, amount: isW2 ? w2.techTakeHome : renter.instantPayout });
      clearPending(); setService(0); setRetail(0); setCcTip(0); setCashTip(0);
    } finally { setBusy(false); }
  };
  return (
    <div className="space-y-4">
      {done && <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3"><span className="flex items-center gap-2 text-sm font-medium text-emerald-800"><CheckCircle2 size={16} /> Sale recorded for {done.name} — {done.isW2 ? "commission" : "instant payout"} {fmt(done.amount)}. It now shows on the dashboards.</span><button onClick={() => setDone(null)} className="text-xs font-medium text-emerald-700">Dismiss</button></div>}
      {pending && <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-800">Checking out <span className="font-semibold">{pending.client}</span> · {pending.service}</div>}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-4 text-lg font-bold">Ticket</h2>
          <label className="mb-4 block"><span className="mb-1 block text-xs font-medium text-gray-500">Assigned tech</span>
            <select value={techId} onChange={(e) => setTechId(e.target.value)} disabled={isTech} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-500">
              {(isTech ? techs.filter((t) => t.id === user.id) : techs).map((t) => <option key={t.id} value={t.id}>{t.name} ({t.employmentType === "W2" ? "W-2" : "1099"})</option>)}
            </select></label>
          <div className="grid grid-cols-2 gap-3">
            <MoneyInput label="Service" icon={Scissors} value={service} set={setService} />
            <MoneyInput label="Retail" icon={Package} value={retail} set={setRetail} />
            <MoneyInput label="Card tip" icon={CreditCard} value={ccTip} set={setCcTip} />
            <MoneyInput label="Cash tip" icon={Banknote} value={cashTip} set={setCashTip} />
          </div>
          <div className="mt-4 rounded-xl bg-gray-50 p-3"><Row label="Ticket charged to card" value={fmt(ticketTotal)} strong /><p className="mt-1 text-xs text-gray-400">Cash tip ({fmt(cashTip)}) handed directly to tech — not on the card.</p></div>
        </Card>
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-bold">{isW2 ? "Commission Breakdown" : "Instant Payout"}</h2><Badge tone={isW2 ? "blue" : "purple"}>{isW2 ? "W-2 path" : "1099 path"}</Badge></div>
          {isW2 ? (
            <div>
              <Row label="Gross service" value={fmt(service)} />
              <Row label={`Card fee (${pct(config.ccFeePctBps)} + ${fmt(config.ccFeeFixedCents)})`} value={`- ${fmt(w2.ccFeeOnService)}`} tone="neg" />
              <Row label={`Product cost (${pct(config.productCostPctBps)})`} value={`- ${fmt(w2.productCost)}`} tone="neg" />
              <div className="my-1 border-t border-dashed border-gray-200" />
              <Row label="Net service revenue" value={fmt(w2.netService)} strong />
              <Row label={`Service commission (${pct(tech.serviceCommissionBps)})`} value={fmt(w2.serviceCommission)} tone="pos" />
              <Row label={`Retail commission (${pct(tech.retailCommissionBps)})`} value={fmt(w2.retailCommission)} tone="pos" />
              <Row label="Card tip (100% to tech)" value={fmt(w2.cardTip)} tone="pos" />
              <Row label="Cash tip" value={fmt(w2.cashTip)} tone="pos" />
              <div className="my-1 border-t border-gray-200" />
              <Row label="Tech earns this ticket" value={fmt(w2.techTakeHome)} strong />
              <div className="mt-4 flex items-start gap-2 rounded-xl bg-blue-50 p-3 text-xs text-blue-800"><AlertTriangle size={14} className="mt-0.5 shrink-0" /><span>Commission accrues to payroll. Final pay is re-checked against the minimum-wage floor &amp; overtime each workweek.</span></div>
            </div>
          ) : (
            <div>
              <Row label="Gross service" value={fmt(service)} /><Row label="Card tip" value={fmt(ccTip)} />
              <Row label="Card processing fee" value={`- ${fmt(renter.cardFee)}`} tone="neg" />
              <div className="my-1 border-t border-gray-200" />
              <Row label="Instant payout → contractor bank" value={fmt(renter.instantPayout)} strong tone="pos" />
              <Row label="Cash tip (already with tech)" value={fmt(renter.cashTip)} /><Row label="Retail → salon" value={fmt(renter.salonRetail)} />
              <div className="mt-4 flex items-start gap-2 rounded-xl bg-purple-50 p-3 text-xs text-purple-800"><AlertTriangle size={14} className="mt-0.5 shrink-0" /><span>No commission split — booth renter keeps gross service. Salon earns via chair rent, billed separately.</span></div>
            </div>
          )}
          <button onClick={complete} disabled={busy || service + retail === 0} className="mt-4 w-full rounded-xl bg-purple-600 py-2.5 text-sm font-semibold text-white disabled:opacity-40">{busy ? "Processing…" : isW2 ? "Complete sale & record commission" : "Complete sale & send instant payout"}</button>
        </Card>
      </div>
    </div>
  );
}

// ---- Dashboard ------------------------------------------------------------
function Dashboard({ techs, config, tickets, user }) {
  const isTech = user?.role === "TECH";
  const visibleTechs = isTech ? techs.filter((t) => t.id === user.id) : techs;
  const [techId, setTechId] = useState(isTech ? user.id : techs[0].id);
  const [pay, setPay] = useState(null);
  const [clk, setClk] = useState(null);
  const [clkBusy, setClkBusy] = useState(false);
  const tech = techs.find((t) => t.id === techId) || techs[0];
  const isW2 = tech.employmentType === "W2";
  const myTickets = tickets.filter((t) => t.techId === techId);
  useEffect(() => { let on = true; setPay(null); setClk(null);
    if (isW2) { api.getPayroll(api.weekStart(), techId).then((p) => on && setPay(p)); api.clockStatus(techId).then((s) => on && setClk(s)); }
    return () => { on = false; }; }, [techId, isW2]);
  const doClock = async (d) => { setClkBusy(true); try { setClk(d === "in" ? await api.clockIn(techId) : await api.clockOut(techId)); } finally { setClkBusy(false); } };
  const totals = myTickets.reduce((a, t) => {
    if (isW2) { const b = computeW2Ticket(t, tech, config); a.service += b.serviceCommission; a.retail += b.retailCommission; }
    else { a.service += computeRenterPayout(t, config).instantPayout; }
    a.ccTip += t.ccTip; a.cashTip += t.cashTip; return a;
  }, { service: 0, retail: 0, ccTip: 0, cashTip: 0 });
  const tips = totals.ccTip + totals.cashTip; const earned = totals.service + totals.retail + tips; const f = flsaView(pay);
  const Stat = ({ label, value, sub, tone = "gray" }) => <Card className="p-4"><div className="text-xs font-medium text-gray-500">{label}</div><div className={`mt-1 text-2xl font-bold tabular-nums ${tone === "pos" ? "text-emerald-600" : ""}`}>{value}</div>{sub && <div className="mt-0.5 text-xs text-gray-400">{sub}</div>}</Card>;
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div><h2 className="text-lg font-bold">Tech Dashboard</h2><p className="text-sm text-gray-500">Real-time daily earnings — keeps the end-of-week paycheck honest.</p></div>
        <select value={techId} onChange={(e) => setTechId(e.target.value)} disabled={isTech} className="rounded-xl border border-gray-200 px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-500">{visibleTechs.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
      </div>
      {isW2 && <Card className="p-4"><div className="flex items-center justify-between">
        <div className="flex items-center gap-2"><Clock size={16} className={clk?.clockedIn ? "text-emerald-600" : "text-gray-400"} />
          <div><div className="text-sm font-semibold">{clk?.clockedIn ? "Clocked in" : "Clocked out"}</div><div className="text-xs text-gray-400">{clk ? `${clk.hoursToday.toFixed(2)} h today${clk.since ? ` · since ${new Date(clk.since).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}` : "—"}</div></div></div>
        {clk?.clockedIn ? <button onClick={() => doClock("out")} disabled={clkBusy} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 disabled:opacity-50">{clkBusy ? "…" : "Clock out"}</button> : <button onClick={() => doClock("in")} disabled={clkBusy} className="rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">{clkBusy ? "…" : "Clock in"}</button>}
      </div></Card>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Earned today" value={fmt(earned)} tone="pos" sub={`${myTickets.length} tickets`} />
        <Stat label={isW2 ? "Service commission" : "Service payout"} value={fmt(totals.service)} />
        <Stat label="Retail commission" value={fmt(totals.retail)} sub={isW2 ? "" : "n/a for 1099"} />
        <Stat label="Tips (card + cash)" value={fmt(tips)} sub={`${fmt(totals.ccTip)} card · ${fmt(totals.cashTip)} cash`} />
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card className="p-5"><h3 className="mb-3 font-semibold">Service vs Retail</h3><SplitBar service={totals.service} retail={totals.retail} /><Row label="Service" value={fmt(totals.service)} /><Row label="Retail" value={fmt(totals.retail)} /><Row label="Tips" value={fmt(tips)} /></Card>
        {isW2 ? (
          <Card className="p-5">
            <div className="mb-3 flex items-center gap-2"><h3 className="font-semibold">Weekly FLSA check</h3>{f && <Badge tone={f.topUp > 0 ? "amber" : "green"}>{f.topUp > 0 ? "Floor applied" : "Above floor"}</Badge>}</div>
            {f ? (<>
              <Row label="Hours this week" value={`${f.hours.toFixed(1)} h`} /><Row label="Commission wages" value={fmt(f.commission)} />
              <Row label={`Min-wage floor (${fmt(config.minWageCentsPerHour)}/h)`} value={fmt(f.floor)} />
              {f.topUp > 0 && <Row label="Min-wage top-up" value={`+ ${fmt(f.topUp)}`} tone="pos" />}
              {f.otHours > 0 && <Row label={`Overtime premium (${f.otHours.toFixed(1)} h @ ½ rate)`} value={`+ ${fmt(f.otPremium)}`} tone="pos" />}
              <div className="my-1 border-t border-gray-200" /><Row label="Projected weekly gross" value={fmt(f.gross)} strong />
              <p className="mt-2 text-xs text-gray-400">Regular rate {fmt(f.rate)}/h. From the payroll endpoint (commission records + time entries).</p>
            </>) : <p className="text-sm text-gray-400">Loading payroll…</p>}
          </Card>
        ) : (
          <Card className="p-5"><div className="mb-3 flex items-center gap-2"><Building2 size={16} /><h3 className="font-semibold">Booth rent</h3></div>
            <Row label="Chair rent" value={`${fmt(tech.rentCents || 0)} / ${(tech.rentCadence || "WEEKLY").toLowerCase()}`} /><Row label="Next charge" value="Mon, auto-debit" />
            <div className="my-1 border-t border-gray-200" /><Row label="Service payouts go to" value="Connected bank (instant)" /><p className="mt-2 text-xs text-gray-400">No hours tracked for wage purposes — 1099 contractor.</p></Card>
        )}
      </div>
    </div>
  );
}
function SplitBar({ service, retail }) { const total = Math.max(1, service + retail); const sPct = (service / total) * 100; return <div className="mb-3 flex h-3 overflow-hidden rounded-full bg-gray-100"><div className="bg-purple-500" style={{ width: `${sPct}%` }} /><div className="bg-pink-400" style={{ width: `${100 - sPct}%` }} /></div>; }

// ---- Owner ----------------------------------------------------------------
function Owner({ techs, config, tickets }) {
  const [payroll, setPayroll] = useState([]);
  const [pool, setPool] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.getPayroll(api.weekStart()).then((d) => setPayroll(Array.isArray(d) ? d : [d])); api.getTipPool(api.today()).then(setPool); }, []);
  const streams = tickets.reduce((a, t) => { a.grossService += t.service; a.retail += t.retail; a.cardTip += t.ccTip; a.cashTip += t.cashTip; return a; }, { grossService: 0, retail: 0, cardTip: 0, cashTip: 0 });
  const payRows = payroll.map((wp) => ({ name: wp.techName, ...flsaView(wp) }));
  const payrollTotal = payRows.reduce((s, r) => s + (r?.gross || 0), 0);
  const rentRows = techs.filter((t) => t.employmentType === "1099").map((t) => ({ tech: t, payout: tickets.filter((k) => k.techId === t.id).reduce((s, k) => s + computeRenterPayout(k, config).instantPayout, 0) }));
  const commitPayroll = async () => { setBusy(true); setMsg(null); try { const r = await api.commitPayroll(api.weekStart()); setMsg(`Payroll committed — ${r.lines.length} line(s), period locked.`); } finally { setBusy(false); } };
  const finalizePool = async () => { setBusy(true); setMsg(null); try { const r = await api.commitTipPool(api.today()); setMsg(`Tip pool finalized — ${r.shares.length} share(s) written.`); } finally { setBusy(false); } };
  const exportCsv = () => {
    const usd = (c) => (c / 100).toFixed(2);
    const head = ["Employee", "Hours", "Commission", "MinWageTopUp", "OvertimePremium", "GrossPay"];
    const lines = payRows.map((r) => [r.name, r.hours.toFixed(2), usd(r.commission), usd(r.topUp), usd(r.otPremium), usd(r.gross)].join(","));
    const blob = new Blob([[head.join(","), ...lines].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `payroll_${api.weekStart()}.csv`; a.click(); URL.revokeObjectURL(url);
  };
  const StreamCard = ({ icon: Icon, label, value, tone, note }) => <Card className="p-4"><div className="flex items-center gap-2 text-xs font-medium text-gray-500"><Icon size={14} className={tone} /> {label}</div><div className="mt-1 text-2xl font-bold tabular-nums">{fmt(value)}</div>{note && <div className="mt-0.5 text-xs text-gray-400">{note}</div>}</Card>;
  return (
    <div className="space-y-5">
      <div><h2 className="text-lg font-bold">Owner — Revenue &amp; Payroll</h2><p className="text-sm text-gray-500">Revenue streams are tracked separately to protect margin and keep payroll/1099 reporting clean.</p></div>
      {msg && <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-2 text-sm text-gray-600">{msg}</div>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StreamCard icon={Scissors} label="Gross service revenue" value={streams.grossService} tone="text-purple-500" note="Labor" />
        <StreamCard icon={Package} label="Retail revenue" value={streams.retail} tone="text-pink-500" note="Product sales" />
        <StreamCard icon={CreditCard} label="Card tips" value={streams.cardTip} tone="text-blue-500" note="Via gateway" />
        <StreamCard icon={Banknote} label="Cash tips" value={streams.cashTip} tone="text-emerald-500" note="Reported only" />
      </div>
      <Card className="p-5">
        <div className="mb-3 flex items-center justify-between"><div className="flex items-center gap-2"><FileSpreadsheet size={16} /><h3 className="font-semibold">W-2 payroll export (this week)</h3></div>
          <div className="flex items-center gap-2"><button onClick={commitPayroll} disabled={busy} className="rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">{busy ? "Working…" : "Generate & lock payroll"}</button>
            <button onClick={exportCsv} disabled={payRows.length === 0} className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 disabled:opacity-50"><Download size={13} /> Export CSV</button></div></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-sm">
          <thead><tr className="border-b border-gray-200 text-left text-xs text-gray-400"><th className="py-2 font-medium">Employee</th><th className="py-2 text-right font-medium">Hours</th><th className="py-2 text-right font-medium">Commission</th><th className="py-2 text-right font-medium">Min-wage top-up</th><th className="py-2 text-right font-medium">OT premium</th><th className="py-2 text-right font-medium">Gross pay</th></tr></thead>
          <tbody>
            {payRows.map((r) => <tr key={r.name} className="border-b border-gray-100"><td className="py-2 font-medium">{r.name}</td><td className="py-2 text-right tabular-nums">{r.hours.toFixed(1)}</td><td className="py-2 text-right tabular-nums">{fmt(r.commission)}</td><td className={`py-2 text-right tabular-nums ${r.topUp > 0 ? "text-amber-600" : "text-gray-400"}`}>{r.topUp > 0 ? `+ ${fmt(r.topUp)}` : "—"}</td><td className={`py-2 text-right tabular-nums ${r.otPremium > 0 ? "text-emerald-600" : "text-gray-400"}`}>{r.otPremium > 0 ? `+ ${fmt(r.otPremium)}` : "—"}</td><td className="py-2 text-right font-bold tabular-nums">{fmt(r.gross)}</td></tr>)}
            <tr><td className="py-2 font-semibold" colSpan={5}>Total payroll liability</td><td className="py-2 text-right font-bold tabular-nums">{fmt(payrollTotal)}</td></tr>
          </tbody>
        </table></div>
        <p className="mt-2 text-xs text-gray-400">Held in the salon merchant account; this file goes to your payroll provider. Not paid as instant payout.</p>
      </Card>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card className="p-5"><div className="mb-3 flex items-center gap-2"><Building2 size={16} /><h3 className="font-semibold">1099 contractors</h3></div>
          {rentRows.map((r) => <div key={r.tech.id} className="border-b border-gray-100 py-2 last:border-0"><div className="flex items-center justify-between"><span className="text-sm font-medium">{r.tech.name}</span><Badge tone="purple">1099</Badge></div><Row label="Instant payouts sent" value={fmt(r.payout)} tone="pos" /><Row label="Chair rent owed" value={`${fmt(r.tech.rentCents || 0)} / ${(r.tech.rentCadence || "WEEKLY").toLowerCase()}`} /></div>)}
          <p className="mt-2 text-xs text-gray-400">Rent billed via recurring charge; service revenue already routed to their bank.</p></Card>
        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between"><div className="flex items-center gap-2"><Coins size={16} /><h3 className="font-semibold">Tip pool (today)</h3></div>
            <div className="flex items-center gap-2">{config.tipPoolingEnabled && <button onClick={finalizePool} disabled={busy} className="rounded-lg bg-purple-600 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50">Finalize</button>}<Badge tone={config.tipPoolingEnabled ? "green" : "gray"}>{config.tipPoolingEnabled ? "Pooling ON" : "Pooling OFF"}</Badge></div></div>
          {config.tipPoolingEnabled ? (<>
            <Row label="W-2 card tips pooled" value={fmt(pool?.totalCardTipsCents || 0)} strong /><div className="my-1 border-t border-dashed border-gray-200" />
            {(pool?.shares || []).map((p) => <Row key={p.techId} label={`${p.techName} · ${p.hours}h`} value={fmt(p.shareCents)} tone="pos" />)}
            <p className="mt-2 text-xs text-gray-400">Split by hours, largest-remainder so shares sum exactly. 1099 contractors &amp; owners excluded by law.</p>
          </>) : (<><p className="text-sm text-gray-500">Direct tips: 100% of each card tip stays with the tech who did the service.</p>
            <div className="mt-2 flex items-start gap-2 rounded-xl bg-gray-50 p-3 text-xs text-gray-500"><Users size={14} className="mt-0.5 shrink-0" /><span>Turn on tip pooling in Admin Config to split daily card tips across W-2 staff by hours.</span></div></>)}
        </Card>
      </div>
    </div>
  );
}

// ---- Admin ----------------------------------------------------------------
function Admin({ config, techs, onSaveSettings, onSaveComp }) {
  const [cfg, setCfg] = useState(config);
  const [savingCfg, setSavingCfg] = useState(false);
  const [draft, setDraft] = useState({});
  const [savingId, setSavingId] = useState(null);
  const [msg, setMsg] = useState(null);
  useEffect(() => setCfg(config), [config]);
  const setField = (k, v) => setCfg((c) => ({ ...c, [k]: v }));
  const saveSettings = async () => { setSavingCfg(true); setMsg(null); try { await onSaveSettings(cfg); setMsg("Settings saved."); } finally { setSavingCfg(false); } };
  const draftFor = (t) => ({ employmentType: t.employmentType, serviceCommissionBps: t.serviceCommissionBps, retailCommissionBps: t.retailCommissionBps, rentCents: t.rentCents, rentCadence: t.rentCadence || "WEEKLY", ...(draft[t.id] || {}) });
  const setDraftField = (id, patch) => setDraft((d) => ({ ...d, [id]: { ...(d[id] || {}), ...patch } }));
  const saveComp = async (t) => {
    const d = draftFor(t);
    const body = d.employmentType === "W2" ? { employmentType: "W2", serviceCommissionBps: d.serviceCommissionBps ?? 0, retailCommissionBps: d.retailCommissionBps ?? 0 } : { employmentType: "1099", rentAmountCents: d.rentCents ?? 0, rentCadence: (d.rentCadence || "WEEKLY").toUpperCase() };
    setSavingId(t.id); setMsg(null); try { await onSaveComp(t.id, body); setDraft((dd) => { const n = { ...dd }; delete n[t.id]; return n; }); setMsg(`${t.name} updated.`); } finally { setSavingId(null); }
  };
  const ZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Phoenix", "America/Anchorage", "Pacific/Honolulu"];
  return (
    <div className="space-y-5">
      {msg && <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-2 text-sm text-gray-600">{msg}</div>}
      <Card className="p-5">
        <div className="mb-4 flex items-center justify-between"><div><h2 className="text-lg font-bold">Salon settings</h2><p className="text-sm text-gray-500">Overhead and compliance defaults applied across checkout.</p></div>
          <button onClick={saveSettings} disabled={savingCfg} className="rounded-xl bg-purple-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{savingCfg ? "Saving…" : "Save settings"}</button></div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <CfgNum label="Card fee %" value={cfg.ccFeePctBps / 100} suffix="%" step="0.01" onChange={(v) => setField("ccFeePctBps", Math.round(v * 100))} />
          <CfgNum label="Card fee fixed" value={cfg.ccFeeFixedCents / 100} suffix="$" step="0.01" onChange={(v) => setField("ccFeeFixedCents", Math.round(v * 100))} />
          <CfgNum label="Product cost %" value={cfg.productCostPctBps / 100} suffix="%" step="0.5" onChange={(v) => setField("productCostPctBps", Math.round(v * 100))} />
          <CfgNum label="Local min wage" value={cfg.minWageCentsPerHour / 100} suffix="$/h" step="0.25" onChange={(v) => setField("minWageCentsPerHour", Math.round(v * 100))} />
          <label className="block"><span className="mb-1 block text-xs font-medium text-gray-500">Timezone (workweek anchor)</span>
            <select value={cfg.timezone || "America/New_York"} onChange={(e) => setField("timezone", e.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm">{(ZONES.includes(cfg.timezone) ? ZONES : [cfg.timezone, ...ZONES]).map((z) => <option key={z} value={z}>{z}</option>)}</select></label>
        </div>
        <label className="mt-4 flex items-center justify-between rounded-xl bg-gray-50 p-3">
          <span><span className="block text-sm font-medium">Tip pooling (W-2 staff)</span><span className="block text-xs text-gray-400">Pool card tips daily, split by hours. Excludes 1099 contractors &amp; owners by law.</span></span>
          <button onClick={() => setField("tipPoolingEnabled", !cfg.tipPoolingEnabled)} className={`relative h-6 w-11 rounded-full ${cfg.tipPoolingEnabled ? "bg-purple-600" : "bg-gray-300"}`}><span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${cfg.tipPoolingEnabled ? "left-5" : "left-0.5"}`} /></button>
        </label>
      </Card>
      <Card className="p-5">
        <h2 className="mb-1 text-lg font-bold">Employee profiles</h2><p className="mb-4 text-sm text-gray-500">Toggle W-2 vs 1099 — it switches the entire payout &amp; compliance path. Save writes a new profile version.</p>
        <div className="space-y-3">{techs.map((t) => { const d = draftFor(t); const w2 = d.employmentType === "W2"; const dirty = !!draft[t.id]; return (
          <div key={t.id} className="rounded-xl border border-gray-200 p-4">
            <div className="mb-3 flex items-center justify-between"><div className="font-semibold">{t.name}</div>
              <div className="flex items-center gap-2"><div className="flex rounded-lg bg-gray-100 p-0.5 text-xs font-medium">
                <button onClick={() => setDraftField(t.id, { employmentType: "W2" })} className={`rounded-md px-3 py-1 ${w2 ? "bg-white text-blue-700 shadow-sm" : "text-gray-500"}`}>W-2 Employee</button>
                <button onClick={() => setDraftField(t.id, { employmentType: "1099" })} className={`rounded-md px-3 py-1 ${!w2 ? "bg-white text-purple-700 shadow-sm" : "text-gray-500"}`}>1099 Renter</button></div>
                <button onClick={() => saveComp(t)} disabled={!dirty || savingId === t.id} className="rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">{savingId === t.id ? "Saving…" : "Save"}</button></div></div>
            {w2 ? (
              <div className="grid grid-cols-2 gap-3"><CfgNum label="Service commission %" value={(d.serviceCommissionBps || 0) / 100} suffix="%" onChange={(v) => setDraftField(t.id, { serviceCommissionBps: Math.round(v * 100) })} /><CfgNum label="Retail commission %" value={(d.retailCommissionBps || 0) / 100} suffix="%" onChange={(v) => setDraftField(t.id, { retailCommissionBps: Math.round(v * 100) })} /></div>
            ) : (
              <div className="grid grid-cols-2 gap-3"><CfgNum label="Chair rent" value={(d.rentCents || 0) / 100} suffix="$" step="10" onChange={(v) => setDraftField(t.id, { rentCents: Math.round(v * 100) })} />
                <label className="block"><span className="mb-1 block text-xs font-medium text-gray-500">Rent cadence</span><select value={d.rentCadence || "WEEKLY"} onChange={(e) => setDraftField(t.id, { rentCadence: e.target.value })} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"><option value="WEEKLY">Weekly</option><option value="MONTHLY">Monthly</option></select></label></div>
            )}
            <div className="mt-2 text-xs text-gray-400">{w2 ? "Hours tracked · paid via payroll export · min-wage + OT protected" : "No wage hours · instant payouts · flat rent"}</div>
          </div>
        ); })}</div>
      </Card>
    </div>
  );
}
