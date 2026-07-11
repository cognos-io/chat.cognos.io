import { Unzip, UnzipInflate } from 'fflate';

import { ImportParseError } from './import-types';

const MAX_ENTRIES = 2_000;
const MAX_EXPANDED_BYTES = 250 * 1024 * 1024;
const MAX_PATH_DEPTH = 8;

export interface ZipEntry {
  name: string;
  compressedSize: number;
  expandedSize: number;
  compression: number;
}

export function validateZipPath(name: string): boolean {
  if (
    !name ||
    name.includes('\0') ||
    name.includes('\\') ||
    name.startsWith('/') ||
    name.startsWith('//') ||
    /^[a-zA-Z]:/.test(name)
  ) {
    return false;
  }
  const path = name.endsWith('/') ? name.slice(0, -1) : name;
  const parts = path.split('/');
  return (
    parts.length <= MAX_PATH_DEPTH &&
    parts.every((part) => part !== '' && part !== '.' && part !== '..')
  );
}

export function inspectZip(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEndOfCentralDirectory(view);
  if (view.getUint16(eocd + 4, true) !== 0 || view.getUint16(eocd + 6, true) !== 0) {
    throw new ImportParseError('unsupported_schema');
  }
  const entryCount = view.getUint16(eocd + 10, true);
  const centralSize = view.getUint32(eocd + 12, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  if (
    entryCount === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff ||
    entryCount > MAX_ENTRIES ||
    centralOffset + centralSize > eocd
  ) {
    throw new ImportParseError('unsupported_schema');
  }
  const entries: ZipEntry[] = [];
  const names = new Set<string>();
  let offset = centralOffset;
  let totalExpanded = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > eocd || view.getUint32(offset, true) !== 0x02014b50) {
      throw new ImportParseError('unsupported_schema');
    }
    const flags = view.getUint16(offset + 8, true);
    const compression = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const expandedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const next = offset + 46 + nameLength + extraLength + commentLength;
    if (next > eocd || flags & 1 || (compression !== 0 && compression !== 8)) {
      throw new ImportParseError('unsupported_schema');
    }
    const name = new TextDecoder('utf-8', { fatal: true }).decode(
      bytes.subarray(offset + 46, offset + 46 + nameLength),
    );
    const canonical = name.toLocaleLowerCase('en-US');
    if (!validateZipPath(name) || names.has(canonical)) {
      throw new ImportParseError('unsupported_schema');
    }
    names.add(canonical);
    totalExpanded += expandedSize;
    if (totalExpanded > MAX_EXPANDED_BYTES) {
      throw new ImportParseError('too_large');
    }
    entries.push({ name, compressedSize, expandedSize, compression });
    offset = next;
  }
  return entries;
}

export async function extractConversationJsonFiles(
  bytes: Uint8Array,
): Promise<string[]> {
  const entries = inspectZip(bytes);
  const selected = new Set(
    entries
      .map((entry) => entry.name)
      .filter((name) => /(^|\/)conversations(?:[-_]\d+)?\.json$/i.test(name)),
  );
  if (selected.size === 0) {
    throw new ImportParseError('unsupported_schema');
  }
  return new Promise((resolve, reject) => {
    const results: string[] = [];
    let completed = 0;
    let actualExpanded = 0;
    const unzip = new Unzip((file) => {
      if (!selected.has(file.name)) {
        return;
      }
      const chunks: Uint8Array[] = [];
      file.ondata = (error, chunk, final) => {
        if (error) {
          reject(new ImportParseError('unsupported_schema'));
          return;
        }
        actualExpanded += chunk.byteLength;
        if (actualExpanded > MAX_EXPANDED_BYTES) {
          file.terminate();
          reject(new ImportParseError('too_large'));
          return;
        }
        chunks.push(chunk);
        if (final) {
          try {
            results.push(
              new TextDecoder('utf-8', { fatal: true }).decode(joinChunks(chunks)),
            );
          } catch {
            reject(new ImportParseError('unsupported_schema'));
            return;
          }
          completed += 1;
          if (completed === selected.size) resolve(results);
        }
      };
      file.start();
    });
    unzip.register(UnzipInflate);
    try {
      unzip.push(bytes, true);
    } catch {
      reject(new ImportParseError('unsupported_schema'));
    }
  });
}

function findEndOfCentralDirectory(view: DataView): number {
  const minimum = Math.max(0, view.byteLength - 65_557);
  for (let offset = view.byteLength - 22; offset >= minimum; offset -= 1) {
    if (
      view.getUint32(offset, true) === 0x06054b50 &&
      offset + 22 + view.getUint16(offset + 20, true) === view.byteLength
    ) {
      return offset;
    }
  }
  throw new ImportParseError('unsupported_schema');
}

function joinChunks(chunks: Uint8Array[]): Uint8Array {
  const length = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const joined = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}
