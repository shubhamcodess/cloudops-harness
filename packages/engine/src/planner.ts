import { Requirements, type RepoProfile, type Provider } from "@smc/contracts";

export type QuestionType = "number" | "choice" | "multi" | "text";

export interface Question {
  field: keyof Requirements;
  prompt: string;
  type: QuestionType;
  options?: readonly string[];
  default?: unknown;
  why: string;
  /** No answer is required to proceed; the interview can complete while this stays unset. */
  optional?: boolean;
}

type PartialReq = Partial<Requirements>;

const RESIDENCY_OPTS = ["none", "eu", "us", "in", "uk"] as const;
const PROVIDER_OPTS: readonly Provider[] = ["aws", "gcp", "azure"];
const DATA_CLASS_OPTS = ["pii", "special-category", "payment", "none"] as const;
const COMPLIANCE_OPTS = ["gdpr", "soc2", "hipaa", "pci"] as const;

// Ordered by decision impact: residency & availability gate provider choice;
// latency & peakRps drive sizing; budget filters candidates; regions/providers
// bound the search; existing anchors savings; llm usage only for AI workloads.
const ORDER: Array<keyof Requirements> = [
  "dataResidency",
  "availabilityTarget",
  "latencyP95Ms",
  "peakRps",
  "monthlyBudgetUsd",
  "userRegions",
  "allowedProviders",
  "existing",
  "avgRps",
  "dataClasses",
  "compliance",
  "llmTokensPerDay",
  "llmModel",
];

export function planQuestions(profile: RepoProfile, partial: PartialReq): Question[] {
  const isStatic = profile.workloadType === "static-site";
  const isAi = profile.ai.isAi;
  const isAgent = profile.workloadType === "ai-agent" || profile.workloadType === "rag-app" || profile.ai.isAi;

  const defaults: Record<keyof Requirements, () => Question | null> = {
    dataResidency: () => ({
      field: "dataResidency",
      prompt: "Where must user data live?",
      type: "choice",
      options: RESIDENCY_OPTS,
      default: "none",
      why: "Residency gates which regions and providers are eligible.",
    }),
    availabilityTarget: () => ({
      field: "availabilityTarget",
      prompt: "Availability target (e.g. 0.99, 0.999)?",
      type: "number",
      default: isStatic ? 0.999 : 0.99,
      why: "Drives multi-AZ vs single-AZ and redundancy cost.",
    }),
    latencyP95Ms: () => ({
      field: "latencyP95Ms",
      prompt: "Acceptable p95 latency in ms?",
      type: "number",
      default: isStatic ? 500 : 250,
      why: "Determines edge vs regional deployment.",
    }),
    peakRps: () => ({
      field: "peakRps",
      prompt: "Peak requests per second?",
      type: "number",
      default: isStatic ? 50 : 10,
      why: "Sizes compute and bandwidth.",
    }),
    monthlyBudgetUsd: () => ({
      field: "monthlyBudgetUsd",
      prompt: "Monthly budget in USD (optional)?",
      type: "number",
      why: "Filters candidates that exceed budget.",
      optional: true,
    }),
    userRegions: () => ({
      field: "userRegions",
      prompt: "Where are your users (comma-separated regions)?",
      type: "multi",
      default: ["us-east"],
      why: "Selects region and CDN footprint.",
    }),
    allowedProviders: () => ({
      field: "allowedProviders",
      prompt: "Which cloud providers are allowed?",
      type: "multi",
      options: PROVIDER_OPTS,
      default: ["aws", "gcp"],
      why: "Bounds the candidate search.",
    }),
    existing: () => ({
      field: "existing",
      prompt: "Existing deployment (provider, region, monthly cost) — optional.",
      type: "text",
      why: "Baseline for savings comparison.",
      optional: true,
    }),
    avgRps: () => ({
      field: "avgRps",
      prompt: "Average requests per second (optional)?",
      type: "number",
      why: "Refines cost estimates.",
      optional: true,
    }),
    dataClasses: () => ({
      field: "dataClasses",
      prompt: "Data classes handled?",
      type: "multi",
      options: DATA_CLASS_OPTS,
      default: profile.pii.length > 0 ? ["pii"] : ["none"],
      why: "Drives encryption and compliance controls.",
    }),
    compliance: () => ({
      field: "compliance",
      prompt: "Compliance requirements?",
      type: "multi",
      options: COMPLIANCE_OPTS,
      default: [],
      why: "Restricts provider services and regions.",
    }),
    llmTokensPerDay: () =>
      isAi
        ? {
            field: "llmTokensPerDay",
            prompt: "Estimated LLM tokens per day?",
            type: "number",
            default: isAgent ? 1_000_000 : 100_000,
            why: "Dominant cost driver for AI workloads.",
          }
        : null,
    llmModel: () =>
      isAi
        ? {
            field: "llmModel",
            prompt: "Which LLM model?",
            type: "text",
            default: profile.ai.modelProviders[0] ?? "",
            why: "Sets per-token pricing.",
          }
        : null,
  };

  const out: Question[] = [];
  for (const field of ORDER) {
    if (partial[field] !== undefined) continue;
    const q = defaults[field]();
    if (q) out.push(q);
  }
  return out;
}

export function applyAnswers(
  partial: PartialReq,
  answers: Partial<Requirements>,
): { ok: true; requirements: Requirements } | { ok: false; error: string } {
  const merged = { ...partial, ...answers };
  const parsed = Requirements.safeParse(merged);
  if (!parsed.success) return { ok: false, error: parsed.error.message };
  return { ok: true, requirements: parsed.data };
}
