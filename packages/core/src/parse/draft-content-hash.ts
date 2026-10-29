// Phase 340: a content fingerprint of a DRAFT as the parsers see it. Hashing
// the normalized text (phase 339's `normalizeText`) means a BOM or line-ending
// rewrite by an editor, git autocrlf or PowerShell leaves the hash unchanged,
// while any real content edit changes it. `draft approve` stamps it into
// `state.draftReadHash` beside `draftReadAt`.
import { createHash } from 'node:crypto';
import { normalizeText } from './text-normalize.js';

/** Lowercase-hex sha256 of `normalizeText(raw).text`. Pure; no I/O. */
export function draftContentHash(raw: string): string {
  return createHash('sha256').update(normalizeText(raw).text, 'utf8').digest('hex');
}
