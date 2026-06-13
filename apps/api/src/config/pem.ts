import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const API_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const REPO_ROOT = resolve(API_ROOT, '../..');

/**
 * PEM values in .env must be single-line (Docker Compose cannot parse multi-line blocks).
 * Supported formats: inline PEM with literal newlines, `\n` escapes, or a path to a .pem file.
 */
export function resolvePemValue(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  if (trimmed.includes('-----BEGIN')) {
    return trimmed.replace(/\\n/g, '\n');
  }

  const searchRoots = [process.cwd(), API_ROOT, REPO_ROOT];
  for (const root of searchRoots) {
    const candidatePath = isAbsolute(trimmed) ? trimmed : resolve(root, trimmed);
    if (existsSync(candidatePath)) {
      return readFileSync(candidatePath, 'utf8').trim();
    }
  }

  return trimmed;
}
