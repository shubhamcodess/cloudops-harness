import type { Sku } from "@smc/contracts";
import { csvRows, lines, type CsvRow } from "./csv.js";

const BASE = "https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws";

interface Spec {
  offer: string;
  global?: boolean;
  keep(r: CsvRow, region: string): boolean;
  describe?(r: CsvRow): string;
}

const EC2_TYPES = /^(t3|t3a|t4g|m5|m6i|m6g|m7i|m7g|c5|c6i|c6g|c7g|r5|r6i|r6g)\.(micro|small|medium|large|xlarge|2xlarge|4xlarge)$/;
const RDS_TYPES = /^db\.(t3|t4g|m5|m6g|m6i|r5|r6g)\.(micro|small|medium|large|xlarge)$/;

const CF_LOCATIONS: Array<[RegExp, string]> = [
  [/^eu-|^il-|^me-/, "Europe"],
  [/^us-|^ca-/, "United States"],
  [/^ap-south-/, "India"],
  [/^ap-southeast-1$/, "Singapore"],
  [/^ap-northeast-1$/, "Japan"],
  [/^sa-/, "South America"],
];

export const AWS_SERVICES: Record<string, Spec> = {
  ec2: {
    offer: "AmazonEC2",
    keep: (r) =>
      r["Product Family"] === "Compute Instance" &&
      r["Tenancy"] === "Shared" &&
      r["Operating System"] === "Linux" &&
      r["License Model"] === "No License required" &&
      (r["Pre Installed S/W"] ?? "NA") === "NA" &&
      (r["CapacityStatus"] ?? "Used") === "Used" &&
      EC2_TYPES.test(r["Instance Type"] ?? ""),
    describe: (r) => `${r["Instance Type"]} Linux ${r["PriceDescription"]}`,
  },
  fargate: {
    offer: "AmazonECS",
    keep: (r) => /Fargate-(vCPU|GB)-Hours/.test(r["usageType"] ?? "") && !/Windows|Spot/i.test(r["usageType"] ?? ""),
    describe: (r) => `${r["PriceDescription"]} [${r["usageType"]}]`,
  },
  lambda: {
    offer: "AWSLambda",
    keep: (r) => /(Request|Lambda-GB-Second)(-ARM)?$/.test(r["usageType"] ?? ""),
    describe: (r) => `${r["PriceDescription"]} [${r["usageType"]}]`,
  },
  s3: {
    offer: "AmazonS3",
    keep: (r) => /(TimedStorage-ByteHrs|Requests-Tier[12])$/.test(r["usageType"] ?? ""),
    describe: (r) => `${r["PriceDescription"]} [${r["usageType"]}]`,
  },
  cloudfront: {
    offer: "AmazonCloudFront",
    global: true,
    keep: (r, region) => {
      const loc = CF_LOCATIONS.find(([re]) => re.test(region))?.[1];
      return r["Transfer Type"] === "CloudFront Outbound" && !!loc && r["From Location"] === loc;
    },
    describe: (r) => `CloudFront ${r["From Location"]} ${r["PriceDescription"]}`,
  },
  alb: {
    offer: "AWSELB",
    keep: (r) =>
      r["Product Family"] === "Load Balancer-Application" &&
      r["Location Type"] === "AWS Region" &&
      /-(LoadBalancerUsage|LCUUsage)$/.test(r["usageType"] ?? ""),
    describe: (r) => `${r["PriceDescription"]} [${r["usageType"]}]`,
  },
  rds: {
    offer: "AmazonRDS",
    keep: (r) =>
      r["Product Family"] === "Database Instance" &&
      r["Database Engine"] === "PostgreSQL" &&
      /^(Single|Multi)-AZ$/.test(r["Deployment Option"] ?? "") &&
      RDS_TYPES.test(r["Instance Type"] ?? ""),
    describe: (r) => `${r["Instance Type"]} PostgreSQL ${r["Deployment Option"]} ${r["PriceDescription"]}`,
  },
  "data-transfer": {
    offer: "AWSDataTransfer",
    keep: (r) => r["Transfer Type"] === "AWS Outbound" && /(^|-)DataTransfer-Out-Bytes$/.test(r["usageType"] ?? ""),
    describe: (r) => `Internet ${r["PriceDescription"]}`,
  },
};

export function awsUrl(service: string, region: string, fmt: "csv" | "json" = "csv"): string {
  const s = AWS_SERVICES[service];
  if (!s) throw new Error(`unknown aws service ${service}`);
  return s.global ? `${BASE}/${s.offer}/current/index.${fmt}` : `${BASE}/${s.offer}/current/${region}/index.${fmt}`;
}

export async function* awsSkusFromLines(
  service: string,
  region: string,
  lineIter: AsyncIterable<string>,
  fetchedAt: string,
  source: string,
): AsyncGenerator<Sku> {
  const spec = AWS_SERVICES[service]!;
  for await (const r of csvRows(lineIter, (l) => l.includes('"OnDemand"'))) {
    if (r["TermType"] !== "OnDemand" || !spec.keep(r, region)) continue;
    const price = Number(r["PricePerUnit"]);
    if (!Number.isFinite(price)) continue;
    yield {
      provider: "aws",
      service,
      skuId: r["RateCode"] || r["SKU"] || "",
      description: (spec.describe?.(r) ?? r["PriceDescription"] ?? "").trim(),
      region,
      unit: r["Unit"] ?? "",
      unitPrice: price,
      currency: r["Currency"] || "USD",
      source,
      fetchedAt,
    };
  }
}

export async function fetchAws(service: string, region: string, fetchFn: typeof fetch = fetch): Promise<Sku[]> {
  const url = awsUrl(service, region);
  const res = await fetchFn(url);
  if (!res.ok || !res.body) throw new Error(`aws ${service}/${region}: HTTP ${res.status}`);
  const out: Sku[] = [];
  for await (const s of awsSkusFromLines(service, region, lines(res.body), new Date().toISOString(), url)) out.push(s);
  return out;
}
