import type { Command } from 'commander';
import { AbstractEventZ } from '@thomas-powers-jr/cadence-types';
import { HookDispatcher } from '../../hooks/dispatcher.js';
import { renderHookResult } from '../../hooks/render-result.js';

export function registerHookCommand(program: Command): void {
  program
    .command('hook <event>')
    .description('Dispatch an abstract hook event (called by host adapter shims)')
    .action(async (eventRaw: string) => {
      try {
        const parsed = AbstractEventZ.safeParse(eventRaw);
        if (!parsed.success) {
          process.stderr.write(`Unknown hook event: ${eventRaw}\n`);
          process.exitCode = 2;
          return;
        }
        let raw = '';
        if (!process.stdin.isTTY) {
          for await (const chunk of process.stdin) raw += chunk.toString();
        }
        const dispatcher = new HookDispatcher(process.cwd());
        const parsedRaw = raw ? safeJson(raw) : undefined;
        const rawObj = parsedRaw as { agentId?: unknown; agentType?: unknown } | undefined;
        const ctx = {
          event: parsed.data,
          cwd: process.cwd(),
          raw: parsedRaw,
          ...(typeof rawObj?.agentId === 'string' ? { agentId: rawObj.agentId } : {}),
          ...(typeof rawObj?.agentType === 'string' ? { agentType: rawObj.agentType } : {}),
        };
        const result = await dispatcher.dispatch(parsed.data, ctx);
        // Blocking is delivered as a per-event JSON decision on stdout, exit 0 (not exit-code 2 -- checkpoint 0.4a proved that collapses to a non-blocking 1 on Windows/PowerShell).
        const out = renderHookResult(parsed.data, result);
        if (out.stdout) process.stdout.write(out.stdout);
        if (out.stderr) process.stderr.write(out.stderr);
        if (out.exitCode !== 0) process.exitCode = out.exitCode;
      } catch (err) {
        process.stderr.write(
          `hook dispatch failed: ${err instanceof Error ? err.message : String(err)}\n`,
        );
        process.exitCode = 1;
      }
    });
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}
