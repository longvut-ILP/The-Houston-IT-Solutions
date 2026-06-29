// Frontend API client for the Nail Salon POS.
// Point this at the running API (npm run dev -> http://localhost:4000).
// Override at runtime with window.__SALON_API__ if needed.

export const API_BASE =
  (typeof window !== "undefined" && window.__SALON_API__) ||
  "http://localhost:4000";

// In-memory session (no localStorage — survives until page reload by design).
let _token = null;
let _refresh = null;
let _salonId = null;
let _user = null;
let _refreshing = null; // single-flight refresh promise

export function setSession({ token, refreshToken, staff }) {
  _token = token;
  if (refreshToken) _refresh = refreshToken;
  if (staff) {
    _salonId = staff.salonId;
    _user = staff;
  }
}
export function clearSession() {
  _token = null;
  _refresh = null;
  _salonId = null;
  _user = null;
}
export const getUser = () => _user;
export const getSalonId = () => _salonId;
export const isAuthed = () => !!_token;

async function doRefresh() {
  if (!_refresh) throw new Error("no refresh token");
  if (!_refreshing) {
    _refreshing = fetch(`${API_BASE}/auth/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken: _refresh }),
    })
      .then(async (res) => {
        if (!res.ok) {
          clearSession();
          throw new Error("refresh failed");
        }
        setSession(await res.json());
      })
      .finally(() => {
        _refreshing = null;
      });
  }
  return _refreshing;
}

async function request(path, options = {}, retried = false) {
  const headers = { "content-type": "application/json", ...(options.headers || {}) };
  if (_token) headers.authorization = `Bearer ${_token}`;
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  // Access token expired? Refresh once and retry (but never for /auth/* calls).
  if (res.status === 401 && _refresh && !retried && !path.startsWith("/auth/")) {
    try {
      await doRefresh();
      return request(path, options, true);
    } catch {
      clearSession();
    }
  }

  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = body.message || body.error || JSON.stringify(body);
    } catch {
      detail = res.statusText;
    }
    const err = new Error(`${res.status} ${detail}`);
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

// --- auth ---
export async function login(email, password) {
  const r = await request(`/auth/login`, {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  setSession(r);
  return r.staff;
}
export async function registerSalon(body) {
  const r = await request(`/auth/register-salon`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  setSession(r);
  return r.staff;
}

export const me = () => request(`/auth/me`);
export async function logout() {
  try {
    if (_refresh) {
      await fetch(`${API_BASE}/auth/logout`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: _refresh }),
      });
    }
  } catch {
    /* ignore network errors on logout */
  }
  clearSession();
}

// --- date helpers ---
// Server-authoritative salon calendar (timezone-aware). Falls back to the
// browser's local dates until loadCalendar() has run.
let _cal = null;

const localToday = () => new Date().toISOString().slice(0, 10);
function localWeekStart(date = new Date()) {
  const d = new Date(date);
  const diff = (d.getDay() + 6) % 7; // days since Monday
  d.setDate(d.getDate() - diff);
  return d.toISOString().slice(0, 10);
}

export async function loadCalendar() {
  _cal = await request(`/salons/${getSalonId()}/calendar`);
  return _cal;
}
export const today = () => _cal?.today || localToday();
export const weekStart = () => _cal?.weekStart || localWeekStart();
export const getTimezone = () => _cal?.timezone || null;

// Back-compat aliases.
export const todayISO = today;
export const workweekStart = weekStart;

// --- reads ---
export const getSettings = (salonId = getSalonId()) =>
  request(`/salons/${salonId}/settings`);

export const getStaff = (salonId = getSalonId()) =>
  request(`/salons/${salonId}/staff`);

export const getAppointments = (date, salonId = getSalonId()) =>
  request(`/salons/${salonId}/appointments?date=${date}`);

export const getTickets = (date, salonId = getSalonId()) =>
  request(`/salons/${salonId}/tickets?date=${date}`);

export const getPayroll = (start, techId, salonId = getSalonId()) =>
  request(
    `/payroll/workweek?salonId=${salonId}&start=${start}` +
      (techId ? `&techId=${techId}` : "")
  );

export const getTipPool = (date, salonId = getSalonId()) =>
  request(`/tip-pool?salonId=${salonId}&date=${date}`);

// --- commit (persist) — owner/admin ---
export const commitPayroll = (start) =>
  request(`/payroll/commit`, { method: "POST", body: JSON.stringify({ start }) });

export const commitTipPool = (date) =>
  request(`/tip-pool/commit`, { method: "POST", body: JSON.stringify({ date }) });

// --- writes (salonId is enforced server-side from the token) ---
export const putSettings = (config, salonId = getSalonId()) =>
  request(`/salons/${salonId}/settings`, {
    method: "PUT",
    body: JSON.stringify(config),
  });

export const updateStaffComp = (staffId, body) =>
  request(`/staff/${staffId}/comp`, {
    method: "PATCH",
    body: JSON.stringify({ salonId: getSalonId(), ...body }),
  });

export const createStaff = (body) =>
  request(`/staff`, {
    method: "POST",
    body: JSON.stringify({ salonId: getSalonId(), ...body }),
  });

export const setStaffPassword = (staffId, password) =>
  request(`/staff/${staffId}/credential`, {
    method: "POST",
    body: JSON.stringify({ password }),
  });

export const createAppointment = (body) =>
  request(`/appointments`, {
    method: "POST",
    body: JSON.stringify({ salonId: getSalonId(), ...body }),
  });

export const setAppointmentStatus = (id, status) =>
  request(`/appointments/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });

export const checkout = (body) =>
  request(`/checkout`, { method: "POST", body: JSON.stringify(body) });

// --- time clock (W-2) ---
export const clockIn = (techId) =>
  request(`/time-clock/in`, { method: "POST", body: JSON.stringify(techId ? { techId } : {}) });
export const clockOut = (techId) =>
  request(`/time-clock/out`, { method: "POST", body: JSON.stringify(techId ? { techId } : {}) });
export const clockStatus = (techId, date) => {
  const p = new URLSearchParams();
  if (techId) p.set("techId", techId);
  if (date) p.set("date", date);
  return request(`/time-clock/status?${p.toString()}`);
};
