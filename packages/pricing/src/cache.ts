import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Sku } from "@smc/contracts";

export const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export interface CacheOptions {
  cacheDir?: string;
  ttlMs?: number;
  refresh?: boolean;
  now?: () => number;
}

interface Entry {
  fetchedAt: string;
  skus: Sku[];
}

export const defaultCacheDir = () => join(process.cwd(), ".cache", "pricing");

const file = (o: CacheOptions, provider: string, service: string, region: string) =>
  join(o.cacheDir ?? defaultCacheDir(), provider, service, `${region}.json`);

export async function readCache(o: CacheOptions, provider: string, service: string, region: string): Promise<Sku[] | undefined> {
  if (o.refresh) return undefined;
  try {
    const e = JSON.parse(await readFile(file(o, provider, service, region), "utf8")) as Entry;
    const age = (o.now?.() ?? Date.now()) - Date.parse(e.fetchedAt);
    return age <= (o.ttlMs ?? DEFAULT_TTL_MS) ? e.skus : undefined;
  } catch {
    return undefined;
  }
}

export async function writeCache(o: CacheOptions, provider: string, service: string, region: string, skus: Sku[], fetchedAt: string) {
  const f = file(o, provider, service, region);
  await mkdir(dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify({ fetchedAt, skus } satisfies Entry));
  await rename(tmp, f);
}
