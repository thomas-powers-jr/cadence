import { win32 } from 'node:path';

/**
 * Phase 319 T1 — dependency-injected facts `resolveHostCliCommand` needs to
 * do win32 PATH/PATHEXT resolution without touching the real filesystem or
 * `process` directly. T2 (`host-cli-client.ts`'s real spawn seam) supplies
 * real `fs.existsSync`/`fs.readFileSync`/`process.execPath`; tests supply
 * fakes so this module (and everything that imports it) runs deterministically
 * on Linux/macOS CI too.
 */
export interface HostCliCommandFacts {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  /** Synchronous existence check, e.g. `fs.existsSync`. Never called on non-win32. */
  fileExists: (p: string) => boolean;
  /** Synchronous file read, e.g. `p => fs.readFileSync(p, 'utf8')`. Only called for a `.cmd`/`.bat` hit. */
  readFile: (p: string) => string;
  /** `process.execPath` — the Node binary running cadence itself, used as the
   *  fallback command when a shim's own `node.exe` sibling does not exist. */
  execPath: string;
}

/** What the real spawn seam should hand to the underlying `spawn(...)` call. */
export interface ResolvedHostCliCommand {
  command: string;
  prefixArgs: string[];
}

/** Extensions win32 `cmd.exe`/CreateProcess can launch directly. Anything a
 *  PATHEXT search turns up outside this set is not something this resolver
 *  knows how to run, and is refused rather than launched. */
const LAUNCHABLE_EXTS = ['.com', '.exe', '.bat', '.cmd'];

/** Fallback PATHEXT, applied when the env var is unset *or* empty — an empty
 *  `PATHEXT=` is, in practice, an accidentally-cleared variable, not an
 *  operator opting out of every extension; treating it as "unset" avoids
 *  silently breaking bare-name resolution for a config mistake that isn't
 *  this resolver's to police. */
const DEFAULT_PATHEXT = ['.COM', '.EXE', '.BAT', '.CMD'];

/** Drive-rooted (`C:\...`, `C:/...`) or UNC (`\\server\share...`) — the two
 *  fully-qualified forms `cmd.exe` accepts as a PATH entry. Deliberately NOT
 *  `path.win32.isAbsolute`, which also accepts root-relative `\tools` (no
 *  drive) — a form Windows resolves against the *current drive*, which this
 *  resolver must never do since that is cwd-adjacent, drive-relative state. */
const DRIVE_ROOTED_RE = /^[A-Za-z]:[\\/]/;
const UNC_RE = /^\\\\[^\\/]+[\\/][^\\/]+/;

function isFullyQualifiedDir(segment: string): boolean {
  return DRIVE_ROOTED_RE.test(segment) || UNC_RE.test(segment);
}

/** Reads an env var by case-insensitive key — win32 env vars are
 *  case-insensitive (`Path`, `PATH`, `path` are the same variable), but a
 *  plain object built from `process.env` (or a test fake) preserves whatever
 *  casing the value was set with. When more than one case-variant key is
 *  present (e.g. `{ ...process.env, PATH: override }` where `process.env`
 *  already had a differently-cased `Path`), the LAST matching key in
 *  `Object.keys` iteration order wins — matching how a later spread key
 *  overrides an earlier one of the same effective (case-insensitive) name. */
function getEnvCI(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const wanted = key.toLowerCase();
  let result: string | undefined;
  for (const k of Object.keys(env)) {
    if (k.toLowerCase() === wanted) result = env[k];
  }
  return result;
}

/** Parses the PATH env var into an ordered list of directories to search:
 *  strips surrounding quotes, skips empty segments, and skips any segment
 *  that isn't fully qualified (so `.`, `bin`, `C:tools` (drive-relative) and
 *  `\tools` (root-relative) never contribute a directory — the mechanism
 *  that keeps the current working directory, and the current drive's cwd,
 *  out of the search entirely). */
function getPathDirs(env: NodeJS.ProcessEnv): string[] {
  const raw = getEnvCI(env, 'Path') ?? '';
  const dirs: string[] = [];
  for (const segmentRaw of raw.split(';')) {
    let segment = segmentRaw;
    if (segment.length >= 2 && segment.startsWith('"') && segment.endsWith('"')) {
      segment = segment.slice(1, -1);
    }
    if (segment.length === 0) continue;
    if (!isFullyQualifiedDir(segment)) continue;
    dirs.push(segment);
  }
  return dirs;
}

/** Parses PATHEXT into an ordered list of launchable extensions (lowercased
 *  for the actual filename suffix — see the module-level note on suffix
 *  casing in `buildSuffixCandidates`), filtered to {@link LAUNCHABLE_EXTS}.
 *  A real operator's PATHEXT commonly also lists `.VBS;.JS;.WSH;.MSC` and
 *  the like; this resolver only ever knows how to turn a hit into a spawn
 *  for the four launchable extensions, so a non-launchable PATHEXT entry is
 *  filtered out up front rather than being "found" and then refused. */
function getPathext(env: NodeJS.ProcessEnv): string[] {
  const raw = getEnvCI(env, 'PATHEXT');
  const list = raw === undefined || raw.length === 0 ? DEFAULT_PATHEXT : raw.split(';').filter((s) => s.length > 0);
  const out: string[] = [];
  for (const ext of list) {
    const lower = ext.toLowerCase();
    if (LAUNCHABLE_EXTS.includes(lower) && !out.includes(lower)) out.push(lower);
  }
  return out;
}

function hasSeparator(bin: string): boolean {
  return bin.includes('\\') || bin.includes('/');
}

function hasRecognizedExt(p: string): boolean {
  return LAUNCHABLE_EXTS.includes(win32.extname(p).toLowerCase());
}

/** Builds the ordered candidate filenames for `bin`: itself, if already
 *  suffixed with a launchable extension (probed as given, regardless of
 *  PATHEXT's contents); otherwise `bin` suffixed with each PATHEXT extension
 *  in order (lowercased — see the casing note below). */
function buildSuffixCandidates(bin: string, pathext: string[]): string[] {
  if (hasRecognizedExt(bin)) return [bin];
  return pathext.map((ext) => bin + ext);
}

/** Locates the first existing candidate for `bin`, returning its full path,
 *  or `undefined` if every candidate was exhausted.
 *
 *  - `bin` with a path separator: probed at its own path only (candidates
 *    built from `bin` directly, never joined against anything else) — this
 *    is the "explicit operator-configured path is used as given" case. A
 *    bare name's search (below) never touches the current working
 *    directory; a *relative* explicit path (e.g. `.\codex.exe`) is a
 *    different thing — this resolver still doesn't add or resolve a cwd
 *    itself, but the operator's own choice of a relative override means the
 *    underlying `fileExists`/`spawn` call resolves that literal string
 *    against the process's cwd, the same as it would for any other relative
 *    path handed to those APIs.
 *  - `bin` with no separator: probed in each fully-qualified PATH directory,
 *    in order; within a directory, candidates are tried in PATHEXT order. */
function locateBinary(bin: string, facts: HostCliCommandFacts): string | undefined {
  const pathext = getPathext(facts.env);
  const candidates = buildSuffixCandidates(bin, pathext);

  if (hasSeparator(bin)) {
    for (const candidate of candidates) {
      if (facts.fileExists(candidate)) return candidate;
    }
    return undefined;
  }

  for (const dir of getPathDirs(facts.env)) {
    for (const candidate of candidates) {
      const full = win32.join(dir, candidate);
      if (facts.fileExists(full)) return full;
    }
  }
  return undefined;
}

/** Exhausted-lookup wording differs by lookup kind, so it stays accurate for
 *  both: a bare name is searched across PATH × PATHEXT and the current
 *  directory is never part of that search; a separator-bearing `bin` is an
 *  explicit operator-configured path used as given — this resolver never
 *  resolves it against the cwd itself, but if the operator chose a relative
 *  path (e.g. `.\codex.exe`), the underlying `fileExists`/`spawn` call does
 *  resolve it against the process's cwd, which is the operator's own choice
 *  of override, not a PATH search this resolver performs. */
function enoentError(bin: string): Error {
  const detail = hasSeparator(bin)
    ? 'not found at the configured path'
    : 'not found on PATH (searched PATH × PATHEXT, never the current directory)';
  return Object.assign(new Error(`host-cli win32 resolver: "${bin}" ${detail}`), { code: 'ENOENT' });
}

/** Every refusal (unrecognised/unsafe launcher) shares this message shape:
 *  name the configured bin, and tell the operator how to route around this
 *  resolver entirely — point `CADENCE_HOST_CLI_BIN` at a native `.exe`. */
function refusalError(bin: string, detail: string): Error {
  return new Error(
    `host-cli win32 resolver: refusing to launch "${bin}" — ${detail}. ` +
      'Point CADENCE_HOST_CLI_BIN at the native executable (an absolute path to the CLI\'s .exe) instead.',
  );
}

/**
 * Matches the canonical npm cmd-shim invoking line's tail, case-insensitively.
 * Two forms, both requiring the match to sit at line-start (an optional
 * leading `@` allowed) or right after a `&` command separator — never
 * floating free after arbitrary text like `node `, `cscript //nologo `, or
 * `REM `:
 *   - prog + target (capture group 1): `"%_prog%"  "%dp0%\<rel>" %*`, or the
 *     legacy `"%~dp0\node.exe"  "%~dp0\<rel>" %*`. The prog token is
 *     mandatory here — it is what makes running the target with Node safe to
 *     assume — so a target of any extension is accepted.
 *   - exe-direct, no prog token (capture group 2): `"%dp0%\<rel>.exe" %*` /
 *     `"%~dp0\<rel>.exe" %*`. Allowed WITHOUT a prog token only because the
 *     target is already required to end in `.exe` — launched directly, never
 *     handed to Node, so there is nothing a missing prog token could get
 *     wrong. A prog-less line whose target is anything else (e.g. bare
 *     `"%dp0%\codex.js" %*`) matches neither alternative and is refused.
 *
 * Real shim text carries other content before the match on the same line
 * (`endLocal & goto ... & title ... & "%_prog%"  ...`) — the
 * `(?:^[ \t]*@?|&[ \t]*)` prefix skips exactly that, and nothing else.
 * Anchored at line end (`$`) so an incidental substring elsewhere (e.g.
 * `IF EXIST "%dp0%\node.exe" (`) can never match — that line ends in `(`,
 * not `%*`. Every quantifier here is a simple, non-nested repeat (`[^"]+`,
 * `[ \t]+`), so this stays linear-time — no catastrophic-backtracking shape.
 *
 * The line-start alternative allows leading whitespace before the optional
 * `@` (`^[ \t]*@?`, not just `^@?`): a real legacy npm shim's invoking line
 * sits INDENTED inside an `IF EXIST "%~dp0\node.exe" ( ... ) ELSE ( ... )`
 * block, e.g. `  "%~dp0\node.exe"  "%~dp0\<rel>" %*` — an unindented-only
 * anchor would refuse that real shim outright. Widening what counts as
 * "line start" this way does not relax which *forms* are accepted there:
 * a merely-indented non-canonical line (indented `REM ...`, an indented
 * prog-less non-.exe target, an indented non-canonical prog token) still
 * fails to match, because the content immediately after the whitespace/`@`
 * still has to be one of the two alternatives below.
 *
 * `resolveShim` additionally skips (never even runs this regex over) any
 * line that is itself a batch comment (`REM ...` / `:: ...`) — see
 * {@link isBatchCommentLine} — because cmd.exe treats the *entire* line as
 * inert text once it starts with one of those markers, including any `&`
 * inside it; this regex has no comment-awareness of its own and would
 * otherwise happily match `REM & "%_prog%"  "%dp0%\x.js" %*`'s embedded
 * `& "..." ...` tail as if it were a real invocation.
 */
const SHIM_TARGET_RE =
  /(?:^[ \t]*@?|&[ \t]*)(?:"(?:%_prog%|%~dp0\\node\.exe)"[ \t]+"(?:%dp0%|%~dp0)\\([^"]+)"|"(?:%dp0%|%~dp0)\\([^"]+\.exe)")[ \t]+%\*[ \t]*$/i;

/** A batch-file comment line (`REM ...` / `:: ...`, optionally indented and
 *  optionally `@`-prefixed to suppress echo) — cmd.exe never executes
 *  anything on it, so `SHIM_TARGET_RE` must never be run over its content:
 *  any `&`-anchored match inside the comment text (e.g. an old invoking line
 *  left behind as `REM & "%_prog%" ...`) would otherwise be mistaken for a
 *  live invocation. `rem` requires a following whitespace-or-end so a real
 *  command merely starting with the letters "rem" (unlikely here, but not
 *  this resolver's business to assume away) isn't swept up too. */
const BATCH_COMMENT_RE = /^[ \t]*@?(?:rem(?:[ \t]|$)|::)/i;

function isBatchCommentLine(line: string): boolean {
  return BATCH_COMMENT_RE.test(line);
}

/** Resolves a `.cmd`/`.bat` hit: extracts its target from the canonical
 *  invoking line, refuses anything that doesn't match, is ambiguous, or
 *  escapes the shim's own directory, then dispatches on the target's
 *  extension. */
function resolveShim(shimPath: string, bin: string, facts: HostCliCommandFacts): ResolvedHostCliCommand {
  const content = facts.readFile(shimPath);
  const lines = content.split(/\r\n|\r|\n/);

  let rel: string | undefined;
  let matchCount = 0;
  for (const line of lines) {
    if (isBatchCommentLine(line)) continue;
    const m = SHIM_TARGET_RE.exec(line);
    if (m === null) continue;
    matchCount += 1;
    rel = m[1] ?? m[2];
  }
  if (matchCount === 0 || rel === undefined) {
    throw refusalError(bin, `"${shimPath}" does not match the canonical npm cmd-shim invoking line`);
  }
  if (matchCount > 1) {
    throw refusalError(bin, `"${shimPath}" has more than one line matching the canonical invoking line (ambiguous)`);
  }
  if (rel.includes('%')) {
    throw refusalError(bin, `"${shimPath}" targets an unexpanded "${rel}" (contains "%")`);
  }

  const shimDir = win32.dirname(shimPath);
  const target = win32.resolve(shimDir, rel);
  const fromShim = win32.relative(shimDir, target);
  // A parent-directory escape only when ".." is a whole path SEGMENT (".."
  // itself, or "..\..."), NOT merely a target whose filename happens to
  // start with two dots (e.g. a real file named "..foo.js" sitting directly
  // inside shimDir) — `.startsWith('..')` alone would wrongly refuse that.
  const escapesUp = fromShim === '..' || fromShim.startsWith('..\\') || fromShim.startsWith('../');
  const escapes = fromShim.length === 0 || escapesUp || win32.isAbsolute(fromShim);
  if (escapes) {
    throw refusalError(bin, `"${shimPath}" targets "${rel}", which resolves outside the shim's own directory`);
  }

  const targetExt = win32.extname(target).toLowerCase();
  if (targetExt === '.js' || targetExt === '.cjs' || targetExt === '.mjs') {
    const nodeExe = win32.join(shimDir, 'node.exe');
    const command = facts.fileExists(nodeExe) ? nodeExe : facts.execPath;
    return { command, prefixArgs: [target] };
  }
  if (targetExt === '.exe') {
    return { command: target, prefixArgs: [] };
  }
  throw refusalError(bin, `"${shimPath}" targets "${rel}", which is neither a JavaScript file nor a native executable`);
}

function classifyHit(hit: string, bin: string, facts: HostCliCommandFacts): ResolvedHostCliCommand {
  const ext = win32.extname(hit).toLowerCase();
  if (ext === '.exe' || ext === '.com') {
    return { command: hit, prefixArgs: [] };
  }
  if (ext === '.cmd' || ext === '.bat') {
    return resolveShim(hit, bin, facts);
  }
  // Defensive only: `getPathext` already filters candidates down to
  // {@link LAUNCHABLE_EXTS} (`.com`/`.exe`/`.bat`/`.cmd`), and an
  // already-suffixed `bin` is only ever probed as-is when its own extension
  // is already one of those four (`hasRecognizedExt`) — so `hit`'s extension
  // should always be one of the branches above. Kept as a refusal (not an
  // assertion/throw-unconditionally) in case either assumption ever changes.
  throw refusalError(bin, `"${hit}" has an unrecognised launcher extension "${ext}"`);
}

/**
 * Phase 319 T1 — pure, dependency-injected resolution of a configured
 * `CADENCE_HOST_CLI_BIN` value into the command + argv prefix the real
 * spawn seam should hand to `child_process.spawn(..., { shell: undefined })`.
 *
 * On any platform other than `win32` this is a no-op (`bin` returned as
 * given, `facts.fileExists`/`facts.readFile` never called) — win32 is the
 * only platform where a bare npm-installed CLI name doesn't resolve to
 * something `spawn` can launch without a shell.
 *
 * On win32: resolves `bin` through PATH × PATHEXT the way `cmd.exe` locates
 * a bare command — case-insensitively, current directory never searched —
 * except PATHEXT is filtered down to the four extensions this resolver
 * actually knows how to launch (`.com`/`.exe`/`.bat`/`.cmd`; see
 * {@link LAUNCHABLE_EXTS}), which is deliberately narrower than cmd.exe's
 * own PATHEXT-driven file-association search. It then either returns a
 * native `.exe`/`.com` directly or parses an npm `.cmd`/`.bat`
 * launcher's target and re-dispatches on it. Throws (never returns a
 * sentinel) on any failure:
 *   - exhausted lookup → `Error` with `code: 'ENOENT'` (`toHostCliError`
 *     in `host-cli-client.ts` maps this to reason `'not-found'`)
 *   - unrecognised/unsafe launcher → plain `Error`, no `code` (maps to
 *     `'spawn-error'`), naming the bin and the native-exe override
 */
export function resolveHostCliCommand(bin: string, facts: HostCliCommandFacts): ResolvedHostCliCommand {
  if (facts.platform !== 'win32') {
    return { command: bin, prefixArgs: [] };
  }
  const hit = locateBinary(bin, facts);
  if (hit === undefined) {
    throw enoentError(bin);
  }
  return classifyHit(hit, bin, facts);
}
