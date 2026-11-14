#!/usr/bin/env node
// Decides whether a change can alter a platform or template image. The
// container image workflow runs on every pull request so it can be a required
// check; when no listed input changed it finishes as a no-op.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const imageInputs = [
  /^apps\/[^/]+\/Dockerfile$/,
  /^apps\/[^/]+\/package\.json$/,
  /^apps\/web\/nginx[^/]*\.conf$/,
  /^apps\/api\/prisma\/schema\.prisma$/,
  /^templates\//,
  /^deploy\/[^/]+\.yml$/,
  /^infra\//,
  /^package(-lock)?\.json$/,
  /^\.node-version$/,
  /^\.dockerignore$/,
  /^\.trivyignore\.yaml$/,
  /^scripts\/test-template-images\.sh$/,
  /^scripts\/container-image-inputs\.mjs$/,
  /^\.github\/dependabot\.yml$/,
  /^\.github\/workflows\/container-images\.yml$/,
];

export function touchesImageInputs(paths) {
  return paths.some((path) => imageInputs.some((pattern) => pattern.test(path)));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const paths = readFileSync(0, 'utf8').split('\n').filter(Boolean);
  process.stdout.write(`${touchesImageInputs(paths)}\n`);
}
