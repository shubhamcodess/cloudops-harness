import type { RepoProfile } from "@smc/contracts";
import { file } from "./util.js";

type Lang = { image: string; runtime: string; install: string; build?: string; artifact: string; port: number; runCmd: string };

const detect = (p: RepoProfile): { lang: string; pm: RepoProfile["packageManager"]; static: boolean } => {
  const pm = p.packageManager;
  const langs = p.languages.map((l) => l.toLowerCase());
  const isStatic = p.workloadType === "static-site";
  let lang = "node";
  if (langs.some((l) => /python/.test(l))) lang = "python";
  else if (langs.some((l) => /java|kotlin/.test(l))) lang = "java";
  else if (langs.some((l) => /^go$/.test(l))) lang = "go";
  else if (langs.some((l) => /typescript|javascript|node/.test(l))) lang = "node";
  return { lang, pm, static: isStatic };
};

const firstPort = (p: RepoProfile, def: number): number => {
  const s = p.services.find((x) => typeof x.port === "number");
  return s?.port ?? def;
};

const firstStart = (p: RepoProfile): string | undefined => p.services.find((x) => x.startCmd)?.startCmd;

const nodePmInstall = (pm: RepoProfile["packageManager"]): string => {
  switch (pm) {
    case "pnpm":
      return "RUN corepack enable && corepack prepare pnpm@9.12.0 --activate\nRUN pnpm install --frozen-lockfile";
    case "yarn":
      return "RUN corepack enable && corepack prepare yarn@1.22.22 --activate\nRUN yarn install --frozen-lockfile";
    default:
      return "RUN npm ci";
  }
};

const nodePmRun = (pm: RepoProfile["packageManager"], script: string): string => {
  switch (pm) {
    case "pnpm":
      return `pnpm ${script}`;
    case "yarn":
      return `yarn ${script}`;
    default:
      return `npm run ${script}`;
  }
};

export const dockerfile = (p: RepoProfile) => {
  const d = detect(p);
  const port = firstPort(p, d.static ? 80 : 8080);
  const startCmd = firstStart(p);
  let content: string;

  if (d.static) {
    content = `# syntax=docker/dockerfile:1.7
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
${nodePmInstall(d.pm === "none" ? "npm" : d.pm)}
COPY . .
RUN ${nodePmRun(d.pm === "none" ? "npm" : d.pm, "build")} || true

FROM nginx:1.27-alpine
RUN addgroup -g 10001 app && adduser -D -u 10001 -G app app
COPY --from=build /app/dist /usr/share/nginx/html
RUN chown -R app:app /usr/share/nginx/html /var/cache/nginx /var/run
USER app
EXPOSE ${port}
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:${port}/ || exit 1
CMD ["nginx", "-g", "daemon off;"]
`;
  } else if (d.lang === "node") {
    const cmd = startCmd ?? "node dist/index.js";
    content = `# syntax=docker/dockerfile:1.7
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
${nodePmInstall(d.pm === "none" ? "npm" : d.pm)}
COPY . .
RUN ${nodePmRun(d.pm === "none" ? "npm" : d.pm, "build")} || true

FROM node:20-alpine
RUN addgroup -g 10001 app && adduser -D -u 10001 -G app app
WORKDIR /app
COPY --from=build --chown=app:app /app /app
USER app
ENV NODE_ENV=production PORT=${port}
EXPOSE ${port}
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:${port}/health || exit 1
CMD ${JSON.stringify(cmd.split(" "))}
`;
  } else if (d.lang === "python") {
    const install =
      d.pm === "poetry"
        ? "RUN pip install --no-cache-dir poetry==1.8.3 && poetry config virtualenvs.create false && poetry install --no-interaction --no-ansi --without dev"
        : d.pm === "uv"
        ? "RUN pip install --no-cache-dir uv==0.4.20 && uv pip install --system -r requirements.txt || uv sync --frozen"
        : "RUN pip install --no-cache-dir -r requirements.txt";
    const cmd = startCmd ?? `gunicorn -b 0.0.0.0:${port} app:app`;
    content = `# syntax=docker/dockerfile:1.7
FROM python:3.12-slim AS build
WORKDIR /app
COPY . .
${install}

FROM python:3.12-slim
RUN groupadd -g 10001 app && useradd -m -u 10001 -g app app
WORKDIR /app
COPY --from=build --chown=app:app /app /app
COPY --from=build /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=build /usr/local/bin /usr/local/bin
USER app
ENV PORT=${port} PYTHONUNBUFFERED=1
EXPOSE ${port}
HEALTHCHECK --interval=30s --timeout=3s CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:${port}/health')" || exit 1
CMD ${JSON.stringify(cmd.split(" "))}
`;
  } else if (d.lang === "java") {
    const build = d.pm === "gradle" ? "RUN ./gradlew --no-daemon bootJar" : "RUN mvn -q -DskipTests package";
    const artifact = d.pm === "gradle" ? "build/libs/*.jar" : "target/*.jar";
    content = `# syntax=docker/dockerfile:1.7
FROM eclipse-temurin:21-jdk AS build
WORKDIR /app
COPY . .
${build}

FROM eclipse-temurin:21-jre
RUN groupadd -g 10001 app && useradd -m -u 10001 -g app app
WORKDIR /app
COPY --from=build --chown=app:app /app/${artifact} /app/app.jar
USER app
ENV PORT=${port}
EXPOSE ${port}
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:${port}/actuator/health || exit 1
CMD ["java", "-jar", "/app/app.jar"]
`;
  } else {
    content = `# syntax=docker/dockerfile:1.7
FROM golang:1.23-alpine AS build
WORKDIR /src
COPY . .
RUN CGO_ENABLED=0 go build -o /out/app ./...

FROM gcr.io/distroless/static:nonroot
USER nonroot:nonroot
COPY --from=build /out/app /app
ENV PORT=${port}
EXPOSE ${port}
HEALTHCHECK --interval=30s --timeout=3s CMD ["/app", "-healthcheck"]
ENTRYPOINT ["/app"]
`;
  }

  const ignore = `.git
.gitignore
node_modules
dist
build
target
.venv
__pycache__
*.pyc
.env
.env.*
!.env.example
*.log
.DS_Store
coverage
.idea
.vscode
Dockerfile
.dockerignore
README.md
`;

  return [file("Dockerfile", content, "dockerfile"), file(".dockerignore", ignore, "dockerfile")];
};
