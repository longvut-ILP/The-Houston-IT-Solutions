import { Db } from "../db/pool";

export type AppointmentStatus =
  | "BOOKED"
  | "IN_CHAIR"
  | "DONE"
  | "CANCELLED"
  | "NO_SHOW";

export interface AppointmentRow {
  id: string;
  salon_id: string;
  tech_id: string;
  client_id: string | null;
  client_label: string | null;
  service_desc: string | null;
  starts_at: string;
  ends_at: string | null;
  status: AppointmentStatus;
}

export async function insertAppointment(
  db: Db,
  p: {
    salonId: string;
    techId: string;
    clientId?: string | null;
    clientLabel?: string | null;
    serviceDesc?: string | null;
    startsAt: string;
    endsAt?: string | null;
    status?: AppointmentStatus;
  }
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO appointments
       (salon_id, tech_id, client_id, client_label, service_desc,
        starts_at, ends_at, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id`,
    [
      p.salonId,
      p.techId,
      p.clientId ?? null,
      p.clientLabel ?? null,
      p.serviceDesc ?? null,
      p.startsAt,
      p.endsAt ?? null,
      p.status ?? "BOOKED",
    ]
  );
  return rows[0].id;
}

/** Appointments whose start falls on the given calendar date [date, date+1). */
export async function listAppointmentsForDay(
  db: Db,
  salonId: string,
  date: string
): Promise<AppointmentRow[]> {
  const { rows } = await db.query<AppointmentRow>(
    `SELECT id, salon_id, tech_id, client_id, client_label, service_desc,
            starts_at, ends_at, status
       FROM appointments
      WHERE salon_id = $1
        AND starts_at >= $2::date
        AND starts_at <  ($2::date + INTERVAL '1 day')
      ORDER BY starts_at`,
    [salonId, date]
  );
  return rows;
}

export async function updateAppointmentStatus(
  db: Db,
  id: string,
  status: AppointmentStatus
): Promise<AppointmentRow | null> {
  const { rows } = await db.query<AppointmentRow>(
    `UPDATE appointments SET status = $2 WHERE id = $1
     RETURNING id, salon_id, tech_id, client_id, client_label, service_desc,
               starts_at, ends_at, status`,
    [id, status]
  );
  return rows[0] ?? null;
}
