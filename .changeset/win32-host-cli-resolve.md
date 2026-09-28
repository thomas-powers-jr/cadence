---
"@thomas-powers-jr/cadence-core": patch
---

Fix the `host-cli` provider falling back to `mock` on every call on Windows when `CADENCE_HOST_CLI_BIN` names an npm-installed CLI such as `codex` (phase 319). The real spawn seam now resolves a bare name without a shell: a native `.com`/`.exe` on PATH is launched directly (the same file Node's own lookup found before), and only if none exists is an npm cmd-shim `.cmd`/`.bat` launcher used, with its JavaScript target run via Node. Other launchers are refused loudly: unrecognised shapes such as hand-written wrappers, and launchers whose target lives outside their own directory, as package-manager global launchers such as pnpm's typically do. Behavior change: the current working directory and relative PATH entries are no longer searched on Windows, so a CLI reachable only that way no longer launches — use an absolute `CADENCE_HOST_CLI_BIN` override for it instead.
