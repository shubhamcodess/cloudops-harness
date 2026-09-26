import type {
  Architecture,
  Candidate,
  Provider,
  RepoProfile,
  Requirements,
  Sku,
} from "@smc/contracts";
import type { PriceBook, PriceQuery } from "./pricebook.js";
import { allowedRegions } from "./residency.js";
import { complianceCostDeltaPct } from "./residency.js";
import { region, worstRttMs, type RegionInfo } from "./regions.js";

const HOURS_PER_MONTH = 730;
const SEC_PER_MONTH = 30 * 86400;

// Sizing model (documented, coarse):
// - each request ~200 ms CPU on ~512 MB memory
// - 1 vCPU handles ~50 rps (~20 ms CPU per req + overhead)
// - 50% headroom on peak
// - min 2 instances for HA on non-serverless
const VCPU_RPS_CAPACITY = 50;
const REQ_CPU_SEC = 0.2;
const REQ_MEM_GB = 0.5;

interface SizedContainer {
  instances: number;
  vcpuPerInstance: number;
  memGbPerInstance: number;
}

export function sizeContainer(peakRps: number, vcpuPerInstance = 2): SizedContainer {
  const vcpuNeeded = Math.max(1, Math.ceil((peakRps / VCPU_RPS_CAPACITY) * 1.5));
  const instances = Math.max(2, Math.ceil(vcpuNeeded / vcpuPerInstance));
  return { instances, vcpuPerInstance, memGbPerInstance: vcpuPerInstance * 2 };
}

const LLM_PRICES: Record<string, number> = {
  "gpt-4o-mini": 0.6, "gpt-4o": 5, "claude-3-5-sonnet": 6, "claude-3-5-haiku": 1, "claude-3-opus": 30, default: 3,
};

function llmMonthlyUsd(req: Requirements): { line: number; assumption: string } | undefined {
  if (!req.llmTokensPerDay || req.llmTokensPerDay <= 0) return undefined;
  const key = (req.llmModel ?? "default").toLowerCase();
  const price = LLM_PRICES[key] ?? LLM_PRICES.default!;
  const monthly = (req.llmTokensPerDay / 1_000_000) * 30 * price;
  return {
    line: monthly,
    assumption: `LLM cost from static table: ${key} @ $${price}/1M tokens (blended 3:1 in:out); tokens/day=${req.llmTokensPerDay}`,
  };
}

// Plausible unit-price bounds per category (USD, in the *natural* unit of the line).
// A line whose effective unit price falls outside its bound is flagged sanity-failed.
type Category =
  | "vcpu-hour" | "memory-gb-hour" | "egress-gb" | "lb-hour" | "cluster-hour"
  | "storage-gb-month" | "db-vcpu-hour" | "db-memory-gb-hour" | "db-storage-gb-month" | "db-instance-hour"
  | "requests-1m" | "gb-second" | "misc";

const BOUNDS: Partial<Record<Category, [number, number]>> = {
  "vcpu-hour": [0.005, 0.15],
  "memory-gb-hour": [0.0005, 0.02],
  "egress-gb": [0.01, 0.20],
  "lb-hour": [0.005, 0.10],
  "cluster-hour": [0.05, 0.50],
  "storage-gb-month": [0.005, 0.05],
  "db-vcpu-hour": [0.005, 0.20],
  "db-memory-gb-hour": [0.0005, 0.03],
  "db-storage-gb-month": [0.05, 0.35],
  "db-instance-hour": [0.01, 2.0],
  "requests-1m": [0.10, 1.00],
  "gb-second": [1e-6, 5e-5],
};

type Spec = Omit<PriceQuery, "provider" | "region"> & {
  label: string;
  category: Category;
  quantity: number;              // in natural unit
  unitLabel: string;             // human natural unit label
  fallbackUnitPrice: number;     // in natural unit
  /** Scale SKU unit price into the line's natural unit price. Default 1. */
  unitScale?: (sku: Sku) => number;
  monthlyUsdOverride?: number;
};

interface Line {
  label: string;
  sku?: Sku;
  quantity: number;
  unit: string;
  monthlyUsd: number;
  effectiveUnitPrice: number;
  category: Category;
}

function priceOne(pb: PriceBook, provider: Provider, r: string, s: Spec): Line {
  const sku = pb.find({ provider, region: r, service: s.service, match: s.match, exclude: s.exclude, unitPattern: s.unitPattern, pick: s.pick });
  const scale = sku && s.unitScale ? s.unitScale(sku) : 1;
  const effectiveUnitPrice = sku ? sku.unitPrice * scale : s.fallbackUnitPrice;
  const monthlyUsd = s.monthlyUsdOverride ?? Math.max(0, s.quantity * effectiveUnitPrice);
  return { label: s.label, sku, quantity: s.quantity, unit: s.unitLabel, monthlyUsd, effectiveUnitPrice, category: s.category };
}

const ARCH_LATENCY_OVERHEAD_MS: Record<Architecture, number> = {
  "aws-lambda": 60, "aws-ecs-fargate": 25, "aws-ec2": 15, "aws-eks": 20, "aws-s3-cloudfront": 10,
  "gcp-cloud-run": 40, "gcp-gke-autopilot": 20, "gcp-gce": 15, "gcp-gcs-cdn": 10, "azure-container-apps": 40,
};
const ARCH_AVAILABILITY: Record<Architecture, number> = {
  "aws-lambda": 0.9995, "aws-ecs-fargate": 0.999, "aws-ec2": 0.995, "aws-eks": 0.9995, "aws-s3-cloudfront": 0.9999,
  "gcp-cloud-run": 0.9995, "gcp-gke-autopilot": 0.9995, "gcp-gce": 0.995, "gcp-gcs-cdn": 0.9999, "azure-container-apps": 0.999,
};

function architecturesFor(profile: RepoProfile): Architecture[] {
  const t = profile.workloadType;
  if (t === "static-site") return ["aws-s3-cloudfront", "gcp-gcs-cdn"];
  const compute: Architecture[] = [
    "aws-lambda", "aws-ecs-fargate", "aws-ec2",
    "gcp-cloud-run", "gcp-gke-autopilot", "gcp-gce",
    "azure-container-apps",
  ];
  if (t === "microservices") compute.push("aws-eks");
  return compute;
}

const providerOf = (a: Architecture): Provider => a.startsWith("aws-") ? "aws" : a.startsWith("gcp-") ? "gcp" : "azure";

function egressGb(req: Requirements): number {
  const rps = req.avgRps ?? req.peakRps / 2;
  return (rps * SEC_PER_MONTH * 50_000) / 1e9;
}
const storageGb = (p: RepoProfile) => 10 + p.datastores.length * 5;

// ---------- Per-provider line-spec factories ----------

// Common negatives to exclude non-general-purpose or non-on-demand SKUs.
const GCP_COMPUTE_EXCLUDE = /gpu|nvidia|tpu|accelerator|preemptible|spot|committed|commitment|reserved|sole tenancy|windows|dws|calendar|extended support|sole-tenant|micro instance|small instance/i;
const GCP_INTERNAL_EXCLUDE = /internal|cross[-\s]?regional|intelligence|premium|extension|armor|passthrough|proxy|cloud nat|vpn|inter[-\s]?region|inter[-\s]region|carrier|peering|committed|commitment|reserved|autopilot accelerator|scale-out/i;

function specsGce(r: string, sized: SizedContainer): Spec[] {
  const vcpuHours = sized.instances * sized.vcpuPerInstance * HOURS_PER_MONTH;
  const memGbHours = sized.instances * sized.memGbPerInstance * HOURS_PER_MONTH;
  return [
    {
      label: "GCE vCPU-hours", category: "vcpu-hour",
      service: "gce",
      match: [/^N4 Instance Core/i, /^N2 Instance Core/i, /^E2 Instance Core/i, /^C4 Instance Core/i],
      exclude: GCP_COMPUTE_EXCLUDE,
      unitPattern: /^h$/i,
      quantity: vcpuHours, unitLabel: "vCPU-hour", fallbackUnitPrice: 0.035,
    },
    {
      label: "GCE memory GB-hours", category: "memory-gb-hour",
      service: "gce",
      match: [/^N4 Instance Ram/i, /^N2 Instance Ram/i, /^E2 Instance Ram/i, /^C4 Instance Ram/i],
      exclude: GCP_COMPUTE_EXCLUDE,
      unitPattern: /^GiBy\.h$/i,
      quantity: memGbHours, unitLabel: "GB-hour", fallbackUnitPrice: 0.005,
    },
  ];
}

function specsGkeAutopilot(r: string, sized: SizedContainer): Spec[] {
  const vcpuHours = sized.instances * sized.vcpuPerInstance * HOURS_PER_MONTH;
  const memGbHours = sized.instances * sized.memGbPerInstance * HOURS_PER_MONTH;
  return [
    {
      // Pod mCPU Requests: price is per milli-CPU per hour; scale x1000 to get per vCPU-hour.
      label: "GKE Autopilot vCPU-hours", category: "vcpu-hour",
      service: "gke",
      match: [/^Autopilot Pod mCPU Requests/i],
      exclude: /accelerator|premium|scale-out|balanced|extended/i,
      unitPattern: /^h$/i,
      quantity: vcpuHours, unitLabel: "vCPU-hour", fallbackUnitPrice: 0.049,
      unitScale: () => 1000,
    },
    {
      label: "GKE Autopilot memory GB-hours", category: "memory-gb-hour",
      service: "gke",
      match: [/^Autopilot Pod Memory Requests/i],
      exclude: /accelerator|premium|scale-out|balanced|extended/i,
      unitPattern: /^GiBy\.h$/i,
      quantity: memGbHours, unitLabel: "GB-hour", fallbackUnitPrice: 0.0055,
    },
    {
      label: "GKE cluster management", category: "cluster-hour",
      service: "gke",
      match: [/^Autopilot Kubernetes Clusters/i, /^Regional Kubernetes Clusters/i, /^Zonal Kubernetes Clusters/i],
      exclude: /extended period/i,
      unitPattern: /^h$/i,
      quantity: HOURS_PER_MONTH, unitLabel: "hour", fallbackUnitPrice: 0.10,
    },
  ];
}

function specsCloudRun(r: string, req: Requirements): Spec[] {
  const rps = req.avgRps ?? req.peakRps / 2;
  const monthlyReq = rps * SEC_PER_MONTH;
  const vcpuSec = monthlyReq * REQ_CPU_SEC;                      // vCPU-seconds
  const gbSec = monthlyReq * REQ_CPU_SEC * REQ_MEM_GB;           // GB-seconds
  return [
    {
      label: "Cloud Run requests", category: "requests-1m",
      service: "cloudrun",
      match: [/^Requests\b/i],
      exclude: /min instance|inter region|internet|gpu|carrier|peering/i,
      unitPattern: /^count$/i,
      quantity: monthlyReq / 1_000_000, unitLabel: "1M-req", fallbackUnitPrice: 0.4,
      // Price is per request; scale x1e6 to per-million.
      unitScale: () => 1_000_000,
      pick: (s) => s.unitPrice > 0 ? 0 : 1, // prefer non-free-tier SKU
    },
    {
      label: "Cloud Run vCPU-seconds", category: "gb-second",
      service: "cloudrun",
      match: [/^Services CPU \(Request-based billing\)/i],
      exclude: /min instance|instance-based|gpu|jobs|worker/i,
      unitPattern: /^s$/i,
      quantity: vcpuSec, unitLabel: "vCPU-s", fallbackUnitPrice: 2.4e-5,
    },
    {
      label: "Cloud Run memory GB-seconds", category: "gb-second",
      service: "cloudrun",
      match: [/^Services Memory \(Request-based billing\)/i],
      exclude: /min instance|instance-based|gpu|jobs|worker/i,
      unitPattern: /^GiBy\.s$/i,
      quantity: gbSec, unitLabel: "GB-s", fallbackUnitPrice: 2.5e-6,
    },
  ];
}

function specsFargate(sized: SizedContainer): Spec[] {
  const vcpuHours = sized.instances * sized.vcpuPerInstance * HOURS_PER_MONTH;
  const memGbHours = sized.instances * sized.memGbPerInstance * HOURS_PER_MONTH;
  return [
    {
      label: "Fargate vCPU-hours", category: "vcpu-hour",
      service: "fargate",
      match: [/Fargate.*vCPU/i, /vCPU.*Fargate/i], exclude: /spot|windows|arm|savings/i,
      quantity: vcpuHours, unitLabel: "vCPU-hour", fallbackUnitPrice: 0.04,
    },
    {
      label: "Fargate memory GB-hours", category: "memory-gb-hour",
      service: "fargate",
      match: [/Fargate.*Memory/i, /Memory.*Fargate/i, /GB[- ]?hour/i], exclude: /spot|windows|arm|savings/i,
      quantity: memGbHours, unitLabel: "GB-hour", fallbackUnitPrice: 0.0045,
    },
  ];
}

function specsEc2(sized: SizedContainer): Spec[] {
  const instHours = sized.instances * HOURS_PER_MONTH;
  return [
    {
      label: "EC2 instance-hours", category: "db-instance-hour",
      service: "ec2",
      match: [/t3\.medium|m5\.large|m6i\.large|t4g\.medium/i],
      exclude: /reserved|dedicated|spot|windows|sql|byol/i,
      quantity: instHours, unitLabel: "instance-hour", fallbackUnitPrice: 0.05,
      pick: (s) => s.unitPrice, // cheapest matching family
    },
  ];
}

function specsAwsAlb(): Spec[] {
  return [
    {
      label: "Application Load Balancer", category: "lb-hour",
      service: "loadbalancer",
      match: [/Application LoadBalancer-hour/i],
      exclude: /trust store|LCU/i,
      unitPattern: /^Hrs$/i,
      quantity: HOURS_PER_MONTH, unitLabel: "hour", fallbackUnitPrice: 0.025,
    },
  ];
}

function specsGcpGlbLb(): Spec[] {
  return [
    {
      label: "External Application LB forwarding rule", category: "lb-hour",
      service: "loadbalancer",
      match: [/Cloud Load Balancer Forwarding Rule Minimum Global\b/i, /Cloud Load Balancer Forwarding Rule Minimum for /i],
      exclude: GCP_INTERNAL_EXCLUDE,
      unitPattern: /^h$/i,
      quantity: HOURS_PER_MONTH, unitLabel: "hour", fallbackUnitPrice: 0.025,
    },
  ];
}

function specsEgress(provider: Provider, req: Requirements): Spec {
  const eg = egressGb(req);
  if (provider === "aws") {
    return {
      label: "Egress (Internet)", category: "egress-gb",
      service: "network",
      match: [/first 10 TB \/ month data transfer out/i],
      exclude: /reverse|inter-region/i,
      unitPattern: /^GB$/i,
      quantity: eg, unitLabel: "GB", fallbackUnitPrice: 0.09,
    };
  }
  if (provider === "gcp") {
    return {
      label: "Egress (Internet)", category: "egress-gb",
      service: "network", // -> compute cache in adapter
      match: [/Network Internet Data Transfer Out from EMEA to EMEA/i,
              /Network Internet Data Transfer Out from EMEA to Americas/i,
              /Network Internet Data Transfer Out from Belgium to /i],
      exclude: /vpn|inter region|inter-region|standard data transfer out to internet from|reverse|carrier|peering|cdn|intelligence/i,
      unitPattern: /^GiBy$/i,
      quantity: eg, unitLabel: "GB", fallbackUnitPrice: 0.12,
      pick: (s) => s.unitPrice > 0 ? s.unitPrice : 1e9, // avoid 0-priced free/inter-region matches
    };
  }
  return {
    label: "Egress (Internet)", category: "egress-gb",
    service: "network",
    match: [/egress|data-out|internet/i], exclude: /reverse|inter-region/i,
    quantity: eg, unitLabel: "GB", fallbackUnitPrice: 0.09,
  };
}

function specsCloudSqlPostgres(): Spec[] {
  const sizedVcpu = 2, sizedRam = 8, storage = 50; // small zonal instance
  return [
    {
      label: "Cloud SQL Postgres vCPU", category: "db-vcpu-hour",
      service: "cloudsql",
      match: [/^Cloud SQL for PostgreSQL: Zonal - vCPU/i],
      exclude: /extended support|fdc trial|regional|enterprise plus|developer/i,
      unitPattern: /^h$/i,
      quantity: sizedVcpu * HOURS_PER_MONTH, unitLabel: "vCPU-hour", fallbackUnitPrice: 0.0413,
    },
    {
      label: "Cloud SQL Postgres RAM", category: "db-memory-gb-hour",
      service: "cloudsql",
      match: [/^Cloud SQL for PostgreSQL: Zonal - RAM/i],
      exclude: /extended support|fdc trial|regional|enterprise plus|developer/i,
      unitPattern: /^GiBy\.h$/i,
      quantity: sizedRam * HOURS_PER_MONTH, unitLabel: "GB-hour", fallbackUnitPrice: 0.007,
    },
    {
      label: "Cloud SQL Postgres storage", category: "db-storage-gb-month",
      service: "cloudsql",
      match: [/^Cloud SQL for PostgreSQL:.*Standard Storage/i, /^Cloud SQL for PostgreSQL:.*SSD/i],
      exclude: /extended support|fdc trial|regional|enterprise plus|developer|hyperdisk iops|hyperdisk throughput|data cache/i,
      unitPattern: /^GiBy\.mo$/i,
      quantity: storage, unitLabel: "GB-month", fallbackUnitPrice: 0.17,
      pick: (s) => s.unitPrice > 0 ? s.unitPrice : 1e9,
    },
  ];
}

function specsRdsPostgres(): Spec[] {
  return [
    {
      label: "RDS PostgreSQL instance", category: "db-instance-hour",
      service: "rds",
      match: [/db\.t4g\.small PostgreSQL Single-AZ/i, /db\.t3\.small PostgreSQL Single-AZ/i, /db\.t4g\.medium PostgreSQL Single-AZ/i],
      exclude: /multi-az|reserved|iops|storage/i,
      unitPattern: /^Hrs$/i,
      quantity: HOURS_PER_MONTH, unitLabel: "hour", fallbackUnitPrice: 0.035,
      pick: (s) => s.unitPrice,
    },
  ];
}

// ---------- Builders ----------

interface BuildOpts { assumptions: string[]; deltaPct: number; sanityFailed: string[] }

function buildServerless(arch: Architecture, r: RegionInfo, profile: RepoProfile, req: Requirements, pb: PriceBook, opts: BuildOpts): Candidate {
  const provider = r.provider;
  const rps = req.avgRps ?? req.peakRps / 2;
  const monthlyReq = rps * SEC_PER_MONTH;
  const specs: Spec[] =
    arch === "gcp-cloud-run" ? specsCloudRun(r.id, req) :
    arch === "aws-lambda" ? [
      { label: "Lambda requests", category: "requests-1m", service: "lambda",
        match: [/AWS Lambda - Total Requests - EU/i, /AWS Lambda - Total Requests -/i],
        exclude: /ARM|Edge|Managed-Instances|Provisioned|Free Tier/i,
        unitPattern: /^Requests?$/i,
        quantity: monthlyReq / 1_000_000, unitLabel: "1M-req", fallbackUnitPrice: 0.2,
        unitScale: () => 1_000_000,
      },
      { label: "Lambda GB-s", category: "gb-second", service: "lambda",
        match: [/AWS Lambda - Total Compute -/i],
        exclude: /ARM|Edge|Provisioned|Free Tier/i,
        unitPattern: /Lambda-GB-Second/i,
        quantity: monthlyReq * REQ_CPU_SEC * REQ_MEM_GB, unitLabel: "GB-s", fallbackUnitPrice: 1.6667e-5,
      },
    ] : []; // azure container apps handled minimally
  opts.assumptions.push(`Serverless sized from avgRps=${rps.toFixed(2)}: ${Math.round(monthlyReq).toLocaleString()} req/mo`);
  return finalizeCandidate(arch, r, req, profile, pb, specs, opts);
}

function buildContainerized(arch: Architecture, r: RegionInfo, profile: RepoProfile, req: Requirements, pb: PriceBook, opts: BuildOpts): Candidate {
  const sized = sizeContainer(req.peakRps);
  let specs: Spec[] = [];
  if (arch === "aws-ecs-fargate" || arch === "aws-eks") {
    specs = [...specsFargate(sized), ...specsAwsAlb()];
    if (arch === "aws-eks") specs.push({
      label: "EKS cluster", category: "cluster-hour", service: "eks",
      match: [/EKS/i], exclude: /Fargate/i, quantity: HOURS_PER_MONTH, unitLabel: "hour", fallbackUnitPrice: 0.10,
    });
  } else if (arch === "aws-ec2") {
    specs = [...specsEc2(sized), ...specsAwsAlb()];
  } else if (arch === "gcp-gke-autopilot") {
    specs = [...specsGkeAutopilot(r.id, sized), ...specsGcpGlbLb()];
  } else if (arch === "gcp-gce") {
    specs = [...specsGce(r.id, sized), ...specsGcpGlbLb()];
  }
  opts.assumptions.push(`Container sized for peakRps=${req.peakRps}: ${sized.instances}x ${sized.vcpuPerInstance}vCPU/${sized.memGbPerInstance}GB (min 2 for HA); ${sized.instances * sized.vcpuPerInstance * HOURS_PER_MONTH} vCPU-hours/mo`);
  return finalizeCandidate(arch, r, req, profile, pb, specs, opts);
}

function buildStatic(arch: Architecture, r: RegionInfo, profile: RepoProfile, req: Requirements, pb: PriceBook, opts: BuildOpts): Candidate {
  const provider = r.provider;
  const egress = egressGb(req);
  const storage = storageGb(profile);
  const specs: Spec[] = provider === "aws" ? [
    { label: "S3 storage", category: "storage-gb-month", service: "s3",
      match: [/first 50 TB \/ month of storage used/i], exclude: /Table Buckets|Requests|Data Retrieval/i,
      unitPattern: /^GB-Mo$/i, quantity: storage, unitLabel: "GB-month", fallbackUnitPrice: 0.023 },
    { label: "CloudFront egress", category: "egress-gb", service: "cloudfront",
      match: [/CloudFront Europe.*first 10 TB \/ month data transfer out/i],
      exclude: /Requests|Field-Level|Invalidation|Origin/i,
      unitPattern: /^GB$/i, quantity: egress, unitLabel: "GB", fallbackUnitPrice: 0.085 },
  ] : [
    { label: "Cloud Storage standard", category: "storage-gb-month", service: "gcs",
      match: [/^Standard Storage Belgium/i, /^Regional Standard Storage/i, /^Standard Storage/i],
      exclude: /Autoclass|Coldline|Nearline|Archive|Dual-Region|Multi-Region|Operations|Retrieval|Class A|Class B|HNS/i,
      unitPattern: /^GiBy\.mo$/i, quantity: storage, unitLabel: "GB-month", fallbackUnitPrice: 0.020 },
    { label: "Cloud CDN egress", category: "egress-gb", service: "cloudcdn",
      match: [/Cacheable Data Processing/i, /Cloud CDN.*Cache Egress/i],
      exclude: GCP_INTERNAL_EXCLUDE, unitPattern: /^GiBy$/i,
      quantity: egress, unitLabel: "GB", fallbackUnitPrice: 0.08 },
  ];
  opts.assumptions.push(`Static site: ${storage} GB storage, ${egress.toFixed(1)} GB CDN egress/mo`);
  return finalizeCandidate(arch, r, req, profile, pb, specs, opts);
}

function finalizeCandidate(arch: Architecture, r: RegionInfo, req: Requirements, profile: RepoProfile, pb: PriceBook, specs: Spec[], opts: BuildOpts): Candidate {
  // Egress (non-static)
  if (arch !== "aws-s3-cloudfront" && arch !== "gcp-gcs-cdn") {
    specs.push(specsEgress(r.provider, req));
  }
  // Datastore lines
  for (const ds of profile.datastores) {
    if (ds === "postgres" || ds === "mysql") {
      if (r.provider === "gcp") specs.push(...specsCloudSqlPostgres());
      else if (r.provider === "aws") specs.push(...specsRdsPostgres());
      else specs.push({
        label: `Managed ${ds}`, category: "db-instance-hour", service: "azuresql",
        match: [new RegExp(ds, "i")], quantity: HOURS_PER_MONTH, unitLabel: "hour", fallbackUnitPrice: 0.05,
      });
    } else if (ds === "redis") {
      specs.push({
        label: "Managed redis", category: "db-instance-hour",
        service: r.provider === "aws" ? "elasticache" : r.provider === "gcp" ? "memorystore" : "azurecache",
        match: [/redis|cache/i], quantity: HOURS_PER_MONTH, unitLabel: "hour", fallbackUnitPrice: 0.03,
      });
    } else if (ds === "s3") {
      specs.push({
        label: "Object storage", category: "storage-gb-month",
        service: r.provider === "aws" ? "s3" : r.provider === "gcp" ? "gcs" : "blob",
        match: [/first 50 TB \/ month of storage used/i, /^Standard Storage/i],
        exclude: /Table Buckets|Requests|Autoclass|Coldline|Nearline|Archive|Operations/i,
        quantity: storageGb(profile), unitLabel: "GB-month", fallbackUnitPrice: 0.023,
      });
    }
  }

  // Price lines and sanity check.
  const lines: Line[] = specs.map((s) => priceOne(pb, r.provider, r.id, s));
  const missing: string[] = [];
  for (let i = 0; i < lines.length; i++) if (!lines[i]!.sku) missing.push(specs[i]!.label);
  for (const m of missing) opts.assumptions.push(`Price SKU missing for "${m}"; used fallback unit price`);

  for (const l of lines) {
    const b = BOUNDS[l.category];
    if (!b) continue;
    const p = l.effectiveUnitPrice;
    if (p < b[0] || p > b[1]) {
      opts.sanityFailed.push(l.label);
      opts.assumptions.push(`price-sanity-failed: ${l.label} @ $${p.toPrecision(3)}/${l.unit} outside [${b[0]}, ${b[1]}] (sku="${l.sku?.description ?? "fallback"}")`);
    }
  }

  // LLM tokens
  const llm = llmMonthlyUsd(req);
  if (llm) {
    lines.push({
      label: "LLM tokens", quantity: (req.llmTokensPerDay ?? 0) * 30 / 1_000_000,
      unit: "M-tokens", monthlyUsd: llm.line, effectiveUnitPrice: 0, category: "misc",
    });
    opts.assumptions.push(llm.assumption);
  }

  let base = lines.reduce((a, l) => a + l.monthlyUsd, 0);
  if (opts.deltaPct > 0) {
    const uplift = base * (opts.deltaPct / 100);
    base += uplift;
    opts.assumptions.push(`Compliance uplift +${opts.deltaPct}% for ${req.compliance.join("+") || "controls"}: +$${uplift.toFixed(2)}`);
  }
  const monthlyUsd = round2(base);

  const rtt = worstRttMs(req.userRegions, r);
  const estLatencyP95Ms = rtt + ARCH_LATENCY_OVERHEAD_MS[arch];
  const estAvailability = ARCH_AVAILABILITY[arch];

  if (profile.ai.needsSandbox) {
    opts.assumptions.push("needsSandbox=true: run generated code in an isolated sandbox (Firecracker/gVisor/Fly Machines); do not use plain lambda-only");
  }

  const meets = {
    latency: estLatencyP95Ms <= req.latencyP95Ms,
    availability: estAvailability >= req.availabilityTarget,
    residency: !isNonResidencyRegion(req, r),
    budget: req.monthlyBudgetUsd == null ? true : monthlyUsd <= req.monthlyBudgetUsd,
  };

  return {
    id: `${arch}:${r.id}`,
    provider: r.provider,
    architecture: arch,
    region: r.id,
    lines: lines.map(({ label, sku, quantity, unit, monthlyUsd }) => ({ label, sku, quantity, unit, monthlyUsd })),
    monthlyUsd,
    estLatencyP95Ms,
    estAvailability,
    meets,
    assumptions: [...opts.assumptions],
  };
}

function isNonResidencyRegion(req: Requirements, r: RegionInfo): boolean {
  if (req.dataResidency === "none") return false;
  return !allowedRegions(req, r.provider).some((x) => x.id === r.id);
}

function round2(n: number) { return Math.round(n * 100) / 100; }

export function buildCandidates(profile: RepoProfile, req: Requirements, prices: PriceBook): Candidate[] {
  const archs = architecturesFor(profile);
  const out: Candidate[] = [];
  const deltaPct = complianceCostDeltaPct(req);

  for (const arch of archs) {
    const provider = providerOf(arch);
    if (!req.allowedProviders.includes(provider)) continue;
    if (profile.ai.needsSandbox && arch === "aws-lambda") continue;

    for (const r of allowedRegions(req, provider)) {
      const opts: BuildOpts = { assumptions: [], deltaPct, sanityFailed: [] };
      let candidate: Candidate;
      if (arch === "aws-s3-cloudfront" || arch === "gcp-gcs-cdn") candidate = buildStatic(arch, r, profile, req, prices, opts);
      else if (arch === "aws-lambda" || arch === "gcp-cloud-run" || arch === "azure-container-apps") candidate = buildServerless(arch, r, profile, req, prices, opts);
      else candidate = buildContainerized(arch, r, profile, req, prices, opts);
      out.push(candidate);
    }
  }

  out.sort((a, b) => a.architecture.localeCompare(b.architecture) || a.region.localeCompare(b.region));
  return out;
}

export { region };
