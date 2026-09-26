import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { redact } from "@smc/sop";
import { RunStore, StageError } from "./store.js";
import { makeTools, type ToolDeps } from "./tools.js";

export interface ServeOptions {
  port?: number;
  store?: RunStore;
  toolDeps?: ToolDeps;
  uiDist?: string; // dir to serve static ui from
}

const CORS = {
  "Access-Control-Allow-Origin": "http://localhost:5173",
  "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Mcp-Session-Id, Mcp-Protocol-Version",
  "Access-Control-Expose-Headers": "Mcp-Session-Id",
};

/** Build an McpServer with all tools registered against the given deps. */
export function buildMcpServer(store: RunStore, deps: ToolDeps = {}): McpServer {
  const server = new McpServer({ name: "cloudops-harness", version: "0.1.0" });
  const tools = makeTools(store, deps);

  const wrap = <A>(fn: (a: A) => unknown | Promise<unknown>) => async (args: A) => {
    try {
      const value = await fn(args);
      return { content: [{ type: "text" as const, text: JSON.stringify(value) }], structuredContent: value as Record<string, unknown> };
    } catch (e) {
      const msg = redact((e as Error).message ?? String(e));
      const kind = e instanceof StageError ? "stage_error" : "tool_error";
      return { isError: true, content: [{ type: "text" as const, text: `${kind}: ${msg}` }] };
    }
  };

  server.registerTool("start_run",
    { description: "Ingest source (git https URL or local path). Returns runId.",
      inputSchema: { source: z.string(), appName: z.string().optional() },
      annotations: { readOnlyHint: true, destructiveHint: false } },
    wrap(tools.start_run));

  server.registerTool("analyze_repo",
    { description: "Detect repo profile: workload, services, datastores, ai, secrets.",
      inputSchema: { runId: z.string() },
      annotations: { readOnlyHint: true, destructiveHint: false } },
    wrap(tools.analyze_repo));

  server.registerTool("next_questions",
    { description: "Missing requirement questions (id, prompt, type, options, default, why).",
      inputSchema: { runId: z.string() },
      annotations: { readOnlyHint: true, destructiveHint: false } },
    wrap((a: { runId: string }) => tools.next_questions(a)));

  server.registerTool("submit_answers",
    { description: "Merge answers; returns remaining questions or 'complete'.",
      inputSchema: { runId: z.string(), answers: z.record(z.string(), z.unknown()) },
      annotations: { readOnlyHint: false, destructiveHint: false } },
    wrap(tools.submit_answers));

  server.registerTool("price_and_decide",
    { description: "Load prices, build candidates, decide. Returns compact table + savings.",
      inputSchema: { runId: z.string() },
      annotations: { readOnlyHint: false, destructiveHint: false } },
    wrap(tools.price_and_decide));

  server.registerTool("select_candidate",
    { description: "Lock in a specific candidate (by id from price_and_decide's table) as the chosen deployment, overriding the automatic pick. Required when no candidate met every constraint (chosen was empty) and the user accepts one anyway; also usable to pick a different candidate than the auto-selected cheapest one.",
      inputSchema: { runId: z.string(), candidateId: z.string() },
      annotations: { readOnlyHint: false, destructiveHint: false } },
    wrap((a: { runId: string; candidateId: string }) => tools.select_candidate(a)));

  server.registerTool("explain_decision",
    { description: "Cost line items with SKUs + rationale + compliance report.",
      inputSchema: { runId: z.string(), candidateId: z.string().optional() },
      annotations: { readOnlyHint: true, destructiveHint: false } },
    wrap(tools.explain_decision));

  server.registerTool("generate_artifacts",
    { description: "Generate IaC + docs for the chosen candidate to run out/.",
      inputSchema: { runId: z.string() },
      annotations: { readOnlyHint: false, destructiveHint: false } },
    wrap(tools.generate_artifacts));

  server.registerTool("verify_artifacts",
    { description: "Run tofu/helm/conftest/gitleaks (docker) on generated files.",
      inputSchema: { runId: z.string(), floci: z.boolean().optional() },
      annotations: { readOnlyHint: false, destructiveHint: false } },
    wrap(tools.verify_artifacts));

  server.registerTool("deliver",
    { description: "Copy out/ files to target dir, or commit to a local git branch. DESTRUCTIVE.",
      inputSchema: { runId: z.string(), mode: z.enum(["write-to-directory", "git-branch"]), target: z.string() },
      annotations: { readOnlyHint: false, destructiveHint: true } },
    wrap(tools.deliver));

  server.registerTool("get_run",
    { description: "Compact status (stage, next step hint).",
      inputSchema: { runId: z.string() },
      annotations: { readOnlyHint: true, destructiveHint: false } },
    wrap((a: { runId: string }) => tools.get_run(a)));

  server.registerTool("get_ledger",
    { description: "Ledger with hash-chain verify().",
      inputSchema: { runId: z.string() },
      annotations: { readOnlyHint: true, destructiveHint: false } },
    wrap((a: { runId: string }) => tools.get_ledger(a)));

  return server;
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  return await new Promise((res, rej) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.from(c)));
    req.on("end", () => {
      const s = Buffer.concat(chunks).toString("utf8");
      if (!s) return res(undefined);
      try { res(JSON.parse(s)); } catch (e) { rej(e); }
    });
    req.on("error", rej);
  });
}

function send(res: ServerResponse, code: number, body: unknown, ct = "application/json") {
  res.writeHead(code, { "Content-Type": ct, ...CORS });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

const MIME: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };

export async function startServer(opts: ServeOptions = {}) {
  const port = opts.port ?? 8830;
  const store = opts.store ?? new RunStore();
  const tools = makeTools(store, opts.toolDeps);

  // Stateless per-request transport (simple + spec-compliant for POST-only clients).
  const http = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      if (req.method === "OPTIONS") return send(res, 204, "");

      if (url.pathname === "/healthz") return send(res, 200, { ok: true });

      if (url.pathname === "/mcp") {
        const body = req.method === "POST" ? await readJson(req) : undefined;
        const server = buildMcpServer(store, opts.toolDeps);
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        res.on("close", () => { void transport.close(); void server.close(); });
        await server.connect(transport);
        for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
        await transport.handleRequest(req, res, body);
        return;
      }

      // REST for the dashboard
      if (url.pathname === "/api/runs" && req.method === "GET") {
        return send(res, 200, { runs: store.list() });
      }
      if (url.pathname === "/api/runs" && req.method === "POST") {
        const b = (await readJson(req)) as { source?: string; appName?: string } | undefined;
        if (!b?.source) return send(res, 400, { error: "source required" });
        const out = await tools.start_run({ source: b.source, appName: b.appName });
        return send(res, 200, out);
      }
      const runMatch = url.pathname.match(/^\/api\/runs\/([^/]+)$/);
      if (runMatch && req.method === "GET") {
        try { return send(res, 200, store.view(runMatch[1]!)); }
        catch (e) { return send(res, 404, { error: (e as Error).message }); }
      }
      const fileMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/files\/(.+)$/);
      if (fileMatch && req.method === "GET") {
        try {
          const f = store.readOutFile(fileMatch[1]!, decodeURIComponent(fileMatch[2]!));
          return send(res, 200, f.content, "text/plain");
        } catch (e) { return send(res, 404, { error: redact((e as Error).message) }); }
      }

      // Static ui/dist
      const uiDist = opts.uiDist ?? resolve(process.cwd(), "packages/ui/dist");
      if (existsSync(uiDist)) {
        const rel = url.pathname === "/" ? "/index.html" : url.pathname;
        const abs = resolve(join(uiDist, rel));
        if (abs.startsWith(resolve(uiDist) + sep) && existsSync(abs) && statSync(abs).isFile()) {
          const mt = MIME[extname(abs)] ?? "application/octet-stream";
          res.writeHead(200, { "Content-Type": mt, ...CORS });
          return createReadStream(abs).pipe(res);
        }
      }

      send(res, 404, { error: "not found" });
    } catch (e) {
      send(res, 500, { error: redact((e as Error).message ?? "internal") });
    }
  });

  await new Promise<void>((res) => http.listen(port, res));
  return { http, store, port };
}
