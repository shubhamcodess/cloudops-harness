import { base, type Ctx } from "./fs.js";

export interface Infra {
  hasDockerfile: boolean;
  hasCompose: boolean;
  hasHelm: boolean;
  hasTerraform: boolean;
  hasK8sManifests: boolean;
  ci: "github-actions" | "gitlab-ci" | "none";
}

const K8S_KIND = /^kind:\s*(Deployment|StatefulSet|DaemonSet|Ingress|CronJob|Service)\s*$/m;

export function detectInfra(ctx: Ctx): Infra {
  const first = (pred: (f: string) => boolean) => ctx.files.find(pred);
  const docker = first((f) => /^Dockerfile(\..+)?$/.test(base(f)));
  const compose = first((f) => /^(docker-)?compose(\..+)?\.ya?ml$/.test(base(f)));
  const helm = first((f) => base(f) === "Chart.yaml");
  const tf = first((f) => f.endsWith(".tf"));
  const k8s = first((f) => /\.ya?ml$/.test(f) && !f.startsWith(".github/") && f !== compose && !/(^|\/)templates\//.test(f) && /^apiVersion:/m.test(ctx.read(f)) && K8S_KIND.test(ctx.read(f)));
  const gha = first((f) => /^\.github\/workflows\/.+\.ya?ml$/.test(f));
  const gl = first((f) => f === ".gitlab-ci.yml");
  const mark = (rule: string, file?: string) => file && ctx.emit(rule, file);
  mark("dockerfile", docker);
  mark("compose", compose);
  mark("helm", helm);
  mark("terraform", tf);
  mark("k8s-manifest", k8s);
  mark("ci", gha ?? gl);
  return {
    hasDockerfile: !!docker,
    hasCompose: !!compose,
    hasHelm: !!helm,
    hasTerraform: !!tf,
    hasK8sManifests: !!k8s,
    ci: gha ? "github-actions" : gl ? "gitlab-ci" : "none",
  };
}

export interface ComposeService {
  name: string;
  image?: string;
  build?: string;
  ports: number[];
  file: string;
}

export function parseCompose(ctx: Ctx): ComposeService[] {
  const out: ComposeService[] = [];
  for (const f of ctx.files.filter((f) => /^(docker-)?compose(\..+)?\.ya?ml$/.test(base(f)))) {
    let inServices = false;
    let cur: ComposeService | undefined;
    for (const line of ctx.read(f).split("\n")) {
      if (/^services:\s*$/.test(line)) inServices = true;
      else if (/^\S/.test(line)) inServices = false;
      if (!inServices) continue;
      const svc = line.match(/^ {2}([\w.-]+):\s*$/);
      if (svc) {
        cur = { name: svc[1]!, ports: [], file: f };
        out.push(cur);
        continue;
      }
      if (!cur) continue;
      const image = line.match(/^\s+image:\s*["']?([^\s"']+)/);
      if (image) cur.image = image[1];
      const build = line.match(/^\s+build:\s*["']?([^\s"']+)/);
      if (build) cur.build = build[1]!.replace(/^\.\//, "");
      for (const p of line.matchAll(/["']?(?:\d+:)?(\d{2,5})["']?(?=\s*[,\]]|\s*$)/g)) if (/ports:|^\s+-\s*["']?\d/.test(line)) cur.ports.push(Number(p[1]));
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
