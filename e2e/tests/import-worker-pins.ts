import { expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const REPO_ROOT = resolve('..');

export const FORBIDDEN_WORKER_APIS = [
  'fetch(',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'console.',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'importScripts',
] as const;

export async function readImportWorkerSource(): Promise<string> {
  return readFile(
    resolve(REPO_ROOT, 'frontend/src/app/import/conversation-import.worker.ts'),
    'utf8',
  );
}

export async function readZipArchiveSource(): Promise<string> {
  return readFile(resolve(REPO_ROOT, 'frontend/src/app/import/zip-archive.ts'), 'utf8');
}

/** Pin PER-004: Helix must not reach network, console or persistence APIs. */
export async function pinWorkerHasNoNetworkConsoleOrPersistence(): Promise<void> {
  const source = await readImportWorkerSource();
  for (const forbidden of FORBIDDEN_WORKER_APIS) {
    expect(source, `worker source must not contain ${forbidden}`).not.toContain(
      forbidden,
    );
  }
}

/**
 * Pin PER-004 friction #1: unsafe ZIP paths are rejected at central-directory
 * listing (inspectZip), before any inflate/extract work.
 */
export async function pinZipPathTraversalRejectedAtListing(): Promise<void> {
  const source = await readZipArchiveSource();
  expect(source).toContain('export function validateZipPath');
  expect(source).toContain('!validateZipPath(name)');

  const inspectIdx = source.indexOf('function inspectZip');
  const rejectIdx = source.indexOf('!validateZipPath(name)');
  const inflateIdx = source.indexOf('new Unzip');
  expect(inspectIdx, 'inspectZip must exist').toBeGreaterThan(-1);
  expect(rejectIdx, 'validateZipPath guard must exist').toBeGreaterThan(inspectIdx);
  expect(inflateIdx, 'inflate must follow listing validation').toBeGreaterThan(
    rejectIdx,
  );
}
