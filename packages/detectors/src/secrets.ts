import { isLock, type Ctx } from "./fs.js";

const KINDS: [string, RegExp][] = [
  ["aws-access-key", /\b(AKIA|ASIA)[0-9A-Z]{16}\b/],
  ["stripe-key", /\b[sr]k_(live|test)_[0-9A-Za-z]{16,}/],
  ["github-token", /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ["openai-key", /\bsk-(proj-)?[A-Za-z0-9_-]{20,}/],
  ["slack-token", /\bxox[baprs]-[A-Za-z0-9-]{10,}/],
  ["google-api-key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["private-key", /-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ["hardcoded-credential", /\b(password|passwd|secret|api_?key|token)\w*\s*[:=]\s*["'](?!\$\{)[^"'\s]{8,}["']/i],
];

// Reports file + kind only; the matched text is never stored.
export function scanSecrets(ctx: Ctx): { file: string; kind: string }[] {
  const out: { file: string; kind: string }[] = [];
  for (const f of ctx.files) {
    if (isLock(f) || /\.(md|png|jpg|svg|ico)$/.test(f)) continue;
    const t = ctx.read(f);
    for (const [kind, re] of KINDS) {
      if (re.test(t)) {
        out.push({ file: f, kind });
        ctx.emit("secret-in-code", f, kind);
      }
    }
  }
  return out;
}
