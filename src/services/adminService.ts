import { withTx } from "../db/pool";
import { replaceCurrentConfig } from "../repositories/settingsRepo";
import {
  insertStaff,
  replaceCurrentPayProfile,
  updateStaffEmployment,
  PayProfileInput,
} from "../repositories/staffRepo";
import { insertAudit } from "../repositories/ticketRepo";
import { EmploymentType, SalonConfig } from "../lib/commissionEngine";

/** Versioned settings update (new current row) + audit, atomically. */
export async function updateSettings(
  salonId: string,
  config: SalonConfig,
  actorStaffId?: string | null
): Promise<SalonConfig> {
  await withTx(async (db) => {
    await replaceCurrentConfig(db, salonId, config);
    await insertAudit(db, {
      salonId,
      actorStaffId: actorStaffId ?? null,
      entityType: "salon_settings",
      entityId: salonId,
      action: "UPDATE",
      after: config,
    });
  });
  return config;
}

export interface CreateStaffInput {
  salonId: string;
  fullName: string;
  email?: string | null;
  role?: "OWNER" | "ADMIN" | "TECH";
  employmentType: EmploymentType;
  serviceCommissionBps?: number | null;
  retailCommissionBps?: number | null;
  rentAmountCents?: number | null;
  rentCadence?: "WEEKLY" | "MONTHLY" | null;
}

/** Create a staff member with an initial current pay profile + audit. */
export async function createStaff(
  input: CreateStaffInput,
  actorStaffId?: string | null
): Promise<{ staffId: string }> {
  const staffId = await withTx(async (db) => {
    const id = await insertStaff(db, {
      salonId: input.salonId,
      fullName: input.fullName,
      email: input.email ?? null,
      role: input.role ?? "TECH",
      employmentType: input.employmentType,
    });
    await replaceCurrentPayProfile(db, id, profileFrom(input));
    await insertAudit(db, {
      salonId: input.salonId,
      actorStaffId: actorStaffId ?? null,
      entityType: "staff",
      entityId: id,
      action: "CREATE",
      after: { ...input },
    });
    return id;
  });
  return { staffId };
}

export interface UpdateStaffCompInput {
  salonId: string;
  employmentType: EmploymentType;
  serviceCommissionBps?: number | null;
  retailCommissionBps?: number | null;
  rentAmountCents?: number | null;
  rentCadence?: "WEEKLY" | "MONTHLY" | null;
}

/**
 * Update a tech's employment type / comp by writing a NEW current pay profile
 * (history preserved) and syncing staff.employment_type. The W-2 vs 1099
 * toggle on the admin UI lands here.
 */
export async function updateStaffComp(
  staffId: string,
  input: UpdateStaffCompInput,
  actorStaffId?: string | null
): Promise<void> {
  await withTx(async (db) => {
    await updateStaffEmployment(db, staffId, input.employmentType);
    await replaceCurrentPayProfile(db, staffId, profileFrom(input));
    await insertAudit(db, {
      salonId: input.salonId,
      actorStaffId: actorStaffId ?? null,
      entityType: "staff",
      entityId: staffId,
      action: "UPDATE_COMP",
      after: { ...input },
    });
  });
}

function profileFrom(i: {
  employmentType: EmploymentType;
  serviceCommissionBps?: number | null;
  retailCommissionBps?: number | null;
  rentAmountCents?: number | null;
  rentCadence?: "WEEKLY" | "MONTHLY" | null;
}): PayProfileInput {
  return {
    employmentType: i.employmentType,
    serviceCommissionBps: i.serviceCommissionBps ?? null,
    retailCommissionBps: i.retailCommissionBps ?? null,
    rentAmountCents: i.rentAmountCents ?? null,
    rentCadence: i.rentCadence ?? null,
  };
}
