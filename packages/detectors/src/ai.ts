import { isCode, uniq, type Ctx } from "./fs.js";
import type { RepoProfile } from "@smc/contracts";

type Ai = RepoProfile["ai"];

const FRAMEWORKS: [string, RegExp][] = [
  ["langgraph", /^(@langchain\/langgraph|langgraph)$/],
  ["langchain", /^(langchain|@langchain\/core|langchain-core|langchain-community)$/],
  ["llamaindex", /^(llamaindex|llama-index(-.*)?)$/],
  ["crewai", /^crewai$/],
  ["autogen", /^(autogen|pyautogen|autogen-agentchat)$/],
  ["openai-agents", /^(openai-agents|@openai\/agents)$/],
  ["vercel-ai", /^ai$/],
  ["mastra", /^@mastra\/core$/],
  ["pydantic-ai", /^pydantic-ai$/],
];
const AGENT_FW = new Set(["langgraph", "crewai", "autogen", "openai-agents", "mastra", "pydantic-ai"]);
const PROVIDERS: [string, RegExp][] = [
  ["openai", /^(openai|@ai-sdk\/openai|langchain-openai|@langchain\/openai)$/],
  ["anthropic", /^(@anthropic-ai\/sdk|anthropic|@ai-sdk\/anthropic|langchain-anthropic)$/],
  ["google", /^(@google\/generative-ai|@google\/genai|google-generativeai|google-genai|vertexai)$/],
  ["cohere", /^cohere(ai)?$/],
  ["mistral", /^(@mistralai\/mistralai|mistralai)$/],
  ["groq", /^(groq|groq-sdk)$/],
  ["ollama", /^ollama$/],
  ["bedrock", /^@aws-sdk\/client-bedrock-runtime$/],
];
const VECTOR: [string, RegExp][] = [
  ["chromadb", /^chromadb$/],
  ["pinecone", /^(@pinecone-database\/pinecone|pinecone|pinecone-client)$/],
  ["weaviate", /^(weaviate-client|weaviate)$/],
  ["qdrant", /^(@qdrant\/js-client-rest|qdrant-client)$/],
  ["pgvector", /^(pgvector|pgvector-node)$/],
  ["faiss", /^(faiss-cpu|faiss-node)$/],
  ["milvus", /^(pymilvus|@zilliz\/milvus2-sdk-node)$/],
  ["lancedb", /^(lancedb|@lancedb\/lancedb)$/],
];
const SANDBOX_DEPS = /^(@e2b\/code-interpreter|e2b|e2b-code-interpreter|open-interpreter|langchain-experimental)$/;
const CODE_EXEC = /\b(child_process|execSync|spawnSync|subprocess\.(run|Popen|call)|os\.system|eval\(|exec\(|PythonREPL|code_interpreter|run_python|run_code|vm\.runIn)/;
const MCP_SERVER = /(McpServer|FastMCP|@modelcontextprotocol\/sdk\/server|mcp\.server|server\.tool\()/;
const MCP_CLIENT = /(@modelcontextprotocol\/sdk\/client|mcp\.client|ClientSession|MultiServerMCPClient|MCPClient)/;

export interface AiScan {
  ai: Ai;
  agentFramework: boolean;
}

export function detectAi(ctx: Ctx, deps: string[], files: string[]): AiScan {
  const pick = (table: [string, RegExp][]) => uniq(table.filter(([, re]) => deps.some((d) => re.test(d))).map(([n]) => n));
  const frameworks = pick(FRAMEWORKS);
  const modelProviders = pick(PROVIDERS);
  const vectorDbs = pick(VECTOR);
  let mcpServer = false;
  let mcpClient = false;
  let exec = "";
  const sdkDep = deps.includes("@modelcontextprotocol/sdk") || deps.includes("mcp") || deps.includes("fastmcp");
  for (const f of files.filter(isCode)) {
    const t = ctx.read(f);
    if (sdkDep && MCP_SERVER.test(t)) {
      mcpServer = true;
      ctx.emit("mcp-server", f);
    }
    if ((sdkDep || deps.includes("langchain-mcp-adapters")) && MCP_CLIENT.test(t)) {
      mcpClient = true;
      ctx.emit("mcp-client", f);
    }
    if (!exec && CODE_EXEC.test(t)) exec = f;
  }
  const mcp = mcpServer || mcpClient;
  const isAi = frameworks.length + modelProviders.length + vectorDbs.length > 0 || mcp;
  const sandboxDep = deps.some((d) => SANDBOX_DEPS.test(d));
  const needsSandbox = isAi && !mcpServer && (sandboxDep || (!!exec && (modelProviders.length > 0 || frameworks.length > 0)));
  if (needsSandbox) ctx.emit("ai-code-exec", exec || undefined);
  if (isAi) ctx.emit("ai-detected", undefined, [...frameworks, ...modelProviders, ...vectorDbs].join(","));
  return {
    ai: { isAi, frameworks, modelProviders, vectorDbs, mcpServer, mcpClient, needsSandbox },
    agentFramework: frameworks.some((f) => AGENT_FW.has(f)),
  };
}
