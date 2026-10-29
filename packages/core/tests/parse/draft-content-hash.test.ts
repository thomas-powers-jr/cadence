// Phase 340 (340-01, T2) — draftContentHash hashes the NORMALIZED DRAFT text,
// so encoding-only differences (BOM, CRLF, lone CR) do not change the hash
// while any real content change does.
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { draftContentHash } from '../../src/parse/draft-content-hash.js';

const BOM = '\uFEFF';
const LF_TEXT = '---\nphase: 01-x\nid: 01-01\n---\n\n# 01-01 — Title\n\n## Objective\n\nDo it.\n';

describe('draftContentHash', () => {
  it('340-01/AC-1: LF, CRLF, BOM+LF, BOM+CRLF and lone-CR encodings hash identically', () => {
    const crlf = LF_TEXT.replace(/\n/g, '\r\n');
    const cr = LF_TEXT.replace(/\n/g, '\r');
    const variants = [LF_TEXT, crlf, BOM + LF_TEXT, BOM + crlf, cr];
    const hashes = variants.map(draftContentHash);
    expect(new Set(hashes).size).toBe(1);
    expect(hashes[0]).toBe(createHash('sha256').update(LF_TEXT).digest('hex'));
  });

  it('340-01/AC-1: a one-character content change hashes differently', () => {
    const changed = LF_TEXT.replace('Do it.', 'Do it!');
    expect(draftContentHash(changed)).not.toBe(draftContentHash(LF_TEXT));
  });

  it('340-01/AC-1: output is 64 lowercase hex characters', () => {
    expect(draftContentHash(LF_TEXT)).toMatch(/^[0-9a-f]{64}$/);
    expect(draftContentHash('')).toMatch(/^[0-9a-f]{64}$/);
  });
});
