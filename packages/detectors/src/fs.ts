import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", "target", ".next", "coverage", "__pycache__", ".venv", "venv", ".terraform"]);
const MAX_BYTES = 200_000;

export type Emit = (rule: string, file?: string, detail?: string) => void;

export interface Ctx {
  root: string;
  files: string[];
  read(rel: string): string;
  emit: Emit;
}

export function walk(root: string): string[] {
  const out: string[] = [];
  const visit = (dir: string, prefix: string) => {
    for (const name of readdirSync(join(dir)).sort()) {
      const rel = prefix ? `${prefix}/${name}` : name;
      const abs = join(root, rel);
      const st = statSync(abs);
      if (st.isDirectory()) {
        if (!SKIP_DIRS.has(name)) visit(abs, rel);
      } else if (st.isFile() && st.size <= MAX_BYTES) out.push(rel);
    }
  };
  visit(root, "");
  return out.sort();
}

export function makeReader(root: string): (rel: string) => string {
  const cache = new Map<string, string>();
  return (rel) => {
    let t = cache.get(rel);
    if (t === undefined) {
      try {
        t = readFileSync(join(root, rel), "utf8");
      } catch {
        t = "";
      }
      cache.set(rel, t);
    }
    return t;
  };
}

export const base = (f: string) => f.slice(f.lastIndexOf("/") + 1);
export const dirOf = (f: string) => (f.includes("/") ? f.slice(0, f.lastIndexOf("/")) : ".");
export const inDir = (f: string, dir: string) => dir === "." || f.startsWith(`${dir}/`);
export const uniq = <T>(xs: T[]) => [...new Set(xs)].sort();

const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|java|kt|go|rs|rb|php)$/;
export const isCode = (f: string) => CODE_EXT.test(f);
export const isLock = (f: string) => /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|poetry\.lock|uv\.lock|Cargo\.lock|go\.sum)$/.test(f);
