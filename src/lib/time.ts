/**
 * Timezone-aware calendar helpers. Uses Intl (no external library) so the
 * workweek anchor and "today" follow the salon's local calendar instead of the
 * server's UTC clock.
 */
const DOW: Record<string, number> = {
  Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6,
};

/** Calendar date in `tz` for the instant `now`, as YYYY-MM-DD. */
export function todayInTz(tz: string, now: Date = new Date()): string {
  // en-CA renders as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(now);
}

/** Monday (local to `tz`) of the week containing `now`, as YYYY-MM-DD. */
export function workweekStartInTz(tz: string, now: Date = new Date()): string {
  const today = todayInTz(tz, now);
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(now);
  const back = DOW[weekday] ?? 0;
  const [y, m, d] = today.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - back);
  return dt.toISOString().slice(0, 10);
}
