import type { Sku } from "@smc/contracts";

const BASE = "https://cloudbilling.googleapis.com/v1/services";

interface Spec {
  id: string;
  keep?(d: string): boolean;
}

export const GCP_SERVICES: Record<string, Spec> = {
  compute: { id: "6F81-5844-456A", keep: (d) => !/Preemptible|Spot|Commitment|Sole Tenancy|Windows|Custom|Licens/i.test(d) },
  "cloud-run": { id: "152E-C115-5142" },
  "cloud-storage": { id: "95FF-2EF5-5EA1" },
  gke: { id: "CCD8-9BF1-090E" },
  "cloud-sql": { id: "9662-B51E-5089", keep: (d) => /PostgreSQL/i.test(d) },
  networking: { id: "E505-1604-58F8" },
};

interface RawSku {
  skuId: string;
  description: string;
  category?: { usageType?: string };
  serviceRegions?: string[];
  pricingInfo?: Array<{
    pricingExpression?: {
      usageUnit?: string;
      tieredRates?: Array<{ startUsageAmount?: number; unitPrice?: { currencyCode?: string; units?: string; nanos?: number } }>;
    };
  }>;
}

export const moneyToNumber = (u?: { units?: string; nanos?: number }) => Number(u?.units ?? 0) + (u?.nanos ?? 0) / 1e9;

export function normalizeGcpSku(raw: RawSku, service: string, regions: string[], fetchedAt: string, source: string): Sku[] {
  const spec = GCP_SERVICES[service]!;
  if (raw.category?.usageType && raw.category.usageType !== "OnDemand") return [];
  if (spec.keep && !spec.keep(raw.description)) return [];
  const expr = raw.pricingInfo?.[0]?.pricingExpression;
  const tiers = expr?.tieredRates ?? [];
  const out: Sku[] = [];
  for (const region of regions) {
    if (!raw.serviceRegions?.includes(region) && !raw.serviceRegions?.includes("global")) continue;
    for (const t of tiers) {
      const start = t.startUsageAmount ?? 0;
      out.push({
        provider: "gcp",
        service,
        skuId: start > 0 ? `${raw.skuId}@${start}` : raw.skuId,
        description: raw.description,
        region,
        unit: expr?.usageUnit ?? "",
        unitPrice: moneyToNumber(t.unitPrice),
        currency: t.unitPrice?.currencyCode ?? "USD",
        source,
        fetchedAt,
      });
    }
  }
  return out;
}

export async function fetchGcp(
  service: string,
  regions: string[],
  apiKey: string,
  fetchFn: typeof fetch = fetch,
): Promise<Map<string, Sku[]>> {
  const spec = GCP_SERVICES[service];
  if (!spec) throw new Error(`unknown gcp service ${service}`);
  const source = `${BASE}/${spec.id}/skus`;
  const fetchedAt = new Date().toISOString();
  const byRegion = new Map<string, Sku[]>(regions.map((r) => [r, []]));
  let pageToken = "";
  do {
    const q = new URLSearchParams({ key: apiKey, pageSize: "5000" });
    if (pageToken) q.set("pageToken", pageToken);
    const res = await fetchFn(`${source}?${q}`);
    if (!res.ok) throw new Error(`gcp ${service}: HTTP ${res.status}`);
    const j = (await res.json()) as { skus?: RawSku[]; nextPageToken?: string };
    for (const raw of j.skus ?? []) for (const s of normalizeGcpSku(raw, service, regions, fetchedAt, source)) byRegion.get(s.region)!.push(s);
    pageToken = j.nextPageToken ?? "";
  } while (pageToken);
  return byRegion;
}
