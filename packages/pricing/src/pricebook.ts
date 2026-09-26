import type { Sku } from "@smc/contracts";

export interface PriceQuery {
  provider: Sku["provider"];
  service: string;
  region: string;
  match: string | RegExp;
  unit?: string;
}

export interface PriceBook {
  find(q: PriceQuery): Sku | undefined;
  findAll(q: PriceQuery): Sku[];
}

const norm = (s: string) => s.toLowerCase();

function matches(sku: Sku, q: PriceQuery): boolean {
  if (sku.provider !== q.provider || norm(sku.service) !== norm(q.service) || sku.region !== q.region) return false;
  if (q.unit && norm(sku.unit) !== norm(q.unit)) return false;
  if (typeof q.match === "string") {
    const m = norm(q.match);
    return norm(sku.description).includes(m) || norm(sku.skuId) === m;
  }
  q.match.lastIndex = 0;
  return q.match.test(sku.description) || q.match.test(sku.skuId);
}

export function createPriceBook(skus: Sku[]): PriceBook {
  const findAll = (q: PriceQuery) => skus.filter((s) => matches(s, q));
  return { findAll, find: (q) => skus.find((s) => matches(s, q)) };
}
