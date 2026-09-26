import { resolve } from "node:path";
import { RunStore } from "./store.js";
import { makeTools, memoryPriceBook } from "./tools.js";
import type { Sku } from "@smc/contracts";

// Small hand-crafted price book so the demo runs without network / API keys.
function fakeBook() {
  const now = new Date().toISOString();
  const mk = (o: Partial<Sku> & Pick<Sku, "provider" | "service" | "skuId" | "description" | "region" | "unit" | "unitPrice">): Sku => ({
    currency: "USD", source: "fake", fetchedAt: now, ...o,
  });
  return memoryPriceBook([
    mk({ provider: "aws", service: "fargate", skuId: "fargate-vcpu", description: "AWS Fargate vCPU per hour", region: "eu-west-1", unit: "hour", unitPrice: 0.04 }),
    mk({ provider: "aws", service: "fargate", skuId: "fargate-mem", description: "AWS Fargate Memory GB-hour", region: "eu-west-1", unit: "hour", unitPrice: 0.0045 }),
    mk({ provider: "aws", service: "lambda", skuId: "lambda-req", description: "AWS Lambda requests", region: "eu-west-1", unit: "count", unitPrice: 2e-7 }),
    mk({ provider: "aws", service: "lambda", skuId: "lambda-gbs", description: "AWS Lambda GB-second", region: "eu-west-1", unit: "second", unitPrice: 1.66e-5 }),
    mk({ provider: "aws", service: "ec2", skuId: "ec2-t3med", description: "EC2 t3.medium on-demand", region: "eu-west-1", unit: "hour", unitPrice: 0.0464 }),
    mk({ provider: "aws", service: "alb", skuId: "alb-hour", description: "AWS ALB per hour", region: "eu-west-1", unit: "hour", unitPrice: 0.0225 }),
    mk({ provider: "aws", service: "data-transfer", skuId: "aws-egress", description: "AWS data transfer out", region: "eu-west-1", unit: "GB", unitPrice: 0.09 }),
    mk({ provider: "gcp", service: "cloud-run", skuId: "cr-req", description: "Requests", region: "europe-west1", unit: "count", unitPrice: 4e-7 }),
    mk({ provider: "gcp", service: "cloud-run", skuId: "cr-cpu", description: "Services CPU (Request-based billing)", region: "europe-west1", unit: "s", unitPrice: 2.4e-5 }),
    mk({ provider: "gcp", service: "cloud-run", skuId: "cr-mem", description: "Services Memory (Request-based billing)", region: "europe-west1", unit: "GiBy.s", unitPrice: 2.5e-6 }),
    mk({ provider: "gcp", service: "compute", skuId: "gce-cpu", description: "N2 Instance Core", region: "europe-west1", unit: "h", unitPrice: 0.031 }),
    mk({ provider: "gcp", service: "compute", skuId: "gce-mem", description: "N2 Instance Ram", region: "europe-west1", unit: "GiBy.h", unitPrice: 0.0042 }),
    mk({ provider: "gcp", service: "networking", skuId: "gcp-egress", description: "Cloud CDN egress", region: "europe-west1", unit: "GB", unitPrice: 0.08 }),
  ]);
}

async function main() {
  const repo = resolve(process.argv[2] ?? "fixtures/node-api");
  const store = new RunStore({ root: resolve(process.cwd(), ".data/runs-demo") });
  const tools = makeTools(store, { priceBook: fakeBook() });

  const run = await tools.start_run({ source: repo, appName: "demo-node-api" });
  console.log("start_run:", run);

  const profile = await tools.analyze_repo({ runId: run.runId });
  console.log("analyze_repo:", profile);

  const answers = {
    dataResidency: "eu",
    availabilityTarget: 0.99,
    latencyP95Ms: 250,
    peakRps: 200,
    userRegions: ["eu-west"],
    allowedProviders: ["aws", "gcp"],
    dataClasses: ["none"],
    compliance: [],
  };
  const sub = tools.submit_answers({ runId: run.runId, answers });
  console.log("submit_answers:", sub);

  const pd = await tools.price_and_decide({ runId: run.runId });
  console.log("price_and_decide:", pd);

  const gen = tools.generate_artifacts({ runId: run.runId });
  console.log("generate_artifacts:", { fileCount: gen.fileCount, sample: gen.files.slice(0, 6) });

  const led = tools.get_ledger({ runId: run.runId });
  console.log("ledger verify:", led.verify, "entries:", led.entries.length);
}

main().catch((e) => { console.error(e); process.exit(1); });
