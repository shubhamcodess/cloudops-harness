import { base, isCode, type Ctx } from "./fs.js";

type Cls = "secret" | "config" | "public";

const PUBLIC = /^(NEXT_PUBLIC_|VITE_|REACT_APP_|PUBLIC_|NUXT_PUBLIC_|EXPO_PUBLIC_|GATSBY_)/;
const SECRET = /(SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE|CREDENTIAL|_KEY$|^KEY$|API_?KEY|(DATABASE|DB|REDIS|MONGO(DB)?|AMQP|BROKER|CONNECTION)_?(URL|URI|DSN|STRING)$|^DATABASE_URL$)/;

export const classify = (name: string): Cls => (PUBLIC.test(name) ? "public" : SECRET.test(name) ? "secret" : "config");

const NAME = "[A-Z][A-Z0-9_]{1,}";
const CODE_REFS = [
  new RegExp(`process\\.env\\.(${NAME})`, "g"),
  new RegExp(`process\\.env\\[["'](${NAME})["']\\]`, "g"),
  new RegExp(`import\\.meta\\.env\\.(${NAME})`, "g"),
  new RegExp(`os\\.environ(?:\\.get)?[\\[(]\\s*["'](${NAME})["']`, "g"),
  new RegExp(`os\\.getenv\\(\\s*["'](${NAME})["']`, "g"),
  new RegExp(`System\\.getenv\\(\\s*"(${NAME})"`, "g"),
  new RegExp(`\\$\\{(${NAME})(?::[^}]*)?\\}`, "g"),
];

export interface EnvVar {
  name: string;
  classification: Cls;
  file: string;
}

// Only names are read; values are never captured.
export function detectEnv(ctx: Ctx): EnvVar[] {
  const seen = new Map<string, string>();
  const add = (name: string, file: string) => {
    const prev = seen.get(name);
    if (prev === undefined || file < prev) seen.set(name, file);
  };
  for (const f of ctx.files) {
    const b = base(f);
    if (/^\.env(\..+)?$/.test(b) || b.endsWith(".env")) {
      for (const m of ctx.read(f).matchAll(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)) add(m[1]!, f);
    } else if (/^Dockerfile/.test(b)) {
      for (const m of ctx.read(f).matchAll(/^\s*(?:ENV|ARG)\s+([A-Z][A-Z0-9_]*)/gm)) add(m[1]!, f);
    } else if (isCode(f) || /\.(properties|ya?ml)$/.test(f)) {
      const t = ctx.read(f);
      for (const re of CODE_REFS) for (const m of t.matchAll(re)) add(m[1]!, f);
    }
  }
  const out = [...seen].map(([name, file]) => ({ name, classification: classify(name), file })).sort((a, b) => a.name.localeCompare(b.name));
  for (const v of out) ctx.emit("env-var", v.file, `${v.name}:${v.classification}`);
  return out;
}
