import { base, type Ctx } from "./fs.js";
import type { RepoProfile } from "@smc/contracts";

const EXT: Record<string, string> = {
  ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  py: "python", java: "java", kt: "kotlin", go: "go", rs: "rust", rb: "ruby", php: "php",
};

export function detectLanguages(ctx: Ctx): string[] {
  const found = new Map<string, string>();
  for (const f of ctx.files) {
    const lang = EXT[f.slice(f.lastIndexOf(".") + 1)];
    if (lang && !found.has(lang)) found.set(lang, f);
  }
  for (const [lang, f] of found) ctx.emit("language", f, lang);
  return [...found.keys()].sort();
}

export function langForDir(ctx: Ctx, files: string[]): string {
  const has = (re: RegExp) => files.some((f) => re.test(f));
  if (has(/(^|\/)(requirements\.txt|pyproject\.toml)$/) ) return "python";
  if (has(/(^|\/)(pom\.xml|build\.gradle(\.kts)?)$/)) return "java";
  if (has(/(^|\/)go\.mod$/)) return "go";
  if (has(/(^|\/)Cargo\.toml$/)) return "rust";
  return has(/\.tsx?$|(^|\/)tsconfig\.json$/) ? "typescript" : "javascript";
}

type Pm = RepoProfile["packageManager"];

export function detectPackageManager(ctx: Ctx): Pm {
  const has = (n: string) => ctx.files.find((f) => base(f) === n);
  const rootPkg = ctx.files.includes("package.json") ? ctx.read("package.json") : "";
  const rules: [Pm, string | undefined][] = [
    ["pnpm", has("pnpm-lock.yaml") ?? has("pnpm-workspace.yaml") ?? (/"packageManager":\s*"pnpm/.test(rootPkg) ? "package.json" : undefined)],
    ["yarn", has("yarn.lock")],
    ["npm", has("package-lock.json")],
    ["poetry", has("poetry.lock")],
    ["uv", has("uv.lock")],
    ["npm", has("package.json")],
    ["pip", has("requirements.txt") ?? has("pyproject.toml")],
    ["maven", has("pom.xml")],
    ["gradle", has("build.gradle") ?? has("build.gradle.kts")],
    ["go", has("go.mod")],
    ["cargo", has("Cargo.toml")],
  ];
  for (const [pm, file] of rules) {
    if (file) {
      ctx.emit("package-manager", file, pm);
      return pm;
    }
  }
  return "none";
}
