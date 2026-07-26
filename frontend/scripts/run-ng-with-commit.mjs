#!/usr/bin/env node
/**
 * Run the Angular CLI with __COGNOS_COMMIT_SHA__ defined from:
 * 1. COGNOS_COMMIT_SHA env (deploy/CI), else
 * 2. `git rev-parse HEAD`, else
 * 3. "unknown"
 *
 * Usage: node ./scripts/run-ng-with-commit.mjs <ng-args...>
 * Example: node ./scripts/run-ng-with-commit.mjs build --configuration e2e
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const frontendRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function resolveCommitSha() {
  const fromEnv = process.env.COGNOS_COMMIT_SHA?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
      cwd: frontendRoot,
    }).trim();
  } catch {
    return 'unknown';
  }
}

const sha = resolveCommitSha();
const ngArgs = process.argv.slice(2);
const result = spawnSync(
  'pnpm',
  ['exec', 'ng', ...ngArgs, '--define', `__COGNOS_COMMIT_SHA__=${JSON.stringify(sha)}`],
  {
    cwd: frontendRoot,
    stdio: 'inherit',
    env: process.env,
  },
);

process.exit(result.status ?? 1);
