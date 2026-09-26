import { spawn } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

const MAX_BYTES = 200 * 1024 * 1024;
const TIMEOUT_MS = 60_000;

// Only https git URLs are accepted; no shell interpolation (spawn with argv).
export async function shallowClone(url: string, dest: string): Promise<void> {
  if (!/^https:\/\/[A-Za-z0-9._~%!$&'()*+,;=:@/-]+$/.test(url)) {
    throw new Error("only https git URLs are allowed");
  }
  const abs = resolve(dest);
  mkdirSync(abs, { recursive: true });
  await new Promise<void>((res, rej) => {
    const p = spawn("git", ["clone", "--depth=1", "--single-branch", url, abs], { stdio: "pipe" });
    const to = setTimeout(() => { p.kill("SIGKILL"); rej(new Error("git clone timeout")); }, TIMEOUT_MS);
    let err = "";
    p.stderr?.on("data", (b) => { err += b.toString(); });
    p.on("close", (code) => {
      clearTimeout(to);
      if (code !== 0) return rej(new Error(`git clone failed: ${err.trim().slice(0, 200)}`));
      try {
        const bytes = dirBytes(abs);
        if (bytes > MAX_BYTES) return rej(new Error(`clone exceeds size cap: ${bytes} bytes`));
        res();
      } catch (e) { rej(e as Error); }
    });
  });
}

function dirBytes(dir: string): number {
  const { readdirSync } = require("node:fs") as typeof import("node:fs");
  let total = 0;
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = resolve(dir, name.name);
    if (name.isDirectory()) total += dirBytes(p);
    else { try { total += statSync(p).size; } catch { /* skip */ } }
  }
  return total;
}
