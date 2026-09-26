import { analyze } from "./analyze";

const path = process.argv[2] ?? "fixtures/node-api";
const req = {
  latencyP95Ms: 300, availabilityTarget: 0.999, userRegions: ["eu"], peakRps: 200, avgRps: 40,
  dataResidency: "eu" as const, dataClasses: ["pii" as const], compliance: ["gdpr" as const],
  allowedProviders: ["aws" as const, "gcp" as const], monthlyBudgetUsd: 800,
};
const { profile, candidates, decision } = await analyze(path, req);
console.log(profile.workloadType, profile.datastores);
for (const c of candidates) console.log(c.id.padEnd(34), c.region.padEnd(14), `$${c.monthlyUsd.toFixed(0).padStart(5)}`, JSON.stringify(c.meets), c.assumptions.filter((a) => /fallback/i.test(a)).length, "fallbacks");
console.log("CHOSEN", decision.chosenId, decision.rationale.slice(0, 3));
