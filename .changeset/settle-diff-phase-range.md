---
"@thomas-powers-jr/cadence-core": patch
---

Fix: `cadence settle run --deep` no longer rejects every acceptance criterion of a phase whose tasks were committed as they landed (#501).

Settle's shared review diff (read by `deep-verify`, `code-review` and `security-audit`) was `git diff HEAD` over the declared files, i.e. uncommitted changes only, so committed task work was invisible and the verifier correctly rejected ACs against a diff with no implementation in it. The diff is now taken against the merge-base with `origin/<phaseGuard.integrationRef>` (or the local ref), which includes committed phase work plus uncommitted changes to tracked files (never-added files are still excluded). Settle prints a stderr notice when no merge-base resolves (it then falls back to the old `HEAD` diff), when the merge-base is `HEAD` itself (settling directly on the integration ref), when the merge-base diff is empty, or when the diff command fails. A `deep-verify` refusal now also prints the diff byte count and declared file count the verifier was given. The persisted refusal reason is unchanged.
