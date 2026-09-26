import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { Sku } from "@smc/contracts";
import { awsSkusFromLines } from "../src/aws";
import { readCache, writeCache } from "../src/cache";
import { parseCsvLine } from "../src/csv";
import { normalizeAzureItem } from "../src/azure";
import { normalizeGcpSku } from "../src/gcp";
import { gcpApiKey } from "../src/env";
import { loadPriceBook } from "../src/load";
import { createPriceBook } from "../src/pricebook";

const fx = (n: string) => readFile(join(__dirname, "fixtures", n), "utf8");
async function* iter(text: string) {
  yield* text.split("\n");
}
const collect = async <T>(g: AsyncIterable<T>) => {
  const o: T[] = [];
  for await (const x of g) o.push(x);
  return o;
};

describe("csv", () => {
  it("handles quoted commas and escaped quotes", () => {
    expect(parseCsvLine('"a","b, c","say ""hi""",,"e"')).toEqual(["a", "b, c", 'say "hi"', "", "e"]);
  });
});

describe("aws normalization", () => {
  it("ec2 m5.large", async () => {
    const skus = await collect(awsSkusFromLines("ec2", "eu-west-1", iter(await fx("ec2.csv")), "t", "src"));
    expect(skus).toHaveLength(1);
    expect(() => Sku.parse(skus[0])).not.toThrow();
    expect(skus[0]).toMatchObject({ provider: "aws", service: "ec2", region: "eu-west-1", unit: "Hrs" });
    expect(skus[0]!.description).toContain("m5.large");
    expect(skus[0]!.unitPrice).toBeGreaterThan(0.05);
  });
  it("fargate vcpu and memory", async () => {
    const skus = await collect(awsSkusFromLines("fargate", "eu-west-1", iter(await fx("fargate.csv")), "t", "src"));
    expect(skus.map((s) => s.description).join()).toMatch(/Fargate-vCPU-Hours/);
    expect(skus.every((s) => s.unitPrice > 0)).toBe(true);
  });
});

describe("gcp normalization", () => {
  it("converts nanos and filters region", async () => {
    const raw = JSON.parse(await fx("gcp-cloudrun.json")).skus;
    const skus = raw.flatMap((r: never) => normalizeGcpSku(r, "cloud-run", ["europe-west1"], "t", "src"));
    expect(skus).toHaveLength(3);
    const mem = skus.find((s: Sku) => s.description === "Instances Memory in europe-west1");
    expect(mem.unitPrice).toBeCloseTo(1.93e-6, 12);
    expect(normalizeGcpSku(raw[0], "cloud-run", ["nowhere-1"], "t", "src")).toEqual([]);
  });
});

describe("azure normalization", () => {
  it("keeps consumption only", async () => {
    const j = JSON.parse(await fx("azure-vm.json"));
    const skus = j.Items.map((i: never) => normalizeAzureItem(i, "vm", "t", "src")).filter(Boolean);
    expect(skus).toHaveLength(1);
    expect(skus[0]).toMatchObject({ region: "westeurope", unitPrice: 0.115 });
  });
});

describe("pricebook", () => {
  const mk = (description: string, unitPrice: number, unit = "Hrs"): Sku => ({
    provider: "aws", service: "ec2", skuId: description, description, region: "eu-west-1", unit, unitPrice, currency: "USD", source: "s", fetchedAt: "t",
  });
  const pb = createPriceBook([mk("m5.large Linux", 0.1), mk("m5.xlarge Linux", 0.2), mk("gb thing", 1, "GB")]);
  const q = { provider: "aws", service: "EC2", region: "eu-west-1" } as const;
  it("find by string, regexp, unit", () => {
    expect(pb.find({ ...q, match: "m5.large" })?.unitPrice).toBe(0.1);
    expect(pb.findAll({ ...q, match: /^m5\./ })).toHaveLength(2);
    expect(pb.find({ ...q, match: /thing/, unit: "hrs" })).toBeUndefined();
    expect(pb.find({ ...q, region: "us-east-1", match: "m5" })).toBeUndefined();
  });
});

describe("cache", () => {
  const sku = { provider: "aws", service: "ec2", skuId: "x", description: "d", region: "r", unit: "Hrs", unitPrice: 1, currency: "USD", source: "s", fetchedAt: "t" } as Sku;
  it("respects ttl and refresh", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "pricing-"));
    const t0 = Date.parse("2026-01-01T00:00:00Z");
    await writeCache({ cacheDir }, "aws", "ec2", "r", [sku], new Date(t0).toISOString());
    expect(await readCache({ cacheDir, now: () => t0 + 23 * 3600e3 }, "aws", "ec2", "r")).toHaveLength(1);
    expect(await readCache({ cacheDir, now: () => t0 + 25 * 3600e3 }, "aws", "ec2", "r")).toBeUndefined();
    expect(await readCache({ cacheDir, now: () => t0, refresh: true }, "aws", "ec2", "r")).toBeUndefined();
  });
  it("loadPriceBook is offline on cache hit", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "pricing-"));
    await writeCache({ cacheDir }, "aws", "ec2", "r", [sku], new Date().toISOString());
    const fetchFn = vi.fn() as unknown as typeof fetch;
    const pb = await loadPriceBook({ providers: ["aws"], regions: ["r"], services: ["ec2"], cacheDir, fetchFn });
    expect(pb.find({ provider: "aws", service: "ec2", region: "r", match: "d" })).toBeDefined();
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe.skipIf(!process.env.LIVE)("live", () => {
  it("aws + gcp real prices", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "pricing-live-"));
    expect(gcpApiKey()).toBeTruthy();
    const pb = await loadPriceBook({
      providers: ["aws", "gcp"],
      regions: { aws: ["eu-west-1", "us-east-1"], gcp: ["europe-west1"] },
      services: ["ec2", "fargate", "cloud-run"],
      cacheDir,
    });
    for (const region of ["eu-west-1", "us-east-1"]) {
      const m5 = pb.find({ provider: "aws", service: "ec2", region, match: /m5\.large/ });
      expect(m5?.unitPrice).toBeGreaterThan(0.05);
      expect(m5!.unitPrice).toBeLessThan(0.3);
      expect(pb.find({ provider: "aws", service: "fargate", region, match: /Fargate-vCPU-Hours/ })?.unitPrice).toBeGreaterThan(0.02);
    }
    expect(pb.find({ provider: "gcp", service: "cloud-run", region: "europe-west1", match: /CPU/ })?.unitPrice).toBeGreaterThan(0);
  }, 900_000);
});
