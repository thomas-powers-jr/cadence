import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// 337-01 (phase 337) — `cadence doctor` and `cadence onboard` no longer call a
// `host-cli` verifier ready when its binary cannot be launched
// (rec-20261027-001). The providers.md caveat that documented the gap becomes
// an as-built amendment, the activation paragraph and the commands.md
// `verification-readiness` row say a host-cli binary must be found, and the
// onboard `--json` shape lists `seamsUnresolvable`.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const providersMd = readFileSync(join(ROOT, 'docs', 'providers.md'), 'utf8');
const commandsMd = readFileSync(join(ROOT, 'docs', 'reference', 'commands.md'), 'utf8');

/** Slice from `start` to the first `end` after it; '' when either is missing. */
function slice(md: string, start: string, end: string): string {
  const from = md.indexOf(start);
  if (from < 0) return '';
  const to = md.indexOf(end, from + start.length);
  return to > from ? md.slice(from, to) : '';
}

/** Collapse line wrapping so a phrase split across lines still matches. */
function flat(text: string): string {
  return text.replace(/\s+/g, ' ');
}

describe('docs: host-cli readiness checks the binary (337-01)', () => {
  it('337-01/AC-6: the providers.md readiness caveat says readiness confirms the binary will launch, via PATH or CADENCE_HOST_CLI_BIN', () => {
    const caveat = flat(slice(providersMd, '### Readiness reporting caveat', '### Deferred: batching'));
    expect(caveat).not.toBe('');
    expect(caveat).toMatch(/phase 337/i);
    expect(caveat).toMatch(/binary[^.]*will launch/);
    expect(caveat).toMatch(/PATH/);
    expect(caveat).toContain('CADENCE_HOST_CLI_BIN');
  });

  it('337-01/AC-6: the providers.md readiness caveat says login, reachability and the self-invocation guard are only discovered when a review runs', () => {
    const caveat = flat(slice(providersMd, '### Readiness reporting caveat', '### Deferred: batching'));
    expect(caveat).toMatch(/login/);
    expect(caveat).toMatch(/reachab/);
    expect(caveat).toMatch(/self-invocation guard/);
    expect(caveat).toMatch(/only (?:discovered|checked) when a review runs/);
    // History kept: the amendment still records what phase 165 did.
    expect(caveat).toMatch(/phase 165/i);
  });

  it('337-01/AC-6: the providers.md activation paragraph says ok also needs a host-cli seam binary to be found', () => {
    const paragraph = flat(
      slice(providersMd, 'To confirm the resulting state at any time, run `cadence doctor`', 'The manual steps below'),
    );
    expect(paragraph).not.toBe('');
    expect(paragraph).toMatch(/reports `ok` once a real provider with valid credentials is wired/);
    expect(paragraph).toMatch(/host-cli[^.]*binary[^.]*found/);
  });

  it('337-01/AC-6: the commands.md verification-readiness row warns when a host-cli seam binary cannot be found', () => {
    const row = commandsMd.split(/\r?\n/).find((line) => line.startsWith('| `verification-readiness` |')) ?? '';
    expect(row).not.toBe('');
    expect(row).toMatch(/\*\(phase 337\)\*[^|]*host-cli[^|]*binary cannot be found/);
  });

  it('337-01/AC-6: the commands.md onboard --json shape lists seamsUnresolvable', () => {
    const onboardSection = slice(commandsMd, '\n### onboard\n', '\n---\n');
    const onboard = flat(slice(onboardSection, 'With `--json`, stdout is', '**Exit codes**'));
    expect(onboard).not.toBe('');
    expect(onboard).toMatch(/verifier: \{ provider, keyPresent, ready, reason, seamsUnresolvable \}/);
    expect(onboard).toMatch(/`seamsUnresolvable` lists the `host-cli` seams whose binary was not found/);
  });
});
