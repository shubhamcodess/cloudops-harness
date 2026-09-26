import type { GeneratedFile } from "@smc/contracts";

export type Kind = GeneratedFile["kind"];

export const file = (path: string, content: string, kind: Kind): GeneratedFile => ({
  path,
  content: content.endsWith("\n") ? content : content + "\n",
  kind,
});

export const sortFiles = (files: GeneratedFile[]): GeneratedFile[] =>
  [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

export const dedupeTags = (t: Record<string, string>): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const k of Object.keys(t).sort()) out[k] = t[k]!;
  return out;
};

export const slug = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "app";

export const yaml = (obj: unknown, indent = 0): string => {
  const pad = "  ".repeat(indent);
  if (obj === null || obj === undefined) return "null";
  if (typeof obj === "string") return needsQuote(obj) ? JSON.stringify(obj) : obj;
  if (typeof obj === "number" || typeof obj === "boolean") return String(obj);
  if (Array.isArray(obj)) {
    if (obj.length === 0) return "[]";
    return obj.map((v) => `${pad}- ${yamlInline(v, indent + 1)}`).join("\n");
  }
  const keys = Object.keys(obj as Record<string, unknown>);
  if (keys.length === 0) return "{}";
  return keys
    .map((k) => {
      const v = (obj as Record<string, unknown>)[k];
      if (v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length > 0) {
        return `${pad}${k}:\n${yaml(v, indent + 1)}`;
      }
      if (Array.isArray(v) && v.length > 0 && v.some((x) => typeof x === "object")) {
        return `${pad}${k}:\n${yaml(v, indent + 1)}`;
      }
      return `${pad}${k}: ${yaml(v, indent + 1)}`;
    })
    .join("\n");
};

const yamlInline = (v: unknown, indent: number): string => {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const keys = Object.keys(v as Record<string, unknown>);
    if (keys.length === 0) return "{}";
    const first = keys[0]!;
    const rest = keys.slice(1);
    const firstLine = `${first}: ${yaml((v as Record<string, unknown>)[first], indent + 1)}`;
    if (rest.length === 0) return firstLine;
    const pad = "  ".repeat(indent);
    const restLines = rest
      .map((k) => `${pad}${k}: ${yaml((v as Record<string, unknown>)[k], indent + 1)}`)
      .join("\n");
    return `${firstLine}\n${restLines}`;
  }
  return yaml(v, indent);
};

const needsQuote = (s: string): boolean =>
  s === "" ||
  /^(true|false|null|yes|no|on|off)$/i.test(s) ||
  /^-?\d/.test(s) ||
  /[:#\-?&*!|>%@`{}[\],'"\n]/.test(s) ||
  /^\s|\s$/.test(s);
