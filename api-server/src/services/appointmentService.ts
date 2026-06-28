import { pool, withTx } from "../db/pool";
import {
  AppointmentRow,
  AppointmentStatus,
  insertAppointment,
  listAppointmentsForDay,
  updateAppointmentStatus,
} from "../repositories/appointmentRepo";
import { insertAudit } from "../repositories/ticketRepo";

export interface CreateAppointmentInput {
  salonId: string;
  techId: string;
  clientId?: string | null;
  clientLabel?: string | null;
  serviceDesc?: string | null;
  startsAt: string; // ISO timestamp
  endsAt?: string | null;
  actorStaffId?: string | null;
}

export async function createAppointment(
  input: CreateAppointmentInput
): Promise<{ id: string }> {
  const id = await withTx(async (db) => {
    const apptId = await insertAppointment(db, input);
    await insertAudit(db, {
      salonId: input.salonId,
      actorStaffId: input.actorStaffId ?? null,
      entityType: "appointment",
      entityId: apptId,
      action: "CREATE",
      after: { techId: input.techId, startsAt: input.startsAt },
    });
    return apptId;
  });
  return { id };
}

export async function listForDay(
  salonId: string,
  date: string
): Promise<AppointmentRow[]> {
  return listAppointmentsForDay(pool, salonId, date);
}

export async function setStatus(
  id: string,
  status: AppointmentStatus
): Promise<AppointmentRow | null> {
  return updateAppointmentStatus(pool, id, status);
}
