import { Db } from "../db/pool";

export interface CategoryRow {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
}
export interface ItemRow {
  id: string;
  categoryId: string | null;
  name: string;
  priceCents: number;
  sortOrder: number;
  isActive: boolean;
}

/** Full menu for a restaurant: active categories + active items. */
export async function getMenu(
  db: Db,
  restaurantId: string
): Promise<{ categories: CategoryRow[]; items: ItemRow[] }> {
  const cats = await db.query<{
    id: string;
    name: string;
    sort_order: number;
    is_active: boolean;
  }>(
    `SELECT id, name, sort_order, is_active FROM menu_categories
      WHERE restaurant_id = $1 AND is_active
      ORDER BY sort_order, name`,
    [restaurantId]
  );
  const items = await db.query<{
    id: string;
    category_id: string | null;
    name: string;
    price_cents: string;
    sort_order: number;
    is_active: boolean;
  }>(
    `SELECT id, category_id, name, price_cents, sort_order, is_active FROM menu_items
      WHERE restaurant_id = $1 AND is_active
      ORDER BY sort_order, name`,
    [restaurantId]
  );
  return {
    categories: cats.rows.map((c) => ({
      id: c.id,
      name: c.name,
      sortOrder: c.sort_order,
      isActive: c.is_active,
    })),
    items: items.rows.map((i) => ({
      id: i.id,
      categoryId: i.category_id,
      name: i.name,
      priceCents: Number(i.price_cents),
      sortOrder: i.sort_order,
      isActive: i.is_active,
    })),
  };
}

export async function insertCategory(
  db: Db,
  restaurantId: string,
  name: string,
  sortOrder = 0
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO menu_categories (restaurant_id, name, sort_order) VALUES ($1,$2,$3) RETURNING id`,
    [restaurantId, name, sortOrder]
  );
  return rows[0].id;
}

export async function insertItem(
  db: Db,
  restaurantId: string,
  p: { categoryId: string | null; name: string; priceCents: number; sortOrder?: number }
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO menu_items (restaurant_id, category_id, name, price_cents, sort_order)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [restaurantId, p.categoryId, p.name, p.priceCents, p.sortOrder ?? 0]
  );
  return rows[0].id;
}

/** Update price/name/active/category for an item (manager edit). */
export async function updateItem(
  db: Db,
  itemId: string,
  p: { name?: string; priceCents?: number; isActive?: boolean; categoryId?: string | null }
): Promise<void> {
  await db.query(
    `UPDATE menu_items SET
       name = COALESCE($2, name),
       price_cents = COALESCE($3, price_cents),
       is_active = COALESCE($4, is_active),
       category_id = COALESCE($5, category_id)
     WHERE id = $1`,
    [itemId, p.name ?? null, p.priceCents ?? null, p.isActive ?? null, p.categoryId ?? null]
  );
}

/** Look up base prices for a set of items (server-side price authority). */
export async function getItemPrices(
  db: Db,
  restaurantId: string,
  itemIds: string[]
): Promise<Map<string, { name: string; priceCents: number }>> {
  if (itemIds.length === 0) return new Map();
  const { rows } = await db.query<{ id: string; name: string; price_cents: string }>(
    `SELECT id, name, price_cents FROM menu_items
      WHERE restaurant_id = $1 AND id = ANY($2::uuid[]) AND is_active`,
    [restaurantId, itemIds]
  );
  return new Map(rows.map((r) => [r.id, { name: r.name, priceCents: Number(r.price_cents) }]));
}

export function itemRestaurant(db: Db, itemId: string) {
  return db
    .query<{ restaurant_id: string }>(`SELECT restaurant_id FROM menu_items WHERE id = $1`, [itemId])
    .then((r) => r.rows[0]?.restaurant_id ?? null);
}
