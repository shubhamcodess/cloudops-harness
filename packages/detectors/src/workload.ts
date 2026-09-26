import type { RepoProfile, WorkloadType } from "@smc/contracts";
import { base, type Ctx } from "./fs.js";
import { isMonolithDeps, isRunnable, type ServiceCandidate } from "./services.js";
import type { ComposeService } from "./infra.js";
import type { AiScan } from "./ai.js";

function hasWorkspace(ctx: Ctx): string | undefined {
  return ctx.files.find((f) => ["pnpm-workspace.yaml", "lerna.json", "turbo.json", "nx.json"].includes(f)) ?? (/"workspaces"\s*:/.test(ctx.files.includes("package.json") ? ctx.read("package.json") : "") ? "package.json" : undefined);
}

export function detectWorkload(ctx: Ctx, services: ServiceCandidate[], compose: ComposeService[], scan: AiScan): WorkloadType {
  const ai: RepoProfile["ai"] = scan.ai;
  const decide = (t: WorkloadType, rule: string, file?: string): WorkloadType => {
    ctx.emit(`workload:${rule}`, file, t);
    return t;
  };
  const runnable = services.filter((s) => isRunnable(s.kind));
  const workspace = hasWorkspace(ctx);
  const composeBuilt = compose.filter((c) => c.build).length;

  if (ai.mcpServer) return decide("mcp-server", "mcp-server");
  if (runnable.length >= 2 || (workspace && runnable.length >= 2) || composeBuilt >= 2) return decide("microservices", "multiple-services", workspace ?? compose[0]?.file);
  if (workspace && services.length >= 2) return decide("monorepo", "workspace", workspace);
  if (scan.agentFramework || ai.needsSandbox) return decide("ai-agent", "agent-framework");
  if (ai.vectorDbs.length && ai.modelProviders.length) return decide("rag-app", "vector-db+llm");
  if (ai.isAi && runnable.length === 0) return decide("ai-agent", "ai");
  const only = services[0];
  if (!only) return decide("unknown", "no-services");
  if (only.kind === "service") {
    const mono = isMonolithDeps(only.deps);
    return decide(mono ? "monolith" : "service", mono ? "monolith-framework" : "single-service", only.path === "." ? undefined : `${only.path}/`);
  }
  return decide(only.kind, "single-kind", base(only.path));
}
