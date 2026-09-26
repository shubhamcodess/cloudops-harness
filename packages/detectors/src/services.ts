import type { ServiceInfo, WorkloadType } from "@smc/contracts";
import { base, inDir, type Ctx } from "./fs.js";
import { detectAi } from "./ai.js";
import { langForDir } from "./language.js";
import { ownerDir, type Manifest } from "./manifests.js";
import type { ComposeService } from "./infra.js";

const WEB = /^(express|fastify|koa|hono|@hapi\/hapi|@nestjs\/core|next|nuxt|fastapi|flask|django|starlette|uvicorn|gunicorn|aiohttp|spring-boot-starter-web|spring-boot-starter-webflux|gin-gonic\/gin|github\.com\/gin-gonic\/gin|github\.com\/labstack\/echo\/v4|actix-web|axum)$/;
const QUEUE = /^(amqplib|kafkajs|bullmq|bull|celery|pika|confluent-kafka|spring-kafka)$/;
const STATIC_TOOLS = /^(vite|parcel|webpack|@11ty\/eleventy|astro|gatsby|hugo|jekyll)$/;
const MONOLITH = /^(spring-boot-starter-parent|spring-boot-starter-web|django|rails|laravel\/framework)$/;

export const isWebDeps = (deps: string[]) => deps.some((d) => WEB.test(d));
export const isMonolithDeps = (deps: string[]) => deps.some((d) => MONOLITH.test(d));
export const isRunnable = (k: WorkloadType) => !["package", "static-site", "unknown", "monorepo"].includes(k);

export interface ServiceCandidate extends ServiceInfo {
  deps: string[];
}

function detectPort(ctx: Ctx, files: string[], dir: string, compose: ComposeService[]): number | undefined {
  const pick = (names: (f: string) => boolean, res: RegExp[]) => {
    for (const re of res)
      for (const f of files.filter(names)) {
        const m = ctx.read(f).match(re);
        if (m) return Number(m[1]);
      }
  };
  const docker = (f: string) => /^Dockerfile/.test(base(f));
  const code = (f: string) => /\.(ts|js|mjs|cjs|py|java|properties)$/.test(f);
  const fromFiles =
    pick(docker, [/^\s*EXPOSE\s+(\d{2,5})/m, /--port["',\s=]+(\d{2,5})/]) ??
    pick((f) => /(^|\/)\.env(\..+)?$/.test(f), [/^PORT=(\d{2,5})\s*$/m]) ??
    pick(code, [/server\.port\s*=\s*(\d{2,5})/, /PORT["']?\s*(?:\?\?|\|\||,)\s*["']?(\d{2,5})/, /\.listen\(\s*(\d{2,5})/]) ??
    pick((f) => base(f) === "package.json", [/--port[ =](\d{2,5})/]);
  if (fromFiles) return fromFiles;
  const c = compose.find((s) => s.build && (s.build === dir || base(s.build) === base(dir)));
  return c?.ports[0];
}

function commands(ctx: Ctx, m: Manifest, lang: string, files: string[], pm: string, deps: string[]): { buildCmd?: string; startCmd?: string } {
  if (m.pkg) {
    const s = m.pkg.scripts ?? {};
    const run = (n: string) => (pm === "npm" ? `npm run ${n}` : `${pm} run ${n}`);
    return { buildCmd: s.build ? run("build") : undefined, startCmd: s.start ? (pm === "npm" ? "npm start" : `${pm} start`) : undefined };
  }
  if (lang === "python") {
    const req = files.find((f) => base(f) === "requirements.txt");
    const mod = ["main.py", "app.py"].map((n) => files.find((f) => base(f) === n)).find(Boolean);
    const module = mod ? base(mod).replace(/\.py$/, "") : undefined;
    return {
      buildCmd: req ? "pip install -r requirements.txt" : undefined,
      startCmd: deps.includes("fastapi") && module ? `uvicorn ${module}:app` : deps.includes("flask") && module ? `flask --app ${module} run` : undefined,
    };
  }
  if (lang === "java") {
    const gradle = files.some((f) => base(f).startsWith("build.gradle"));
    return gradle ? { buildCmd: "gradle build", startCmd: "java -jar build/libs/*.jar" } : { buildCmd: "mvn -B package", startCmd: "java -jar target/*.jar" };
  }
  if (lang === "go") return { buildCmd: "go build ./...", startCmd: "go run ." };
  return {};
}

function classify(ctx: Ctx, m: Manifest, files: string[]): WorkloadType {
  const scan = detectAi(ctx, m.deps, files);
  const ai = scan.ai;
  if (ai.mcpServer) return "mcp-server";
  if (scan.agentFramework || ai.needsSandbox) return "ai-agent";
  if (ai.vectorDbs.length && ai.modelProviders.length) return "rag-app";
  if (ai.isAi && !isWebDeps(m.deps)) return "ai-agent";
  const web = isWebDeps(m.deps);
  const pkg = m.pkg ?? {};
  const exportsLib = !!(pkg.exports || pkg.publishConfig || pkg.main || pkg.module || pkg.types);
  if (!web && m.deps.some((d) => STATIC_TOOLS.test(d)) && files.some((f) => /(^|\/)index\.html$/.test(f))) return "static-site";
  if (!web && exportsLib && !pkg.scripts?.start) return "package";
  if (web) return "service";
  if (m.deps.some((d) => QUEUE.test(d)) || pkg.scripts?.start) return "worker";
  return "unknown";
}

export function detectServices(ctx: Ctx, manifests: Manifest[], compose: ComposeService[], pm: string): ServiceCandidate[] {
  const dirs = manifests.map((m) => m.dir);
  const scratch: typeof ctx.emit = () => {};
  const quiet: Ctx = { ...ctx, emit: scratch };
  const all = manifests.map((m) => {
    const files = ctx.files.filter((f) => inDir(f, m.dir) && ownerDir(f, dirs) === m.dir);
    const kind = classify(quiet, m, files);
    const lang = langForDir(ctx, [...m.files, ...files]);
    const port = detectPort(ctx, files, m.dir, compose);
    const cmds = commands(ctx, m, lang, files, pm, m.deps);
    const svc: ServiceCandidate = {
      name: m.pkg?.name ?? (m.dir === "." ? "app" : base(m.dir)),
      path: m.dir,
      language: lang,
      kind,
      ...(port ? { port } : {}),
      ...(cmds.buildCmd ? { buildCmd: cmds.buildCmd } : {}),
      ...(cmds.startCmd ? { startCmd: cmds.startCmd } : {}),
      hasDockerfile: files.some((f) => /^Dockerfile/.test(base(f))),
      deps: m.deps,
    };
    return svc;
  });
  const keep = all.filter((s) => s.kind !== "unknown" || all.length === 1);
  const out = keep.length ? keep : all.slice(0, 1);
  for (const s of out) ctx.emit("service", s.path === "." ? manifests.find((m) => m.dir === ".")?.files[0] : `${s.path}/`, `${s.name}:${s.kind}`);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}
