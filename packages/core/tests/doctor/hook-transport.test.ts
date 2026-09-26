import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempRepo, type Fixture } from '@thomas-powers-jr/cadence-testkit';
import { runDoctor, evaluateHookTransport } from '../../src/doctor/run.js';
import {
  classifyHostHooksSettings,
  readHostHooksInstallState,
} from '../../src/doctor/host-hooks-state.js';
import { STALE_NPM_SCOPE } from '../../src/doctor/host-hooks.js';
import { completeManagedHooksObject, writeCompleteManagedSettings } from './host-hooks-fixture.js';

const ENV = { nodeVersion: 'v22.11.0', platform: 'linux' as const };

const NA_NO_FILE = 'Not applicable — no .claude/settings.json here.';
const NA_INSTALL_PROBLEM =
  'Not applicable — host-hooks reports an install problem; fix that first.';
const SCOPE =
  'checked the first managed hook entry; hand-edited divergence across entries is not detected';
const REMEDIATION =
  'remove the `shell` field or set it to `"bash"`/`"powershell"`, or re-run `cadence-host-claude-code install`.';

let active: Fixture | null = null;
afterEach(async () => {
  if (active) {
    await active.cleanup();
    active = null;
  }
});

async function writeSettingsRaw(root: string, body: string): Promise<void> {
  await mkdir(join(root, '.claude'), { recursive: true });
  await writeFile(join(root, '.claude', 'settings.json'), body);
}

/**
 * A complete managed install whose managed entry at `entryIndex` (document
 * order across every event's array) has its first hook handler's `shell`
 * key set to `shell`. Claude Code reads `shell` from the command-hook
 * handler object (the one carrying `command`), not the outer entry.
 */
async function writeCompleteWithShell(
  root: string,
  shell: unknown,
  entryIndex = 0,
): Promise<void> {
  const hooks = completeManagedHooksObject();
  const entries = Object.values(hooks).flat() as Array<{ hooks: Array<Record<string, unknown>> }>;
  const target = entries[entryIndex];
  if (!target) throw new Error(`fixture: no managed entry at index ${entryIndex}`);
  const handler = target.hooks[0];
  if (!handler) throw new Error('fixture: managed entry has no handler');
  handler['shell'] = shell;
  await writeSettingsRaw(root, JSON.stringify({ hooks }));
}

async function hookTransport(root: string) {
  const report = await runDoctor(root, ENV);
  const check = report.checks.find((c) => c.name === 'hook-transport');
  if (!check) throw new Error('hook-transport check not registered');
  return { report, check };
}

describe('doctor hook-transport — install-state outcomes (317-01/AC-7)', () => {
  it('317-01/AC-7: missing .claude/settings.json → pass, not applicable (mirrors host-hooks wording)', async () => {
    active = await tempRepo({ initialized: true });
    const { check } = await hookTransport(active.root);
    expect(check.severity).toBe('ok');
    expect(check.detail).toBe(NA_NO_FILE);
    expect(check.remediation).toBeNull();
  });

  it('317-01/AC-7: invalid JSON → pass, not applicable (host-hooks reports the install problem)', async () => {
    active = await tempRepo({ initialized: true });
    await writeSettingsRaw(active.root, '{ not valid json');
    const { report, check } = await hookTransport(active.root);
    expect(report.checks.find((c) => c.name === 'host-hooks')?.severity).toBe('warning');
    expect(check.severity).toBe('ok');
    expect(check.detail).toBe(NA_INSTALL_PROBLEM);
  });

  it('317-01/AC-7: missing managed entries (incomplete install) → pass, not applicable', async () => {
    active = await tempRepo({ initialized: true });
    await writeCompleteManagedSettings(active.root, [
      { event: 'SubagentStart', matcher: null, omit: true },
    ]);
    const { report, check } = await hookTransport(active.root);
    expect(report.checks.find((c) => c.name === 'host-hooks')?.severity).toBe('error');
    expect(check.severity).toBe('ok');
    expect(check.detail).toBe(NA_INSTALL_PROBLEM);
  });

  it('317-01/AC-7: stale-scope managed entry → pass, not applicable', async () => {
    active = await tempRepo({ initialized: true });
    await writeCompleteManagedSettings(active.root, [
      { event: 'Stop', matcher: null, command: `npx ${STALE_NPM_SCOPE}cadence-host-claude-code hook` },
    ]);
    const { report, check } = await hookTransport(active.root);
    const hostHooks = report.checks.find((c) => c.name === 'host-hooks');
    expect(hostHooks?.severity).toBe('warning');
    expect(hostHooks?.detail).toMatch(/stale/);
    expect(check.severity).toBe('ok');
    expect(check.detail).toBe(NA_INSTALL_PROBLEM);
  });

  it('317-01/AC-7: no managed entries → pass, not applicable (pure evaluator; the classifier never reaches this state from a file because a complete set implies a marker)', () => {
    const check = evaluateHookTransport({ kind: 'no-managed-entries' });
    expect(check.name).toBe('hook-transport');
    expect(check.severity).toBe('ok');
    expect(check.detail).toBe(NA_INSTALL_PROBLEM);
  });
});

describe('doctor hook-transport — shell field on the first managed entry (317-01/AC-7)', () => {
  it('317-01/AC-7: absent shell key → pass stating the documented rule (not a measurement) and the first-entry scope', async () => {
    active = await tempRepo({ initialized: true });
    await writeCompleteManagedSettings(active.root);
    const { check } = await hookTransport(active.root);
    expect(check.severity).toBe('ok');
    expect(check.fixId).toBeNull();
    expect(check.detail).toContain(
      'no `shell` field is set on the installed hook command — per Claude Code\'s own docs this defaults to `bash`, or to `powershell` on Windows when Git Bash isn\'t installed; CADENCE blocks via a JSON decision on stdout regardless of which shell runs it, so this is informational, not a warning.',
    );
    expect(check.detail).toContain(SCOPE);
  });

  it('317-01/AC-7: shell "bash" → pass reporting the literal configured value', async () => {
    active = await tempRepo({ initialized: true });
    await writeCompleteWithShell(active.root, 'bash');
    const { check } = await hookTransport(active.root);
    expect(check.severity).toBe('ok');
    expect(check.detail).toContain('`shell: "bash"`');
    expect(check.detail).not.toContain('defaults to');
    expect(check.detail).toContain(SCOPE);
  });

  it('317-01/AC-7: shell "powershell" → pass reporting the literal configured value', async () => {
    active = await tempRepo({ initialized: true });
    await writeCompleteWithShell(active.root, 'powershell');
    const { check } = await hookTransport(active.root);
    expect(check.severity).toBe('ok');
    expect(check.detail).toContain('`shell: "powershell"`');
    expect(check.detail).not.toContain('defaults to');
    expect(check.detail).toContain(SCOPE);
  });

  it('317-01/AC-7: shell null (present key) → warning naming null, not the absent-key rule', async () => {
    active = await tempRepo({ initialized: true });
    await writeCompleteWithShell(active.root, null);
    const { report, check } = await hookTransport(active.root);
    expect(check.severity).toBe('warning');
    expect(check.fixId).toBeNull();
    expect(check.detail).toContain('`shell` to null');
    expect(check.detail).toContain('Claude Code documents only "bash" and "powershell"');
    expect(check.detail).toContain(SCOPE);
    expect(check.remediation).toBe(REMEDIATION);
    expect(report.ok).toBe(true); // a warning never fails the report
  });

  it('317-01/AC-7: shell "zsh" → warning naming the JSON-serialized value', async () => {
    active = await tempRepo({ initialized: true });
    await writeCompleteWithShell(active.root, 'zsh');
    const { check } = await hookTransport(active.root);
    expect(check.severity).toBe('warning');
    expect(check.detail).toContain('`shell` to "zsh"');
    expect(check.detail).toContain('Claude Code documents only "bash" and "powershell"');
    expect(check.detail).toContain(SCOPE);
    expect(check.remediation).toBe(REMEDIATION);
  });

  it('317-01/AC-7: shell "" → warning naming "" (distinguishable from null)', async () => {
    active = await tempRepo({ initialized: true });
    await writeCompleteWithShell(active.root, '');
    const { check } = await hookTransport(active.root);
    expect(check.severity).toBe('warning');
    expect(check.detail).toContain('`shell` to ""');
    expect(check.detail).not.toContain('`shell` to null');
    expect(check.remediation).toBe(REMEDIATION);
  });

  it('317-01/AC-7: other unsupported values ("pwsh", a number) → warning', async () => {
    for (const [value, rendered] of [
      ['pwsh', '"pwsh"'],
      [3, '3'],
    ] as const) {
      const check = evaluateHookTransport({
        kind: 'complete',
        firstManagedEntry: { hooks: [{ type: 'command', command: 'x', shell: value }], _managedBy: 'cadence' },
      });
      expect(check.severity).toBe('warning');
      expect(check.detail).toContain(`\`shell\` to ${rendered}`);
      expect(check.remediation).toBe(REMEDIATION);
    }
  });

  it('317-01/AC-7: only the first managed entry is inspected — an unsupported shell on a later entry is not detected, as the output states', async () => {
    active = await tempRepo({ initialized: true });
    await writeCompleteWithShell(active.root, 'zsh', 3);
    const { check } = await hookTransport(active.root);
    expect(check.severity).toBe('ok');
    expect(check.detail).toContain('no `shell` field is set');
    expect(check.detail).toContain(SCOPE);
  });

  it('317-01/AC-7: a first managed entry with no usable handler takes the absent-key path, never throws', () => {
    for (const firstManagedEntry of [
      { _managedBy: 'cadence' },
      { _managedBy: 'cadence', hooks: [] },
      { _managedBy: 'cadence', hooks: ['not-an-object'] },
    ]) {
      const check = evaluateHookTransport({ kind: 'complete', firstManagedEntry });
      expect(check.severity).toBe('ok');
      expect(check.detail).toContain('no `shell` field is set');
    }
  });

  it('317-01/AC-7: hook-transport is registered immediately after host-hooks', async () => {
    active = await tempRepo({ initialized: true });
    const report = await runDoctor(active.root, ENV);
    const names = report.checks.map((c) => c.name);
    const i = names.indexOf('host-hooks');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(names[i + 1]).toBe('hook-transport');
  });
});

describe('doctor hook-transport ↔ host-hooks shared classification (317-01/AC-7)', () => {
  it('317-01/AC-7: the shared classifier returns each real state and the first managed entry in document order', async () => {
    expect(classifyHostHooksSettings({ hooks: {} }).kind).toBe('incomplete');
    const complete = classifyHostHooksSettings({ hooks: completeManagedHooksObject() });
    expect(complete.kind).toBe('complete');
    if (complete.kind !== 'complete') throw new Error('unreachable');
    // SessionStart is the first event the fixture (and the installer) writes.
    expect(complete.firstManagedEntry).toEqual({
      hooks: [{ type: 'command', command: 'npx @thomas-powers-jr/cadence-host-claude-code hook' }],
      _managedBy: 'cadence',
    });
    const stale = classifyHostHooksSettings({
      hooks: completeManagedHooksObject([
        { event: 'Stop', matcher: null, command: `npx ${STALE_NPM_SCOPE}cadence-host-claude-code hook` },
      ]),
    });
    expect(stale.kind).toBe('stale-scope');

    active = await tempRepo({ initialized: true });
    expect((await readHostHooksInstallState(active.root)).kind).toBe('missing-file');
    await writeSettingsRaw(active.root, '{ nope');
    expect((await readHostHooksInstallState(active.root)).kind).toBe('invalid-json');
  });

  it('317-01/AC-7: host-hooks and hook-transport agree — host-hooks is ok exactly when hook-transport is not "not applicable"', async () => {
    const fixtures: Array<[string, (root: string) => Promise<void>]> = [
      ['missing file', async () => {}],
      ['invalid JSON', (root) => writeSettingsRaw(root, '{ not json')],
      ['empty hooks', (root) => writeSettingsRaw(root, JSON.stringify({ hooks: {} }))],
      [
        'one entry omitted',
        (root) => writeCompleteManagedSettings(root, [{ event: 'Stop', matcher: null, omit: true }]),
      ],
      [
        'stale scope',
        (root) =>
          writeCompleteManagedSettings(root, [
            { event: 'Stop', matcher: null, command: `npx ${STALE_NPM_SCOPE}cadence-host-claude-code hook` },
          ]),
      ],
      ['complete', (root) => writeCompleteManagedSettings(root)],
      ['complete + shell zsh', (root) => writeCompleteWithShell(root, 'zsh')],
    ];
    for (const [label, setup] of fixtures) {
      const fx = await tempRepo({ initialized: true });
      try {
        await setup(fx.root);
        const report = await runDoctor(fx.root, ENV);
        const hostHooks = report.checks.find((c) => c.name === 'host-hooks');
        const transport = report.checks.find((c) => c.name === 'hook-transport');
        const transportNA =
          transport?.detail === NA_NO_FILE || transport?.detail === NA_INSTALL_PROBLEM;
        const hostHooksNA = hostHooks?.detail === NA_NO_FILE;
        const hostHooksComplete = hostHooks?.severity === 'ok' && !hostHooksNA;
        expect({ label, transportApplies: !transportNA }).toEqual({
          label,
          transportApplies: hostHooksComplete,
        });
      } finally {
        await fx.cleanup();
      }
    }
  });
});
