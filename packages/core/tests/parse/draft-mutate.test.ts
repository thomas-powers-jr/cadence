import { describe, it, expect } from 'vitest';
import { setObjective, addAcceptanceCriterion, addTask } from '../../src/parse/draft-mutate.js';
import { parseDraftMd } from '../../src/parse/draft-parser.js';

const DRAFT = `---
phase: 01-foundation
id: 01-01
tier: standard
status: PENDING
---

# 01-01 — Demo

## Objective

Make widget glow.

## Acceptance Criteria

### AC-1: Glows
Given widget exists
When user enables glow mode
Then widget emits photons

## Tasks

### T1: Add glow flag
- files: \`src/widget.ts\`, \`tests/widget.test.ts\`
- action: add boolean glow prop
- verify: vitest passes
- done: AC-1

## Boundaries

- Do not change \`src/legacy.ts\`
`;

describe('setObjective (AC-1)', () => {
  it('replaces only the Objective body; parseDraftMd sees the new objective', () => {
    const out = setObjective(DRAFT, 'Make widget sparkle.');
    expect(parseDraftMd(out).objective).toBe('Make widget sparkle.');
  });

  it('leaves every other section byte-identical', () => {
    const out = setObjective(DRAFT, 'Make widget sparkle.');
    const before = parseDraftMd(DRAFT);
    const after = parseDraftMd(out);
    expect(after.acceptanceCriteria).toEqual(before.acceptanceCriteria);
    expect(after.tasks).toEqual(before.tasks);
    expect(after.boundaries).toEqual(before.boundaries);
    expect(after.status).toBe(before.status);
    expect(after.phase).toBe(before.phase);
    expect(after.id).toBe(before.id);
    expect(after.tier).toBe(before.tier);
  });

  it('frontmatter and everything up to Objective is untouched', () => {
    const out = setObjective(DRAFT, 'Make widget sparkle.');
    expect(out.startsWith('---\nphase: 01-foundation\nid: 01-01\ntier: standard\nstatus: PENDING\n---\n\n# 01-01 — Demo\n\n## Objective\n\nMake widget sparkle.\n\n## Acceptance Criteria')).toBe(true);
  });
});

describe('addAcceptanceCriterion (AC-2)', () => {
  it('appends AC-2 with sequential id after the highest existing AC id', () => {
    const out = addAcceptanceCriterion(DRAFT, {
      given: 'a logged-in user',
      when: 'they click save',
      then: 'the record persists',
      name: 'Saves record',
    });
    const d = parseDraftMd(out);
    expect(d.acceptanceCriteria).toHaveLength(2);
    expect(d.acceptanceCriteria[1]).toEqual({
      id: 'AC-2',
      name: 'Saves record',
      given: 'a logged-in user',
      when: 'they click save',
      then: 'the record persists',
    });
    // Original AC-1 untouched.
    expect(d.acceptanceCriteria[0]?.id).toBe('AC-1');
  });

  it('supports an omitted name (empty name, no junk in heading)', () => {
    const out = addAcceptanceCriterion(DRAFT, {
      given: 'g',
      when: 'w',
      then: 't',
    });
    expect(out).toContain('### AC-2: \nGiven g\nWhen w\nThen t');
    const d = parseDraftMd(out);
    expect(d.acceptanceCriteria[1]?.name).toBe('');
  });

  it('leaves Tasks/Boundaries/frontmatter untouched', () => {
    const out = addAcceptanceCriterion(DRAFT, { given: 'g', when: 'w', then: 't' });
    const before = parseDraftMd(DRAFT);
    const after = parseDraftMd(out);
    expect(after.tasks).toEqual(before.tasks);
    expect(after.boundaries).toEqual(before.boundaries);
    expect(after.objective).toBe(before.objective);
  });
});

describe('addTask (AC-3)', () => {
  it('appends T2 with sequential id, backtick files, and given action/verify/done', () => {
    const out = addTask(DRAFT, {
      files: ['src/a.ts', 'src/b.ts'],
      action: 'wire the second flag',
      verify: 'vitest passes',
      done: ['AC-1'],
    });
    const d = parseDraftMd(out);
    expect(d.tasks).toHaveLength(2);
    expect(d.tasks[1]).toMatchObject({
      id: 'T2',
      files: ['src/a.ts', 'src/b.ts'],
      action: 'wire the second flag',
      verify: 'vitest passes',
      done: 'AC-1',
    });
    expect(out).toContain('### T2: \n- files: `src/a.ts`, `src/b.ts`\n- action: wire the second flag\n- verify: vitest passes\n- done: AC-1');
  });

  it('supports multiple done AC ids joined with comma-space', () => {
    const withTwoAcs = addAcceptanceCriterion(DRAFT, { given: 'g', when: 'w', then: 't' });
    const out = addTask(withTwoAcs, {
      files: ['x.ts'],
      action: 'a',
      verify: 'v',
      done: ['AC-1', 'AC-2'],
    });
    const d = parseDraftMd(out);
    expect(d.tasks[1]?.done).toBe('AC-1, AC-2');
  });

  it('AC-3/AC-5: refuses (throws) when a referenced AC id does not exist, and leaves the string unmodified', () => {
    expect(() =>
      addTask(DRAFT, { files: ['x.ts'], action: 'a', verify: 'v', done: ['AC-9'] }),
    ).toThrow(/AC-9/);
  });

  it('does not mutate input on refusal (functions are pure)', () => {
    const before = DRAFT;
    try {
      addTask(DRAFT, { files: ['x.ts'], action: 'a', verify: 'v', done: ['AC-9'] });
    } catch {
      // expected
    }
    expect(DRAFT).toBe(before);
  });

  it('leaves Objective/Boundaries/frontmatter untouched', () => {
    const out = addTask(DRAFT, { files: ['x.ts'], action: 'a', verify: 'v', done: ['AC-1'] });
    const before = parseDraftMd(DRAFT);
    const after = parseDraftMd(out);
    expect(after.objective).toBe(before.objective);
    expect(after.boundaries).toEqual(before.boundaries);
    expect(after.acceptanceCriteria).toEqual(before.acceptanceCriteria);
  });
});

describe('AC-5: round-trip regression', () => {
  it('a draft built entirely via the three helpers parses identically to an equivalent hand-edited draft', () => {
    let out = setObjective(DRAFT, 'Make widget sparkle.');
    out = addAcceptanceCriterion(out, {
      given: 'a logged-in user',
      when: 'they click save',
      then: 'the record persists',
      name: 'Saves record',
    });
    out = addTask(out, {
      files: ['src/save.ts'],
      action: 'implement save',
      verify: 'vitest passes',
      done: ['AC-2'],
    });

    const HAND_EDITED = `---
phase: 01-foundation
id: 01-01
tier: standard
status: PENDING
---

# 01-01 — Demo

## Objective

Make widget sparkle.

## Acceptance Criteria

### AC-1: Glows
Given widget exists
When user enables glow mode
Then widget emits photons

### AC-2: Saves record
Given a logged-in user
When they click save
Then the record persists

## Tasks

### T1: Add glow flag
- files: \`src/widget.ts\`, \`tests/widget.test.ts\`
- action: add boolean glow prop
- verify: vitest passes
- done: AC-1

### T2:
- files: \`src/save.ts\`
- action: implement save
- verify: vitest passes
- done: AC-2

## Boundaries

- Do not change \`src/legacy.ts\`
`;

    expect(parseDraftMd(out)).toEqual(parseDraftMd(HAND_EDITED));
  });
});

// Phase 339 (rec-20260918-006): the mutations splice on normalized text and
// write back in the input's detected style, so a CRLF or BOM draft edited on
// Windows keeps its encoding and changes only the edited bytes.
describe('draft mutations on CRLF / BOM drafts (phase 339)', () => {
  const BOM = '\uFEFF';
  const crlf = (s: string): string => s.replace(/\n/g, '\r\n');
  const ENCODINGS: Array<[string, (lf: string) => string, { bom: boolean; crlf: boolean }]> = [
    ['CRLF', (lf) => crlf(lf), { bom: false, crlf: true }],
    ['BOM+CRLF', (lf) => BOM + crlf(lf), { bom: true, crlf: true }],
    ['BOM+LF', (lf) => BOM + lf, { bom: true, crlf: false }],
    // One CRLF line in an otherwise-LF file: detected as crlf, written as all-CRLF.
    ['mixed', (lf) => lf.replace('\n', '\r\n'), { bom: false, crlf: true }],
  ];
  const MUTATIONS: Array<[string, (raw: string) => string]> = [
    ['setObjective', (raw) => setObjective(raw, 'Make widget sparkle.')],
    [
      'addAcceptanceCriterion',
      (raw) => addAcceptanceCriterion(raw, { name: 'Dims', given: 'glow is on', when: 'user dims', then: 'photons drop' }),
    ],
    [
      'addTask',
      (raw) => addTask(raw, { files: ['src/dim.ts'], action: 'add dimmer', verify: 'vitest passes', done: ['AC-1'] }),
    ],
  ];
  const strip = (s: string): string => (s.startsWith(BOM) ? s.slice(1) : s);

  for (const [mName, mutate] of MUTATIONS) {
    for (const [eName, encode, style] of ENCODINGS) {
      it(`339-01/AC-5: ${mName} succeeds on a ${eName} draft and writes back in that style`, () => {
        const out = mutate(encode(DRAFT));
        const lfOut = mutate(DRAFT);
        expect(out.startsWith(BOM)).toBe(style.bom);
        expect(out).not.toContain('\r\r');
        if (style.crlf) {
          expect(out).not.toMatch(/(^|[^\r])\n/);
          expect(strip(out)).toBe(crlf(lfOut));
        } else {
          expect(out).not.toContain('\r');
          expect(strip(out)).toBe(lfOut);
        }
      });
    }
  }

  it('339-01/AC-5: a lone-CR draft is written back as LF by every mutation', () => {
    const loneCr = DRAFT.replace(/\n/g, '\r');
    for (const [, mutate] of MUTATIONS) {
      const out = mutate(loneCr);
      expect(out).not.toContain('\r');
      expect(out).toBe(mutate(DRAFT));
    }
  });

  it('339-01/AC-5: an LF draft with an \\r-free payload is written byte-for-byte as before', () => {
    expect(setObjective(DRAFT, 'Make widget sparkle.')).toBe(
      DRAFT.replace('Make widget glow.', 'Make widget sparkle.'),
    );
    expect(addAcceptanceCriterion(DRAFT, { name: 'Dims', given: 'g', when: 'w', then: 't' })).toBe(
      DRAFT.replace(
        'Then widget emits photons\n',
        'Then widget emits photons\n\n### AC-2: Dims\nGiven g\nWhen w\nThen t\n',
      ),
    );
    expect(addTask(DRAFT, { files: ['src/d.ts'], action: 'a', verify: 'v', done: ['AC-1'] })).toBe(
      DRAFT.replace(
        '- done: AC-1\n',
        '- done: AC-1\n\n### T2: \n- files: `src/d.ts`\n- action: a\n- verify: v\n- done: AC-1\n',
      ),
    );
    // A payload's leading U+FEFF is content, not an encoding marker: kept as before.
    expect(setObjective(DRAFT, `${BOM}lead`)).toBe(DRAFT.replace('Make widget glow.', `${BOM}lead`));
  });

  it('339-01/AC-5: a payload carrying CRLF never yields \\r\\r in a CRLF draft or a stray \\r in an LF draft', () => {
    const intoCrlf = setObjective(crlf(DRAFT), 'line one\r\nline two');
    expect(intoCrlf).not.toContain('\r\r');
    expect(intoCrlf).toBe(crlf(setObjective(DRAFT, 'line one\nline two')));

    const intoLf = addTask(DRAFT, {
      files: ['src/a.ts'],
      action: 'first\r\nsecond',
      verify: 'ok\r',
      done: ['AC-1'],
    });
    expect(intoLf).not.toContain('\r');
    const acIntoCrlf = addAcceptanceCriterion(crlf(DRAFT), { given: 'a\r\nb', when: 'w', then: 't' });
    expect(acIntoCrlf).not.toContain('\r\r');
    expect(acIntoCrlf).not.toMatch(/(^|[^\r])\n/);
  });
});
