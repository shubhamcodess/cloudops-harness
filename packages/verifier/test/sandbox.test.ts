import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DockerSandbox } from "../src/sandbox";

describe("DockerSandbox", () => {
  it("runs in an isolated container without network by default", async () => {
    const dir = mkdtempSync(join(tmpdir(), "smc-"));
    writeFileSync(join(dir, "a.txt"), "hello");
    const r = await new DockerSandbox().run({ image: "alpine:3.20", dir, cmd: ["sh", "-c", "cat a.txt && wget -T2 -qO- http://example.com || echo no-net"] });
    expect(r.stdout).toContain("hello");
    expect(r.stdout).toContain("no-net");
  });
});
