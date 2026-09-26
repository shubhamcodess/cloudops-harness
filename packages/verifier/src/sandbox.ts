import { spawn } from "node:child_process";

export interface RunSpec {
  image: string;
  cmd: string[];
  dir: string;
  entrypoint?: string;
  env?: Record<string, string>;
  network?: boolean;
  timeoutMs?: number;
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface Sandbox {
  readonly name: string;
  run(spec: RunSpec): Promise<RunResult>;
}

const cap = (s: string, n = 20000) => (s.length > n ? s.slice(-n) : s);

function exec(cmd: string, args: string[], timeoutMs: number): Promise<RunResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: 127, stdout, stderr: String(e), durationMs: Date.now() - started });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout: cap(stdout), stderr: cap(stderr), durationMs: Date.now() - started });
    });
  });
}

/** Runs every step in a throwaway container: no host access beyond the mounted work dir, no real credentials. */
export class DockerSandbox implements Sandbox {
  readonly name = "docker";

  async run(spec: RunSpec): Promise<RunResult> {
    const args = ["run", "--rm", "-v", `${spec.dir}:/work`, "-w", "/work", "--cap-drop=ALL", "--security-opt=no-new-privileges"];
    if (!spec.network) args.push("--network=none");
    else args.push("--add-host=host.docker.internal:host-gateway");
    if (spec.entrypoint !== undefined) args.push("--entrypoint", spec.entrypoint);
    for (const [k, v] of Object.entries(spec.env ?? {})) args.push("-e", `${k}=${v}`);
    args.push(spec.image, ...spec.cmd);
    return exec("docker", args, spec.timeoutMs ?? 180_000);
  }
}
