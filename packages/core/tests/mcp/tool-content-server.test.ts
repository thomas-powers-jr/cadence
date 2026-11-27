import { describe, it, expect, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { tempRepo, type Fixture } from '@thomas-powers-jr/cadence-testkit';
import type { McpTrustGrant } from '@thomas-powers-jr/cadence-types';
import { buildCadenceMcpServer } from '../../src/mcp/server.js';
import { TOOLS, type ToolDef } from '../../src/mcp/tools.js';
import { computeToolDefHash } from '../../src/mcp/trust/def-hash.js';
import { writeTrustLedger } from '../../src/mcp/trust/store.js';
import { readPackageVersion } from '../../src/version.js';

// Phase 356 (356-01, T2): the MCP server's tool results keep stderr notices
// as a second text item when the tool also wrote to stdout, and the first
// item is unchanged (rec-20260822-002). Helpers copied from
// mcp-server.test.ts, which does not export them.

const CADENCE_CLI = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist', 'cli', 'index.js');

function runCli(args: string[], cwd: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [CADENCE_CLI, ...args], { cwd });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => (stdout += d.toString()));
    p.stderr.on('data', (d) => (stderr += d.toString()));
    p.on('exit', (code) => resolve({ stdout, stderr, code: code ?? 0 }));
  });
}

async function connect(repoRoot: string): Promise<{ client: Client; close: () => Promise<void> }> {
  const server = buildCadenceMcpServer(repoRoot, '1.7.0-test');
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await client.connect(clientTransport);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

interface ToolResult {
  isError?: boolean;
  content: Array<{ type: string; text?: string }>;
}

function grantFor(name: string): McpTrustGrant {
  const tool: ToolDef | undefined = TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`tool not found: ${name}`);
  return {
    toolName: tool.name,
    capabilityClass: tool.capabilityClass,
    defHash: computeToolDefHash(tool),
    grantedAt: new Date().toISOString(),
    grantedVersion: readPackageVersion(),
    expiresAt: null,
  };
}

/** As settle-zero-ac.test.ts's seedZeroAcDraft. */
async function seedZeroAcDraft(root: string): Promise<void> {
  const phaseDir = join(root, '.cadence/phases/01-foundation');
  await mkdir(phaseDir, { recursive: true });
  const body =
    `---\nphase: 01-foundation\nid: 01-01\ntier: standard\nstatus: PENDING\n---\n\n` +
    `# 01-01 — Demo\n\n` +
    `## Objective\n\nDemo.\n\n` +
    `## Acceptance Criteria\n\n` +
    `## Tasks\n\n` +
    `## Boundaries\n\n- _(none)_\n`;
  await writeFile(join(phaseDir, '01-01-DRAFT.md'), body);
}

let active: Fixture | null = null;
afterEach(async () => {
  if (active) {
    await active.cleanup();
    active = null;
  }
});

describe('MCP tool result content (phase 356)', () => {
  it('356-01/AC-3: a zero-AC settle over MCP returns Settled 01-01 and the notice as a second item', async () => {
    active = await tempRepo({ initialized: true });
    await seedZeroAcDraft(active.root);
    expect((await runCli(['draft', 'approve', '01-foundation', '01'], active.root)).code).toBe(0);
    await writeTrustLedger(active.root, { schemaVersion: 1, grants: [grantFor('cadence_settle')] });

    const { client, close } = await connect(active.root);
    try {
      const res = (await client.callTool({ name: 'cadence_settle', arguments: { auto: true } })) as unknown as ToolResult;
      expect(res.isError).toBe(false);
      expect(res.content).toHaveLength(2);
      expect(res.content[0]?.text).toBe('Settled 01-01');
      expect(res.content[1]?.text).toContain('zero acceptance criteria');
    } finally {
      await close();
    }
  });

  it('356-01/AC-4: cadence_status with json keeps a parseable first item', async () => {
    active = await tempRepo({ initialized: true });
    const { client, close } = await connect(active.root);
    try {
      const res = (await client.callTool({ name: 'cadence_status', arguments: { json: true } })) as unknown as ToolResult;
      const report = JSON.parse(res.content[0]?.text ?? '') as { loopPosition?: string };
      expect(report.loopPosition).toBe('IDLE');
    } finally {
      await close();
    }
  });
});
