import { randomBytes } from 'node:crypto';

const CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export const REFERENCE_CODE_PATTERN = /^MVR-\d{4}-[A-Z0-9]{4}$/;

/** Generates a human-readable booking reference: MVR-YYYY-XXXX. */
export function generateReferenceCode(year = new Date().getFullYear()): string {
  const bytes = randomBytes(4);
  let suffix = '';
  for (let i = 0; i < 4; i += 1) {
    suffix += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
  }
  return `MVR-${year}-${suffix}`;
}
