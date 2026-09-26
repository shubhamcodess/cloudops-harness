import type { Sku } from "@smc/contracts";

const BASE = "https://prices.azure.com/api/retail/prices";

interface Spec {
  serviceName: string;
  keep?(i: AzureItem): boolean;
}

export const AZURE_SERVICES: Record<string, Spec> = {
  vm: {
    serviceName: "Virtual Machines",
    keep: (i) => !/Windows/i.test(i.productName) && !/Spot|Low Priority/i.test(i.skuName),
  },
  "container-apps": { serviceName: "Azure Container Apps" },
  storage: { serviceName: "Storage" },
};

export interface AzureItem {
  currencyCode: string;
  tierMinimumUnits: number;
  unitPrice: number;
  armRegionName: string;
  skuId: string;
  meterId: string;
  productName: string;
  skuName: string;
  meterName: string;
  unitOfMeasure: string;
  type: string;
}

export function normalizeAzureItem(i: AzureItem, service: string, fetchedAt: string, source: string): Sku | undefined {
  const spec = AZURE_SERVICES[service]!;
  if (i.type !== "Consumption" || (spec.keep && !spec.keep(i))) return undefined;
  return {
    provider: "azure",
    service,
    skuId: `${i.skuId}/${i.meterId}${i.tierMinimumUnits > 0 ? `@${i.tierMinimumUnits}` : ""}`,
    description: `${i.productName} ${i.skuName} ${i.meterName}`.trim(),
    region: i.armRegionName,
    unit: i.unitOfMeasure,
    unitPrice: i.unitPrice,
    currency: i.currencyCode,
    source,
    fetchedAt,
  };
}

export async function fetchAzure(service: string, region: string, fetchFn: typeof fetch = fetch): Promise<Sku[]> {
  const spec = AZURE_SERVICES[service];
  if (!spec) throw new Error(`unknown azure service ${service}`);
  const filter = `serviceName eq '${spec.serviceName}' and armRegionName eq '${region}' and type eq 'Consumption'`;
  const source = `${BASE}?$filter=${encodeURIComponent(filter)}`;
  const fetchedAt = new Date().toISOString();
  const out: Sku[] = [];
  let next: string | null = source;
  while (next) {
    const res: Response = await fetchFn(next);
    if (!res.ok) throw new Error(`azure ${service}/${region}: HTTP ${res.status}`);
    const j = (await res.json()) as { Items: AzureItem[]; NextPageLink: string | null };
    for (const i of j.Items) {
      const s = normalizeAzureItem(i, service, fetchedAt, source);
      if (s) out.push(s);
    }
    next = j.NextPageLink;
  }
  return out;
}
