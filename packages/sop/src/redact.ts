const RULES: [string, RegExp][] = [
  ["private-key", /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g],
  ["aws-access-key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ["gcp-api-key", /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ["openai-key", /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g],
  ["jwt", /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g],
  ["bearer-token", /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}/gi],
  ["secret-assignment", /\b([A-Z][A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD)[A-Z0-9_]*\s*[=:]\s*["']?)(?!mock-)([A-Za-z0-9+/_=-]{16,})/g],
];

export function redact(text: string): string {
  let out = text;
  for (const [kind, re] of RULES) {
    if (kind === "bearer-token") out = out.replace(re, (_m, p) => `${p}[REDACTED:${kind}]`);
    else if (kind === "secret-assignment") out = out.replace(re, (_m, p) => `${p}[REDACTED:${kind}]`);
    else out = out.replace(re, `[REDACTED:${kind}]`);
  }
  return out;
}

export function findSecrets(text: string): string[] {
  const found = new Set<string>();
  for (const m of redact(text).matchAll(/\[REDACTED:([a-z-]+)\]/g)) found.add(m[1]!);
  return [...found];
}

export function assertNoSecrets(text: string): void {
  const kinds = findSecrets(text);
  if (kinds.length) throw new Error(`secret-like content detected: ${kinds.join(", ")}`);
}
