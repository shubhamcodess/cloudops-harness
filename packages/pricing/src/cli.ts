import type { Provider } from "@smc/contracts";
import { loadSkus, servicesFor } from "./load.js";

const [provider, region, needle, ...rest] = process.argv.slice(2);
if (!provider || !region || !["aws", "gcp", "azure"].includes(provider)) {
  console.error("usage: cli.ts <aws|gcp|azure> <region> [match] [--service=a,b] [--refresh]");
  process.exit(1);
}
const flags = new Map(rest.filter((a) => a.startsWith("--")).map((a) => a.slice(2).split("=") as [string, string?]));
const services = flags.get("service")?.split(",");
const p = provider as Provider;
if (services?.some((s) => !servicesFor(p).includes(s))) {
  console.error(`services for ${p}: ${servicesFor(p).join(", ")}`);
  process.exit(1);
}
const re = needle && !needle.startsWith("--") ? new RegExp(needle, "i") : undefined;
const skus = await loadSkus({ providers: [p], regions: [region], services, refresh: flags.has("refresh") });
for (const s of skus.filter((s) => !re || re.test(s.description) || re.test(s.skuId))) {
  console.log(JSON.stringify({ ...s, description: s.description.slice(0, 120) }));
}
