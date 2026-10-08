/**
 * Rooftop Auto — what to show a shopper who lands on a car that has sold.
 *
 * The link outlives the car: a Marketplace post, a shared text, a saved tab, an
 * ad Meta has not caught up on yet. A "not found" page sends that shopper back to
 * Google. A page that says the truck sold and shows the three like it on the lot
 * keeps them on the dealer's site.
 *
 * Pure, so the ranking is tested without a database.
 */

export type Comparable = {
  id: string;
  make: string;
  model: string;
  bodyStyle: string | null;
};

export const SOLD_STATUSES = new Set(['SOLD', 'WHOLESALED']);
export const SIMILAR_LIMIT = 6;

/**
 * Same make and model first, then same body style, then everything else —
 * each tier ordered by how close the price is. A Silverado shopper wants
 * Silverados, then trucks, then whatever is left, before they want a cheaper car.
 */
export function similarToSold<T extends Comparable>(
  sold: Comparable,
  soldPrice: number,
  inventory: T[],
  price: (v: T) => number,
  limit = SIMILAR_LIMIT,
): T[] {
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const tier = (v: T) =>
    same(v.make, sold.make) && same(v.model, sold.model)
      ? 0
      : v.bodyStyle && v.bodyStyle === sold.bodyStyle
        ? 1
        : 2;

  return inventory
    .filter((v) => v.id !== sold.id)
    .map((v) => ({ v, t: tier(v), d: Math.abs(price(v) - soldPrice) }))
    .sort((a, b) => a.t - b.t || a.d - b.d)
    .slice(0, limit)
    .map((x) => x.v);
}
