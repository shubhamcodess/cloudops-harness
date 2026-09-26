import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({ name: "notes", version: "0.1.0" });
server.tool("list_notes", {}, async () => ({ content: [{ type: "text", text: "[]" }] }));
await server.connect(new StdioServerTransport());
