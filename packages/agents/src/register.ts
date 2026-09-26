import { CREW_INSTRUCTIONS } from "./instructions";

const FORGE = process.env.TRUEFORGE_URL ?? "http://localhost:8790";
const MCP_URL = process.env.SMC_MCP_URL ?? "http://localhost:8830/mcp";
const provider = process.env.LLM_PROVIDER ?? "openrouter";
const model = process.env.LLM_MODEL ?? "nvidia/nemotron-3-super-120b-a12b:free";
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${FORGE}/api/v1${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

const mcp = { type: "remote", name: "cloudops-harness", url: MCP_URL, description: "Repo analysis, live cloud pricing, GDPR-aware decisions, IaC generation and verification" };

const spec = {
  model: { name: `${provider}/${slug(model)}` },
  instructions: CREW_INSTRUCTIONS,
  mcp_servers: [{ name: "cloudops-harness", require_approval_for_tools: ["deliver"] }],
  config: { iteration_limit: 60, dynamic_sub_agents: { enabled: true }, ask_user_questions: { enabled: true }, sandbox: { enabled: process.env.DAYTONA_API_KEY ? true : false, file_downloads: true } },
};

await call("PUT", "/settings/mcp-servers", { manifest: mcp });
const body = { name: "cloudops-harness", description: "Cloud deployment crew: repo to priced, verified, compliant deploy plan", manifest: spec };
const existing = (await call("GET", "/agents?agent_name=cloudops-harness")).data?.find((a: { name: string }) => a.name === "cloudops-harness");
if (existing) await call("PUT", `/agents/${existing.id}`, { description: body.description, manifest: spec });
else await call("POST", "/agents", body);
console.log(`registered MCP server + agent cloudops-harness on ${spec.model.name}`);
