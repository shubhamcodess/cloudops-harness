import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const p = (s: string) => fileURLToPath(new URL(`./packages/${s}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@smc/contracts": p("contracts"),
      "@smc/engine": p("engine"),
      "@smc/detectors": p("detectors"),
      "@smc/pricing": p("pricing"),
      "@smc/policy": p("policy"),
      "@smc/iac-gen": p("iac-gen"),
      "@smc/verifier": p("verifier"),
      "@smc/sop": p("sop"),
      "@smc/app": p("app"),
      "@smc/mcp": p("mcp"),
    },
  },
  test: { include: ["packages/*/test/**/*.test.ts"], testTimeout: 20000 },
});
