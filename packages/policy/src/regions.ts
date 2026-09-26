import type { Provider } from "@smc/contracts";

export type Geo = "eu" | "us" | "in" | "uk" | "apac" | "other";

export interface RegionInfo {
  provider: Provider;
  id: string;
  geo: Geo;
  country: string; // ISO-3166 alpha-2
  city?: string;
}

// Static, non-exhaustive table of the most-used regions per provider.
// Kept small and deterministic; extend as needed.
export const REGIONS: RegionInfo[] = [
  // AWS
  { provider: "aws", id: "us-east-1", geo: "us", country: "US", city: "Ashburn" },
  { provider: "aws", id: "us-east-2", geo: "us", country: "US", city: "Columbus" },
  { provider: "aws", id: "us-west-2", geo: "us", country: "US", city: "Portland" },
  { provider: "aws", id: "eu-west-1", geo: "eu", country: "IE", city: "Dublin" },
  { provider: "aws", id: "eu-central-1", geo: "eu", country: "DE", city: "Frankfurt" },
  { provider: "aws", id: "eu-west-2", geo: "uk", country: "GB", city: "London" },
  { provider: "aws", id: "ap-south-1", geo: "in", country: "IN", city: "Mumbai" },
  { provider: "aws", id: "ap-southeast-1", geo: "apac", country: "SG", city: "Singapore" },
  { provider: "aws", id: "ap-northeast-1", geo: "apac", country: "JP", city: "Tokyo" },
  // GCP
  { provider: "gcp", id: "us-central1", geo: "us", country: "US", city: "Council Bluffs" },
  { provider: "gcp", id: "us-east4", geo: "us", country: "US", city: "Ashburn" },
  { provider: "gcp", id: "europe-west1", geo: "eu", country: "BE", city: "St. Ghislain" },
  { provider: "gcp", id: "europe-west3", geo: "eu", country: "DE", city: "Frankfurt" },
  { provider: "gcp", id: "europe-west2", geo: "uk", country: "GB", city: "London" },
  { provider: "gcp", id: "asia-south1", geo: "in", country: "IN", city: "Mumbai" },
  { provider: "gcp", id: "asia-southeast1", geo: "apac", country: "SG", city: "Singapore" },
  // Azure
  { provider: "azure", id: "eastus", geo: "us", country: "US", city: "Virginia" },
  { provider: "azure", id: "westus2", geo: "us", country: "US", city: "Washington" },
  { provider: "azure", id: "westeurope", geo: "eu", country: "NL", city: "Amsterdam" },
  { provider: "azure", id: "germanywestcentral", geo: "eu", country: "DE", city: "Frankfurt" },
  { provider: "azure", id: "uksouth", geo: "uk", country: "GB", city: "London" },
  { provider: "azure", id: "centralindia", geo: "in", country: "IN", city: "Pune" },
  { provider: "azure", id: "southeastasia", geo: "apac", country: "SG", city: "Singapore" },
];

export function region(provider: Provider, id: string): RegionInfo | undefined {
  return REGIONS.find((r) => r.provider === provider && r.id === id);
}

export function regionsByProvider(provider: Provider): RegionInfo[] {
  return REGIONS.filter((r) => r.provider === provider);
}

// Approximate P50 RTT (ms) between end-user geographies. Symmetric.
// Assumptions: public internet, wired broadband, healthy peering, no CDN.
// Coarse buckets, meant only for ranking; not measurements.
const RTT: Record<Geo, Record<Geo, number>> = {
  eu:   { eu: 20,  uk: 15,  us: 90,  in: 130, apac: 180, other: 150 },
  uk:   { eu: 15,  uk: 8,   us: 85,  in: 130, apac: 190, other: 150 },
  us:   { eu: 90,  uk: 85,  us: 25,  in: 220, apac: 150, other: 150 },
  in:   { eu: 130, uk: 130, us: 220, in: 15,  apac: 90,  other: 150 },
  apac: { eu: 180, uk: 190, us: 150, in: 90,  apac: 25,  other: 150 },
  other:{ eu: 150, uk: 150, us: 150, in: 150, apac: 150, other: 150 },
};

/** RTT ms from a user geo to a region geo. */
export function rttMs(userGeo: Geo, regionGeo: Geo): number {
  return RTT[userGeo][regionGeo];
}

/** Map a free-form user region hint ("eu", "EU", "de", "gb-lon", "in-blr") to a Geo. */
export function toGeo(hint: string): Geo {
  const h = hint.trim().toLowerCase();
  if (h === "eu" || h.startsWith("eu-") || ["de","fr","ie","nl","es","it","be","se","fi","pl","at","dk","pt","cz"].includes(h)) return "eu";
  if (h === "uk" || h === "gb" || h.startsWith("uk-") || h.startsWith("gb-")) return "uk";
  if (h === "us" || h === "usa" || h.startsWith("us-") || h.startsWith("na-") || h === "ca") return "us";
  if (h === "in" || h.startsWith("in-")) return "in";
  if (["apac","sg","jp","au","kr","hk","tw","id","my","th","vn","ph"].includes(h) || h.startsWith("ap-")) return "apac";
  return "other";
}

/** Worst-case P50 RTT from the given user regions to a region. */
export function worstRttMs(userRegions: string[], r: RegionInfo): number {
  return Math.max(...userRegions.map((u) => rttMs(toGeo(u), r.geo)));
}
