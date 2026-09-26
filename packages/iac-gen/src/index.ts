import type { Candidate, GeneratedFile, RepoProfile, Requirements, SecretsManifest } from "@smc/contracts";
import { dockerfile } from "./dockerfile.js";
import { terraform } from "./terraform.js";
import { helm } from "./helm.js";
import { ci } from "./ci.js";
import { policy } from "./policy.js";
import { slug, sortFiles } from "./util.js";

export type GenerateInput = {
  profile: RepoProfile;
  requirements: Requirements;
  candidate: Candidate;
  secrets: SecretsManifest;
  appName: string;
};

export const generateArtifacts = (input: GenerateInput): GeneratedFile[] => {
  const app = slug(input.appName);
  const ctx = {
    app,
    profile: input.profile,
    reqs: input.requirements,
    candidate: input.candidate,
    secrets: input.secrets,
  };
  const files: GeneratedFile[] = [
    ...dockerfile(input.profile),
    ...terraform(ctx),
    ...helm(ctx),
    ...ci(app, input.candidate),
    ...policy(app, input.requirements),
  ];
  return sortFiles(files);
};

export default generateArtifacts;
