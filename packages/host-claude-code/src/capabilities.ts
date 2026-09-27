import type { HostCapabilities } from '@thomas-powers-jr/cadence-types';

export const claudeCodeCapabilities: HostCapabilities = {
  hooks: [
    'session-start',
    'user-prompt',
    'pre-tool-edit',
    'post-tool-edit',
    'session-stop',
    'subagent-result',
    'subagent-start',
  ],
  slashCommands: true,
  skillSystem: 'native',
  blockingHooks: ['pre-tool-edit', 'session-stop', 'subagent-result'],
  subagentSpawn: 'native',
  streamingOutput: true,
  // Claude Code's hook stdin carries agent_id/agent_type on SubagentStart,
  // SubagentStop, and tool events fired inside a subagent
  // (code.claude.com/docs/en/hooks, common input fields); host-toolkit's
  // routeHookEvent forwards them to core as agentId/agentType (phase 318).
  agentIdentification: true,
};
