import type { Provider, Sku } from "@smc/contracts";
import { AWS_SERVICES, fetchAws } from "./aws.js";
import { AZURE_SERVICES, fetchAzure } from "./azure.js";
import { readCache, writeCache, type CacheOptions } from "./cache.js";
import { gcpApiKey } from "./env.js";
import { GCP_SERVICES, fetchGcp } from "./gcp.js";
import { createPriceBook, type PriceBook } from "./pricebook.js";

export interface LoadOptions extends CacheOptions {
  providers: Provider[];
  regions: string[] | Partial<Record<Provider, string[]>>;
  services?: string[];
  fetchFn?: typeof fetch;
}

const ALL = { aws: AWS_SERVICES, gcp: GCP_SERVICES, azure: AZURE_SERVICES } as const;

export const servicesFor = (p: Provider) => Object.keys(ALL[p]);

export async function loadSkus(o: LoadOptions): Promise<Sku[]> {
  const skus: Sku[] = [];
  for (const provider of o.providers) {
    const regions = Array.isArray(o.regions) ? o.regions : (o.regions[provider] ?? []);
    const services = servicesFor(provider).filter((s) => !o.services || o.services.includes(s));
    for (const service of services) {
      const missing: string[] = [];
      for (const region of regions) {
        const hit = await readCache(o, provider, service, region);
        if (hit) skus.push(...hit);
        else missing.push(region);
      }
      if (!missing.length) continue;
      const fetchedAt = new Date().toISOString();
      const fresh = new Map<string, Sku[]>();
      if (provider === "gcp") {
        const key = gcpApiKey();
        if (!key) throw new Error("GCP_API_KEY is not set");
        for (const [r, s] of await fetchGcp(service, missing, key, o.fetchFn)) fresh.set(r, s);
      } else {
        for (const r of missing) fresh.set(r, await (provider === "aws" ? fetchAws : fetchAzure)(service, r, o.fetchFn));
      }
      for (const [region, list] of fresh) {
        await writeCache(o, provider, service, region, list, fetchedAt);
        skus.push(...list);
      }
    }
  }
  return skus;
}

export async function loadPriceBook(o: LoadOptions): Promise<PriceBook> {
  return createPriceBook(await loadSkus(o));
}
