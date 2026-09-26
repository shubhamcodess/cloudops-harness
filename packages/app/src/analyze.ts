import { detectRepo } from "@smc/detectors";
import { allowedRegions, buildCandidates, decide } from "@smc/policy";
import { loadPriceBook } from "@smc/pricing";
import type { Provider, Requirements } from "@smc/contracts";
import { adaptPriceBook } from "./pricebook-adapter";

export async function analyze(repoPath: string, req: Requirements) {
  const profile = await detectRepo(repoPath);
  const regions: Partial<Record<Provider, string[]>> = {};
  for (const p of req.allowedProviders) regions[p] = allowedRegions(req, p).map((r) => r.id);
  const book = await loadPriceBook({ providers: req.allowedProviders, regions });
  const candidates = buildCandidates(profile, req, adaptPriceBook(book));
  const decision = decide(candidates, req);
  return { profile, candidates, decision };
}
