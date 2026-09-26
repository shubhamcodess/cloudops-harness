import { setup, createActor, assign, fromPromise, type ActorRefFrom } from "xstate";
import type {
  RepoProfile,
  Requirements,
  CostModel,
  Decision,
  GeneratedFile,
  ProofReport,
} from "@smc/contracts";
import { Ledger } from "./ledger.js";

export interface PipelineInput {
  source: { kind: "git" | "path"; ref: string };
  partial?: Partial<Requirements>;
}

export interface PipelineDeps {
  ingest: (input: PipelineInput) => Promise<{ workspace: string }>;
  detect: (workspace: string) => Promise<RepoProfile>;
  askUser: (profile: RepoProfile, partial: Partial<Requirements>) => Promise<Requirements>;
  cost: (profile: RepoProfile, req: Requirements) => Promise<CostModel>;
  decide: (profile: RepoProfile, req: Requirements, cost: CostModel) => Promise<Decision>;
  generate: (profile: RepoProfile, req: Requirements, decision: Decision) => Promise<GeneratedFile[]>;
  verify: (files: GeneratedFile[]) => Promise<ProofReport>;
  deliver: (files: GeneratedFile[], report: ProofReport) => Promise<{ url: string }>;
}

export interface PipelineContext {
  input: PipelineInput;
  ledger: Ledger;
  workspace?: string;
  profile?: RepoProfile;
  requirements?: Requirements;
  cost?: CostModel;
  decision?: Decision;
  files?: GeneratedFile[];
  report?: ProofReport;
  delivery?: { url: string };
  error?: string;
}

const record = (ctx: PipelineContext, state: string, output: unknown) => {
  ctx.ledger.append({ state, rule: state, engine: "rule", input: {}, output });
};

export function makePipelineMachine(deps: PipelineDeps) {
  return setup({
    types: {} as {
      context: PipelineContext;
      input: PipelineInput;
      events: { type: "APPROVE" } | { type: "REJECT"; reason?: string };
    },
    actors: {
      ingest: fromPromise(({ input }: { input: PipelineInput }) => deps.ingest(input)),
      detect: fromPromise(({ input }: { input: string }) => deps.detect(input)),
      askUser: fromPromise(({ input }: { input: { profile: RepoProfile; partial: Partial<Requirements> } }) =>
        deps.askUser(input.profile, input.partial),
      ),
      cost: fromPromise(({ input }: { input: { profile: RepoProfile; req: Requirements } }) =>
        deps.cost(input.profile, input.req),
      ),
      decide: fromPromise(
        ({ input }: { input: { profile: RepoProfile; req: Requirements; cost: CostModel } }) =>
          deps.decide(input.profile, input.req, input.cost),
      ),
      generate: fromPromise(
        ({ input }: { input: { profile: RepoProfile; req: Requirements; decision: Decision } }) =>
          deps.generate(input.profile, input.req, input.decision),
      ),
      verify: fromPromise(({ input }: { input: GeneratedFile[] }) => deps.verify(input)),
      deliver: fromPromise(({ input }: { input: { files: GeneratedFile[]; report: ProofReport } }) =>
        deps.deliver(input.files, input.report),
      ),
    },
  }).createMachine({
    id: "pipeline",
    initial: "INGEST",
    context: ({ input }) => ({ input, ledger: new Ledger() }),
    states: {
      INGEST: {
        invoke: {
          src: "ingest",
          input: ({ context }) => context.input,
          onDone: {
            target: "DETECT",
            actions: assign(({ context, event }) => {
              record(context, "INGEST", event.output);
              return { workspace: event.output.workspace };
            }),
          },
          onError: { target: "FAILED", actions: assign({ error: ({ event }) => String(event.error) }) },
        },
      },
      DETECT: {
        invoke: {
          src: "detect",
          input: ({ context }) => context.workspace!,
          onDone: {
            target: "INTERVIEW",
            actions: assign(({ context, event }) => {
              record(context, "DETECT", { workloadType: event.output.workloadType });
              return { profile: event.output };
            }),
          },
          onError: { target: "FAILED", actions: assign({ error: ({ event }) => String(event.error) }) },
        },
      },
      INTERVIEW: {
        invoke: {
          src: "askUser",
          input: ({ context }) => ({ profile: context.profile!, partial: context.input.partial ?? {} }),
          onDone: {
            target: "COST",
            actions: assign(({ context, event }) => {
              record(context, "INTERVIEW", { fields: Object.keys(event.output) });
              return { requirements: event.output };
            }),
          },
          onError: { target: "FAILED", actions: assign({ error: ({ event }) => String(event.error) }) },
        },
      },
      COST: {
        invoke: {
          src: "cost",
          input: ({ context }) => ({ profile: context.profile!, req: context.requirements! }),
          onDone: {
            target: "DECIDE",
            actions: assign(({ context, event }) => {
              record(context, "COST", { candidates: event.output.candidates.length });
              return { cost: event.output };
            }),
          },
          onError: { target: "FAILED", actions: assign({ error: ({ event }) => String(event.error) }) },
        },
      },
      DECIDE: {
        invoke: {
          src: "decide",
          input: ({ context }) => ({
            profile: context.profile!,
            req: context.requirements!,
            cost: context.cost!,
          }),
          onDone: {
            target: "GENERATE",
            actions: assign(({ context, event }) => {
              record(context, "DECIDE", { chosenId: event.output.chosenId });
              return { decision: event.output };
            }),
          },
          onError: { target: "FAILED", actions: assign({ error: ({ event }) => String(event.error) }) },
        },
      },
      GENERATE: {
        invoke: {
          src: "generate",
          input: ({ context }) => ({
            profile: context.profile!,
            req: context.requirements!,
            decision: context.decision!,
          }),
          onDone: {
            target: "VERIFY",
            actions: assign(({ context, event }) => {
              record(context, "GENERATE", { files: event.output.length });
              return { files: event.output };
            }),
          },
          onError: { target: "FAILED", actions: assign({ error: ({ event }) => String(event.error) }) },
        },
      },
      VERIFY: {
        invoke: {
          src: "verify",
          input: ({ context }) => context.files!,
          onDone: {
            target: "REVIEW",
            actions: assign(({ context, event }) => {
              record(context, "VERIFY", { verdict: event.output.verdict });
              return { report: event.output };
            }),
          },
          onError: { target: "FAILED", actions: assign({ error: ({ event }) => String(event.error) }) },
        },
      },
      REVIEW: {
        // Human approval gate: only APPROVE advances to DELIVER.
        on: {
          APPROVE: {
            target: "DELIVER",
            actions: ({ context }) =>
              context.ledger.append({
                state: "REVIEW",
                rule: "approve",
                engine: "human",
                input: {},
                output: { approved: true },
              }),
          },
          REJECT: {
            target: "DECIDE",
            actions: ({ context, event }) =>
              context.ledger.append({
                state: "REVIEW",
                rule: "reject",
                engine: "human",
                input: {},
                output: { approved: false, reason: event.reason ?? "" },
              }),
          },
        },
      },
      DELIVER: {
        invoke: {
          src: "deliver",
          input: ({ context }) => ({ files: context.files!, report: context.report! }),
          onDone: {
            target: "DONE",
            actions: assign(({ context, event }) => {
              record(context, "DELIVER", event.output);
              return { delivery: event.output };
            }),
          },
          onError: { target: "FAILED", actions: assign({ error: ({ event }) => String(event.error) }) },
        },
      },
      DONE: { type: "final" },
      FAILED: {
        type: "final",
        entry: ({ context }) =>
          context.ledger.append({
            state: "FAILED",
            rule: "error",
            engine: "rule",
            input: {},
            output: { error: context.error ?? "unknown" },
          }),
      },
    },
  });
}

export type PipelineMachine = ReturnType<typeof makePipelineMachine>;
export type PipelineActor = ActorRefFrom<PipelineMachine>;

export interface RunOptions {
  onReview?: (actor: PipelineActor) => void | Promise<void>;
}

export async function runPipeline(
  deps: PipelineDeps,
  input: PipelineInput,
  opts: RunOptions = {},
): Promise<{ status: "DONE" | "FAILED"; context: PipelineContext }> {
  const machine = makePipelineMachine(deps);
  const actor = createActor(machine, { input });
  return await new Promise((resolve) => {
    let inReview = false;
    actor.subscribe((snap) => {
      const nowReview = snap.matches("REVIEW");
      if (nowReview && !inReview && opts.onReview) {
        void opts.onReview(actor);
      }
      inReview = nowReview;
      if (snap.status === "done") {
        resolve({
          status: snap.value === "DONE" ? "DONE" : "FAILED",
          context: snap.context,
        });
      }
    });
    actor.start();
  });
}
