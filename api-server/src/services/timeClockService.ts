import { pool } from "../db/pool";
import { HttpError } from "../auth/middleware";
import { getCurrentConfig } from "../repositories/settingsRepo";
import { workweekStartInTz } from "../lib/time";
import {
  closeEntry,
  getEmploymentType,
  getOpenEntry,
  hoursForDay,
  insertClockIn,
} from "../repositories/timeEntryRepo";

export interface ClockState {
  clockedIn: boolean;
  since: string | null;
  hoursToday: number;
}

export async function clockIn(salonId: string, techId: string): Promise<ClockState> {
  const et = await getEmploymentType(pool, techId);
  if (et !== "W2") throw new HttpError(400, "Only W-2 staff use the time clock");
  if (await getOpenEntry(pool, techId)) {
    throw new HttpError(409, "Already clocked in");
  }
  const tz = (await getCurrentConfig(pool, salonId)).timezone;
  await insertClockIn(pool, salonId, techId, workweekStartInTz(tz));
  return getStatus(techId);
}

export async function clockOut(techId: string): Promise<ClockState> {
  const open = await getOpenEntry(pool, techId);
  if (!open) throw new HttpError(409, "Not clocked in");
  await closeEntry(pool, open.id);
  return getStatus(techId);
}

export async function getStatus(techId: string, date?: string): Promise<ClockState> {
  const day = date ?? new Date().toISOString().slice(0, 10);
  const open = await getOpenEntry(pool, techId);
  const hoursToday = await hoursForDay(pool, techId, day);
  return { clockedIn: !!open, since: open?.clockIn ?? null, hoursToday };
}
