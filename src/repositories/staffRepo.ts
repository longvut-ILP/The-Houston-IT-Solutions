import { Db } from "../db/pool";
import { EmploymentType, TechConfig } from "../lib/commissionEngine";
import { toDbEmployment } from "./ticketRepo";

/** DB enum -> engine enum. The DB stores 'CONTRACTOR_1099'; the engine '1099'. */
function toEngineEmployment(dbValue: string): EmploymentType {
  return dbValue === "W2" ? "W2" : "1099";
}

export interface StaffWithProfile {
  salonId: string;
  tech: TechConfig;
  /** 1099 only */
  rentAmountCents: number | null;
  rentCadence: "WEEKLY" | "MONTHLY" | null;
}

interface StaffRow {
  salon_id: string;
  full_name: string;
  employment_type: string;
  service_commission_bps: number | null;
  retail_commission_bps: number | null;
  rent_amount_cents: string | null;
  rent_cadence: "WEEKLY" | "MONTHLY" | null;
}

/** Staff member joined to their CURRENT pay profile. */
export async function getStaffWithProfile(
  db: Db,
  staffId: string
): Promise<StaffWithProfile> {
  const { rows } = await db.query<StaffRow>(
    `SELECT s.salon_id, s.full_name, s.employment_type,
            p.service_commission_bps, p.retail_commission_bps,
            p.rent_amount_cents, p.rent_cadence
       FROM staff s
       JOIN staff_pay_profiles p ON p.staff_id = s.id AND p.is_current
      WHERE s.id = $1 AND s.is_active
      LIMIT 1`,
    [staffId]
  );
  if (rows.length === 0) {
    throw new Error(`No active staff/profile for ${staffId}`);
  }
  const r = rows[0];
  const employmentType = toEngineEmployment(r.employment_type);
  return {
    salonId: r.salon_id,
    tech: {
      id: staffId,
      name: r.full_name,
      employmentType,
      serviceCommissionBps: r.service_commission_bps ?? 0,
      retailCommissionBps: r.retail_commission_bps ?? 0,
    },
    rentAmountCents: r.rent_amount_cents === null ? null : Number(r.rent_amount_cents),
    rentCadence: r.rent_cadence,
  };
}

export interface PayProfileInput {
  employmentType: EmploymentType;
  serviceCommissionBps?: number | null;
  retailCommissionBps?: number | null;
  rentAmountCents?: number | null;
  rentCadence?: "WEEKLY" | "MONTHLY" | null;
}

export async function insertStaff(
  db: Db,
  params: {
    salonId: string;
    fullName: string;
    email?: string | null;
    role?: "OWNER" | "ADMIN" | "TECH";
    employmentType: EmploymentType;
  }
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO staff (salon_id, full_name, email, role, employment_type)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [
      params.salonId,
      params.fullName,
      params.email ?? null,
      params.role ?? "TECH",
      toDbEmployment(params.employmentType),
    ]
  );
  return rows[0].id;
}

/** Insert a NEW current pay profile, flipping any prior current to false. */
export async function replaceCurrentPayProfile(
  db: Db,
  staffId: string,
  p: PayProfileInput
): Promise<void> {
  await db.query(
    `UPDATE staff_pay_profiles SET is_current = false
      WHERE staff_id = $1 AND is_current`,
    [staffId]
  );
  const isW2 = p.employmentType === "W2";
  await db.query(
    `INSERT INTO staff_pay_profiles
       (staff_id, employment_type, service_commission_bps, retail_commission_bps,
        rent_amount_cents, rent_cadence, is_current)
     VALUES ($1,$2,$3,$4,$5,$6,true)`,
    [
      staffId,
      toDbEmployment(p.employmentType),
      isW2 ? p.serviceCommissionBps ?? 0 : null,
      isW2 ? p.retailCommissionBps ?? 0 : null,
      isW2 ? null : p.rentAmountCents ?? 0,
      isW2 ? null : p.rentCadence ?? "WEEKLY",
    ]
  );
}

export async function updateStaffEmployment(
  db: Db,
  staffId: string,
  employmentType: EmploymentType
): Promise<void> {
  await db.query(
    `UPDATE staff SET employment_type = $2 WHERE id = $1`,
    [staffId, toDbEmployment(employmentType)]
  );
}

export interface StaffListItem {
  id: string;
  name: string;
  role: string;
  employmentType: EmploymentType;
  serviceCommissionBps: number;
  retailCommissionBps: number;
  rentCents: number | null;
  rentCadence: "WEEKLY" | "MONTHLY" | null;
}

/** All active staff in a salon with their current pay profile (for the UI). */
export async function listStaffWithProfiles(
  db: Db,
  salonId: string
): Promise<StaffListItem[]> {
  const { rows } = await db.query<StaffRow & { id: string; role: string }>(
    `SELECT s.id, s.full_name, s.role, s.employment_type, s.salon_id,
            p.service_commission_bps, p.retail_commission_bps,
            p.rent_amount_cents, p.rent_cadence
       FROM staff s
       JOIN staff_pay_profiles p ON p.staff_id = s.id AND p.is_current
      WHERE s.salon_id = $1 AND s.is_active
      ORDER BY s.full_name`,
    [salonId]
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.full_name,
    role: r.role,
    employmentType: toEngineEmployment(r.employment_type),
    serviceCommissionBps: r.service_commission_bps ?? 0,
    retailCommissionBps: r.retail_commission_bps ?? 0,
    rentCents: r.rent_amount_cents === null ? null : Number(r.rent_amount_cents),
    rentCadence: r.rent_cadence,
  }));
}
