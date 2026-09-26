import { startServer } from "./server.js";

startServer({ port: Number(process.env.PORT ?? 8830) })
  .then(({ port }) => console.log(`cloudops-harness MCP+REST listening on http://localhost:${port}`))
  .catch((e) => { console.error(e); process.exit(1); });
