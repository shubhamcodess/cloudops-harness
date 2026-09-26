import OpenAI from "openai";
import { StateGraph } from "@langchain/langgraph";
import { execSync } from "node:child_process";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const tools = [{ type: "function", function: { name: "run_python", parameters: {} } }];

export function runPython(code: string) {
  return execSync(`python -c ${JSON.stringify(code)}`).toString();
}

export const graph = new StateGraph({ channels: {} });
export { client, tools };
