import { resolve } from "node:path";
import { RepoProfile, type WorkloadType } from "@smc/contracts";
import { detectAi } from "./ai.js";
import { detectDatastores } from "./datastores.js";
import { detectEnv } from "./env.js";
import { makeReader, walk, type Ctx } from "./fs.js";
import { detectInfra, parseCompose } from "./infra.js";
import { detectLanguages, detectPackageManager } from "./language.js";
import { detectManifests } from "./manifests.js";
import { detectPii } from "./pii.js";
import { scanSecrets } from "./secrets.js";
import { detectServices } from "./services.js";
import { detectWorkload } from "./workload.js";

type Evidence = { rule: string; file?: string; detail?: string };

export async function detectRepo(path: string): Promise<RepoProfile> {
  const root = resolve(path);
  const evidence = new Map<string, Evidence>();
  const emit = (rule: string, file?: string, detail?: string) => {
    const e: Evidence = { rule, ...(file ? { file } : {}), ...(detail ? { detail } : {}) };
    evidence.set(JSON.stringify([rule, file ?? "", detail ?? ""]), e);
  };
  const ctx: Ctx = { root, files: walk(root), read: makeReader(root), emit };

  const languages = detectLanguages(ctx);
  const packageManager = detectPackageManager(ctx);
  const manifests = detectManifests(ctx);
  const infra = detectInfra(ctx);
  const compose = parseCompose(ctx);
  const envVars = detectEnv(ctx);
  const services = detectServices(ctx, manifests, compose, packageManager);
  const scan = detectAi(ctx, manifests.flatMap((m) => m.deps), ctx.files);
  const datastores = detectDatastores(ctx, manifests, compose, envVars);
  const pii = detectPii(ctx, manifests);
  scanSecrets(ctx);
  const workloadType: WorkloadType = detectWorkload(ctx, services, compose, scan);

  const profile = {
    source: { kind: "path" as const, ref: root },
    workloadType,
    languages,
    packageManager,
    services: services.map(({ deps: _deps, ...s }) => s),
    dockerable: infra.hasDockerfile || (workloadType !== "package" && workloadType !== "unknown"),
    ...infra,
    datastores,
    ai: scan.ai,
    envVars,
    pii,
    evidence: [...evidence.values()].sort((a, b) => a.rule.localeCompare(b.rule) || (a.file ?? "").localeCompare(b.file ?? "") || (a.detail ?? "").localeCompare(b.detail ?? "")),
  };
  return RepoProfile.parse(profile);
}
