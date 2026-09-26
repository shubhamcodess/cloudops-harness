import type { Candidate, Decision, Requirements } from "@smc/contracts";
import { region, worstRttMs } from "./regions.js";

/**
 * Pure & deterministic: same inputs always yield an identical Decision.
 * Hard filters first (residency, latency, availability, budget), then
 * rank surviving candidates by monthlyUsd with documented tie-breakers.
 */
export function decide(candidates: Candidate[], req: Requirements): Decision {
  const rejected: Decision["rejected"] = [];
  const eligible: Candidate[] = [];

  for (const c of candidates) {
    const reasons: string[] = [];
    if (!c.meets.residency) reasons.push(`residency: region ${c.region} violates ${req.dataResidency}`);
    if (!c.meets.latency) reasons.push(`latency: est ${c.estLatencyP95Ms}ms > target ${req.latencyP95Ms}ms`);
    if (!c.meets.availability) reasons.push(`availability: est ${c.estAvailability} < target ${req.availabilityTarget}`);
    if (!c.meets.budget) reasons.push(`budget: $${c.monthlyUsd} > $${req.monthlyBudgetUsd}`);
    const sanity = c.assumptions.filter((a) => a.startsWith("price-sanity-failed:"));
    if (sanity.length) reasons.push(`price-sanity: ${sanity.length} line(s) outside plausible bounds`);
    if (reasons.length) rejected.push({ id: c.id, reason: reasons.join("; ") });
    else eligible.push(c);
  }

  // Tie-breakers (documented, applied in order):
  //   1. lower monthlyUsd wins
  //   2. fewer moving parts (fewer cost lines)
  //   3. closer to user regions (lower RTT)
  //   4. stable id sort for full determinism
  const ranked = [...eligible].sort((a, b) => {
    if (a.monthlyUsd !== b.monthlyUsd) return a.monthlyUsd - b.monthlyUsd;
    if (a.lines.length !== b.lines.length) return a.lines.length - b.lines.length;
    const ra = region(a.provider, a.region);
    const rb = region(b.provider, b.region);
    if (ra && rb) {
      const rttA = worstRttMs(req.userRegions, ra);
      const rttB = worstRttMs(req.userRegions, rb);
      if (rttA !== rttB) return rttA - rttB;
    }
    return a.id.localeCompare(b.id);
  });

  const chosen = ranked[0];
  const rationale: string[] = [];
  if (chosen) {
    rationale.push(`Chose ${chosen.architecture} in ${chosen.region} at $${chosen.monthlyUsd}/mo`);
    rationale.push(`Meets latency (est ${chosen.estLatencyP95Ms}ms <= ${req.latencyP95Ms}ms) and availability (${chosen.estAvailability} >= ${req.availabilityTarget})`);
    if (req.dataResidency !== "none") rationale.push(`Residency ${req.dataResidency} satisfied`);
    if (req.monthlyBudgetUsd) rationale.push(`Under budget $${req.monthlyBudgetUsd}`);
    if (rejected.length) rationale.push(`${rejected.length} candidate(s) rejected; see 'rejected'`);
  } else {
    rationale.push("No candidate meets the hard constraints; see 'rejected' for reasons");
  }

  let savingsVsExistingUsd: number | undefined;
  if (chosen && req.existing) {
    savingsVsExistingUsd = round2(req.existing.monthlyCostUsd - chosen.monthlyUsd);
    rationale.push(
      `Savings vs existing (${req.existing.provider}/${req.existing.region} @ $${req.existing.monthlyCostUsd}): $${savingsVsExistingUsd}/mo`,
    );
  }

  return {
    chosenId: chosen?.id ?? "",
    ranked: ranked.map((c) => ({ id: c.id, score: -c.monthlyUsd, monthlyUsd: c.monthlyUsd })),
    rejected,
    savingsVsExistingUsd,
    rationale,
  };
}

function round2(n: number) { return Math.round(n * 100) / 100; }
