import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunStore, hashSource, stageAtLeast } from "../src/store.js";

function freshStore() {
  return new RunStore({ root: mkdtempSync(join(tmpdir(), "smc-store-")) });
}

describe("stageAtLeast", () => {
  it("orders stages by the pipeline sequence", () => {
    expect(stageAtLeast("decided", "profiled")).toBe(true);
    expect(stageAtLeast("profiled", "decided")).toBe(false);
    expect(stageAtLeast("created", "created")).toBe(true);
  });
});

describe("RunStore", () => {
  it("creates, saves and reloads a run record", () => {
    const store = freshStore();
    const rec = store.create("https://example.com/repo.git", "myapp");
    expect(rec.stage).toBe("created");
    expect(rec.appName).toBe("myapp");
    const reloaded = store.get(rec.id);
    expect(reloaded.id).toBe(rec.id);
  });

  it("derives a slug app name from the source when none is given", () => {
    const store = freshStore();
    const rec = store.create("https://github.com/acme/widget-service.git");
    expect(rec.appName).toBe("widget-service");
  });

  it("keeps the ledger hash chain valid across save/reload", () => {
    const store = freshStore();
    const rec = store.create("./local-repo");
    store.appendLedger(rec, "created", "start_run", { a: 1 }, { b: 2 });
    store.appendLedger(rec, "profiled", "analyze_repo", {}, { ok: true });
    const reloaded = store.get(rec.id);
    expect(store.ledgerOf(reloaded).verify().ok).toBe(true);
  });

  it("throws requireStage when the run hasn't reached the needed stage", () => {
    const store = freshStore();
    const rec = store.create("./local-repo");
    expect(() => store.requireStage(rec, "decided", "price_and_decide")).toThrow(/needs stage>=decided/);
  });

  it("safeResolve rejects paths outside cwd and inside .git", () => {
    const store = freshStore();
    expect(() => store.safeResolve("/etc/passwd-smc-escape")).toThrow(/escapes cwd/);
    expect(() => store.safeResolve("./.git/hooks")).toThrow(/\.git/);
    expect(store.safeResolve(".")).toBe(process.cwd());
  });

  it("writeFiles rejects a generated file path that escapes the run's out/ dir", () => {
    const store = freshStore();
    const rec = store.create("./local-repo");
    expect(() =>
      store.writeFiles(rec.id, [{ path: "../../escape.txt", kind: "config", content: "x" }]),
    ).toThrow(/escapes out\//);
  });

  it("hashSource is deterministic", () => {
    expect(hashSource("abc")).toBe(hashSource("abc"));
    expect(hashSource("abc")).not.toBe(hashSource("abd"));
  });
});
