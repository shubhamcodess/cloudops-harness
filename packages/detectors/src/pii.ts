import { isCode, isLock, base, type Ctx } from "./fs.js";
import type { Manifest } from "./manifests.js";

const SIGNALS: [string, RegExp][] = [
  ["email", /\bemail(_?address)?\b/i],
  ["phone", /\bphone(_?number)?\b/i],
  ["ip-address", /\b(req\.ip|x-forwarded-for|remote_addr|ip_?address)\b/i],
  ["date-of-birth", /\b(date_of_birth|dateofbirth|birth_?date|dob)\b/i],
  ["government-id", /\b(ssn|social_security|passport_?number|aadhaar)\b/i],
  ["payment-card", /\b(credit_?card|card_?number|cvv)\b/i],
  ["cookies", /\b(res\.cookie|set_cookie|cookie-parser|document\.cookie|cookieParser)\b|cookie-parser/i],
];
const ANALYTICS: [string, RegExp][] = [
  ["segment", /^(@segment\/analytics-node|analytics-node|@segment\/analytics-next|segment-analytics|analytics-python)$/],
  ["mixpanel", /^mixpanel(-browser)?$/],
  ["amplitude", /^(@amplitude\/analytics-(node|browser)|amplitude-analytics)$/],
  ["posthog", /^(posthog-js|posthog-node|posthog)$/],
  ["google-analytics", /^(react-ga4?|ga-gtag|@analytics\/google-analytics)$/],
  ["sentry", /^(@sentry\/[\w-]+|sentry-sdk)$/],
];

export function detectPii(ctx: Ctx, manifests: Manifest[]): { signal: string; file: string }[] {
  const out = new Map<string, { signal: string; file: string }>();
  const add = (signal: string, file: string) => {
    out.set(`${signal}\0${file}`, { signal, file });
    ctx.emit("pii-signal", file, signal);
  };
  for (const m of manifests) for (const d of m.deps) for (const [n, re] of ANALYTICS) if (re.test(d)) add(`analytics-sdk:${n}`, m.files[0]!);
  for (const f of ctx.files) {
    if (isLock(f) || base(f).startsWith(".env") || !(isCode(f) || /\.(sql|prisma)$/.test(f))) continue;
    const t = ctx.read(f);
    for (const [s, re] of SIGNALS) if (re.test(t)) add(s, f);
  }
  return [...out.values()].sort((a, b) => a.signal.localeCompare(b.signal) || a.file.localeCompare(b.file));
}
