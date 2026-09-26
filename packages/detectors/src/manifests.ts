import { base, dirOf, uniq, type Ctx } from "./fs.js";

const MANIFESTS = ["package.json", "requirements.txt", "pyproject.toml", "pom.xml", "build.gradle", "build.gradle.kts", "go.mod", "Cargo.toml"];

export interface Manifest {
  dir: string;
  files: string[];
  deps: string[];
  pkg?: Record<string, any>;
}

function depsOf(file: string, text: string): string[] {
  const b = base(file);
  if (b === "package.json") {
    try {
      const j = JSON.parse(text);
      return Object.keys({ ...j.dependencies, ...j.devDependencies, ...j.peerDependencies });
    } catch {
      return [];
    }
  }
  if (b === "requirements.txt") {
    return text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#") && !l.startsWith("-"))
      .map((l) => (l.match(/^[A-Za-z0-9_.-]+/)?.[0] ?? "").toLowerCase().replace(/_/g, "-"))
      .filter(Boolean);
  }
  if (b === "pyproject.toml") {
    const quoted = [...text.matchAll(/["']([A-Za-z][\w.-]*)(?:\[[^\]]*\])?\s*(?:[<>=~!;].*)?["']/g)].map((m) => m[1]!);
    const poetry = [...text.matchAll(/^([A-Za-z][\w.-]*)\s*=/gm)].map((m) => m[1]!);
    return [...quoted, ...poetry].map((d) => d.toLowerCase().replace(/_/g, "-"));
  }
  if (b === "pom.xml") return [...text.matchAll(/<artifactId>([^<]+)<\/artifactId>/g)].map((m) => m[1]!);
  if (b === "go.mod") return [...text.matchAll(/^\s*(?:require\s+)?([\w.-]+\.[\w./-]+)\s+v/gm)].map((m) => m[1]!);
  if (b.startsWith("build.gradle")) return [...text.matchAll(/["']([\w.-]+:[\w.-]+)(?::[^"']*)?["']/g)].map((m) => m[1]!);
  return [...text.matchAll(/^([A-Za-z][\w-]*)\s*=/gm)].map((m) => m[1]!);
}

export function detectManifests(ctx: Ctx): Manifest[] {
  const byDir = new Map<string, Manifest>();
  for (const f of ctx.files) {
    if (!MANIFESTS.includes(base(f))) continue;
    const dir = dirOf(f);
    const m = byDir.get(dir) ?? { dir, files: [], deps: [] };
    m.files.push(f);
    m.deps.push(...depsOf(f, ctx.read(f)));
    if (base(f) === "package.json") {
      try {
        m.pkg = JSON.parse(ctx.read(f));
      } catch {}
    }
    byDir.set(dir, m);
    ctx.emit("manifest", f);
  }
  return [...byDir.values()].map((m) => ({ ...m, deps: uniq(m.deps) })).sort((a, b) => a.dir.localeCompare(b.dir));
}

export const ownerDir = (file: string, dirs: string[]): string => {
  let best = ".";
  for (const d of dirs) if (d !== "." && file.startsWith(`${d}/`) && d.length > best.length) best = d;
  return best;
};
