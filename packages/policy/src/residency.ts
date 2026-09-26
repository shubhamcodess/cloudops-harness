import type { Provider, Requirements, RepoProfile, Candidate } from "@smc/contracts";
import { REGIONS, region, regionsByProvider, type RegionInfo } from "./regions.js";

export type Severity = "info" | "warn" | "fail";
export interface Finding { rule: string; severity: Severity; message: string }

const EU_GEOS = new Set(["eu"]);

/** Regions that satisfy a residency requirement for compute/storage/backup/replicas. */
export function allowedRegions(req: Requirements, provider: Provider): RegionInfo[] {
  const all = regionsByProvider(provider);
  switch (req.dataResidency) {
    case "none":
      return all;
    case "eu":
      return all.filter((r) => EU_GEOS.has(r.geo));
    case "us":
      return all.filter((r) => r.geo === "us");
    case "in":
      return all.filter((r) => r.geo === "in");
    case "uk":
      return all.filter((r) => r.geo === "uk");
  }
}

/** True if a region violates residency for storage/compute/backups/replicas. */
export function isNonResident(req: Requirements, r: RegionInfo): boolean {
  if (req.dataResidency === "none") return false;
  return !allowedRegions(req, r.provider).some((x) => x.id === r.id);
}

/**
 * Deterministic compliance report over a chosen candidate.
 * Not legal advice; flags high-signal issues so a human can review.
 */
export function complianceReport(req: Requirements, profile: RepoProfile, candidate: Candidate): Finding[] {
  const out: Finding[] = [];
  const chosen = region(candidate.provider, candidate.region);
  const isGdpr = req.compliance.includes("gdpr") || req.dataResidency === "eu";
  const hasPii = profile.pii.length > 0 || req.dataClasses.includes("pii");
  const hasSpecial = req.dataClasses.includes("special-category");

  if (!chosen) {
    out.push({ rule: "region.unknown", severity: "fail", message: `Region ${candidate.region} not in static tables` });
    return out;
  }

  if (isNonResident(req, chosen)) {
    out.push({
      rule: "residency.region",
      severity: "fail",
      message: `Compute/storage in ${chosen.id} (${chosen.geo}) violates residency=${req.dataResidency}`,
    });
  }

  if (isGdpr && chosen.geo !== "eu") {
    out.push({
      rule: "residency.egress",
      severity: "warn",
      message: `Non-EU egress from ${chosen.id}: personal data may cross borders — review transfer mechanism (SCCs/DPF)`,
    });
  }

  if (hasPii && profile.pii.length > 0) {
    out.push({
      rule: "pii.in-code",
      severity: "warn",
      message: `PII signals detected in code (${profile.pii.length}); confirm redaction and access controls`,
    });
  }

  if (hasSpecial) {
    out.push({
      rule: "data.special-category",
      severity: "warn",
      message: "Special-category data present: Art.9 GDPR conditions must be met (explicit consent or lawful basis)",
    });
  }

  // Cross-region replication: any replica/backup outside residency is a fail under strict residency.
  if (req.dataResidency !== "none") {
    const inResidency = allowedRegions(req, candidate.provider).some((r) => r.id === chosen.id);
    if (!inResidency) {
      out.push({
        rule: "replication.cross-region",
        severity: "fail",
        message: `Cross-region replication to ${chosen.geo} not permitted under residency=${req.dataResidency}`,
      });
    }
  }

  // Logging/backups must stay in residency; we cannot see actual config, warn to verify.
  if (req.dataResidency !== "none") {
    out.push({
      rule: "logs-backups.location",
      severity: "info",
      message: `Verify logs and backups are pinned to ${chosen.geo} (managed services can default elsewhere)`,
    });
  }

  // Encryption is table-stakes on all three clouds; flag as info to confirm.
  out.push({ rule: "encryption.rest", severity: "info", message: "Enable at-rest encryption with customer-managed keys where practical" });
  out.push({ rule: "encryption.transit", severity: "info", message: "Enforce TLS 1.2+ end-to-end; disable plaintext protocols" });

  if (isGdpr) {
    out.push({
      rule: "subprocessor.review",
      severity: "info",
      message: "Review sub-processor list and international transfer mechanism (SCCs, adequacy) — not legal advice",
    });
  }

  return out;
}

/**
 * Rough uplift on compute/storage cost for meeting compliance controls
 * (CMK, dedicated tenancy hints, cross-AZ, extra audit logging).
 */
export function complianceCostDeltaPct(req: Requirements): number {
  let pct = 0;
  if (req.compliance.includes("gdpr")) pct += 2;
  if (req.compliance.includes("soc2")) pct += 3;
  if (req.compliance.includes("hipaa")) pct += 8;
  if (req.compliance.includes("pci")) pct += 8;
  if (req.dataClasses.includes("special-category")) pct += 3;
  return pct;
}

// Re-export for tests
export { REGIONS };
