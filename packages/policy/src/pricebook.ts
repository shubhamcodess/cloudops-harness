import type { Provider, Sku } from "@smc/contracts";

// Interface that the @smc/pricing package will satisfy via an adapter.
// `match` is compared (case-insensitive) against Sku.description or Sku.skuId;
// `exclude` (single or array) is compared the same way and disqualifies the SKU;
// `unitPattern` restricts to SKUs whose `unit` matches; `pick` chooses among
// the survivors (lowest returned number wins). Without `pick`, the first
// surviving SKU is returned in the pricing package's iteration order.
export interface PriceQuery {
  provider: Provider;
  service: string;
  region: string;
  match: RegExp | RegExp[];
  unit?: string;
  exclude?: RegExp | RegExp[];
  unitPattern?: RegExp;
  pick?: (sku: Sku) => number;
}

export interface PriceBook {
  find(q: PriceQuery): Sku | undefined;
}
