import { Db } from "../db/pool";

export interface TicketSummary {
  id: string;
  techId: string;
  service: number;
  retail: number;
  ccTip: number;
  cashTip: number;
}

/**
 * Completed tickets for a calendar day, reduced to the four amounts the
 * dashboards need (service, retail, card tip, cash tip). The UI recomputes
 * commission/payout from these with the same engine the server used, so the
 * numbers match without shipping a second reporting calc.
 */
export async function getTicketsForDay(
  db: Db,
  salonId: string,
  date: string,
  techId?: string // when set, only this tech's tickets (used to scope TECH role)
): Promise<TicketSummary[]> {
  const params: unknown[] = [salonId, date];
  let techFilter = "";
  if (techId) {
    params.push(techId);
    techFilter = ` AND t.tech_id = $3`;
  }
  const { rows } = await db.query<{
    id: string;
    tech_id: string;
    service: string;
    retail: string;
    cctip: string;
    cashtip: string;
  }>(
    `SELECT t.id, t.tech_id,
            COALESCE((SELECT SUM(amount_cents) FROM ticket_line_items
                       WHERE ticket_id = t.id AND kind = 'SERVICE'),0) AS service,
            COALESCE((SELECT SUM(amount_cents) FROM ticket_line_items
                       WHERE ticket_id = t.id AND kind = 'RETAIL'),0) AS retail,
            COALESCE((SELECT SUM(amount_cents) FROM ticket_tips
                       WHERE ticket_id = t.id AND method = 'CARD'),0) AS cctip,
            COALESCE((SELECT SUM(amount_cents) FROM ticket_tips
                       WHERE ticket_id = t.id AND method = 'CASH'),0) AS cashtip
       FROM tickets t
      WHERE t.salon_id = $1
        AND t.status = 'COMPLETED'
        AND t.created_at >= $2::date
        AND t.created_at <  ($2::date + INTERVAL '1 day')${techFilter}
      ORDER BY t.created_at`,
    params
  );
  return rows.map((r) => ({
    id: r.id,
    techId: r.tech_id,
    service: Number(r.service),
    retail: Number(r.retail),
    ccTip: Number(r.cctip),
    cashTip: Number(r.cashtip),
  }));
}
