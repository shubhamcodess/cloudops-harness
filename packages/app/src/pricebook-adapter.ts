import type { PriceBook as PolicyBook, PriceQuery as PolicyQuery } from "@smc/policy";
import type { PriceBook as PricingBook } from "@smc/pricing";
import type { Sku } from "@smc/contracts";

const ALIAS: Record<string, Record<string, string>> = {
  aws: { loadbalancer: "alb", network: "data-transfer", cloudfront: "cloudfront", s3: "s3", rds: "rds", lambda: "lambda", fargate: "fargate", ec2: "ec2", eks: "ec2" },
  gcp: { cloudrun: "cloud-run", gcs: "cloud-storage", cloudsql: "cloud-sql", cloudcdn: "networking", loadbalancer: "networking", network: "compute", gce: "compute", gke: "gke" },
  azure: { containerapps: "container-apps", blob: "storage", vm: "vm" },
};

const asList = <T,>(x: T | T[] | undefined): T[] => (x == null ? [] : Array.isArray(x) ? x : [x]);
const testAny = (regs: RegExp[], s: string) => regs.some((r) => (r.lastIndex = 0, r.test(s)));

function matchOne(sku: Sku, positives: RegExp[], negatives: RegExp[], unitPattern?: RegExp): boolean {
  const text = `${sku.description} ${sku.skuId}`;
  if (!positives.length) return false;
  if (!testAny(positives, text)) return false;
  if (negatives.length && testAny(negatives, text)) return false;
  if (unitPattern && !(unitPattern.lastIndex = 0, unitPattern.test(sku.unit))) return false;
  return true;
}

/** Maps the policy package's service names onto the pricing package's SKU service names. */
export function adaptPriceBook(pb: PricingBook): PolicyBook {
  return {
    find(q: PolicyQuery) {
      const service = ALIAS[q.provider]?.[q.service] ?? q.service;
      const positives = asList(q.match);
      const negatives = asList(q.exclude);
      // Query with a broad first regex so pricing.findAll returns a superset; we filter locally.
      const raw = pb.findAll({ provider: q.provider, region: q.region, service, match: positives[0] ?? /./ });
      const survivors = raw.filter((s) => matchOne(s, positives, negatives, q.unitPattern));
      if (!survivors.length) return undefined;
      if (q.pick) return survivors.slice().sort((a, b) => q.pick!(a) - q.pick!(b))[0];
      return survivors[0];
    },
  };
}
