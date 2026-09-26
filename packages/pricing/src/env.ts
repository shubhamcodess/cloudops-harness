import { readFileSync } from "node:fs";
import { join } from "node:path";

export function gcpApiKey(): string | undefined {
  if (process.env.GCP_API_KEY) return process.env.GCP_API_KEY;
  for (const dir of [process.cwd(), join(import.meta.dirname, "..", "..", "..")]) {
    try {
      const m = readFileSync(join(dir, ".env"), "utf8").match(/^\s*GCP_API_KEY\s*=\s*["']?([^"'\r\n]+)/m);
      if (m) return m[1];
    } catch {
      /* no .env here */
    }
  }
  return undefined;
}
