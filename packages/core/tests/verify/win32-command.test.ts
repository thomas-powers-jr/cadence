import { describe, it, expect, vi } from 'vitest';
import {
  resolveHostCliCommand,
  type HostCliCommandFacts,
} from '../../src/verify/win32-command.js';

/**
 * Phase 319 T1 — fake filesystem: a lowercase-keyed Map, mirroring win32's
 * case-insensitive filesystem, so fixtures can say `codex.exe` and a probe
 * for `CODEX.EXE` (or an uppercased PATHEXT suffix) still resolves.
 */
function makeFakeFs(files: Record<string, string>) {
  const map = new Map<string, string>();
  for (const [p, content] of Object.entries(files)) {
    map.set(p.toLowerCase(), content);
  }
  const fileExists = vi.fn((p: string) => map.has(p.toLowerCase()));
  const readFile = vi.fn((p: string) => {
    const content = map.get(p.toLowerCase());
    if (content === undefined) throw new Error(`fake fs: no such file ${p}`);
    return content;
  });
  return { fileExists, readFile };
}

function makeFacts(opts: {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  files?: Record<string, string>;
  execPath?: string;
}): HostCliCommandFacts {
  const { fileExists, readFile } = makeFakeFs(opts.files ?? {});
  return {
    platform: opts.platform ?? 'win32',
    env: opts.env ?? {},
    fileExists,
    readFile,
    execPath: opts.execPath ?? 'C:\\node-install\\node.exe',
  };
}

/** The canonical npm cmd-shim, verbatim shape from the DRAFT, CRLF line endings. */
function npmCmdShim(rel: string): string {
  return [
    '@ECHO off',
    'GOTO start',
    ':find_dp0',
    'SET dp0=%~dp0',
    'EXIT /b',
    ':start',
    'SETLOCAL',
    'CALL :find_dp0',
    '',
    'IF EXIST "%dp0%\\node.exe" (',
    '  SET "_prog=%dp0%\\node.exe"',
    ') ELSE (',
    '  SET "_prog=node"',
    '  SET PATHEXT=%PATHEXT:;.JS;=;%',
    ')',
    '',
    `endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\${rel}" %*`,
  ].join('\r\n');
}

/**
 * Real npm legacy cmd-shim shape: the invoking line sits INDENTED inside an
 * `IF EXIST ... ( ... ) ELSE ( ... )` block, and the ELSE branch has its own
 * `node  "<target>" %*` line (also indented, no prog token) that must NOT
 * be mistaken for a second invoking line. `eol` lets the same shape be
 * exercised with both CRLF and LF line endings.
 */
function legacyIndentedCmdShim(rel: string, eol: '\r\n' | '\n' = '\r\n'): string {
  return [
    '@IF EXIST "%~dp0\\node.exe" (',
    `  "%~dp0\\node.exe"  "%~dp0\\${rel}" %*`,
    ') ELSE (',
    '  @SETLOCAL',
    '  @SET PATHEXT=%PATHEXT:;.JS;=;%',
    `  node  "%~dp0\\${rel}" %*`,
    ')',
  ].join(eol);
}

/** "exe-direct" cmd-shim form: no prog token, target already an .exe. */
function exeFormCmdShim(rel: string): string {
  return ['@ECHO off', `"%dp0%\\${rel}" %*`].join('\r\n');
}

describe('319-01/AC-5: non-win32 is unchanged', () => {
  it('319-01/AC-5: linux returns bin untouched and never probes the filesystem', () => {
    const facts = makeFacts({ platform: 'linux', files: {} });
    const result = resolveHostCliCommand('codex', facts);
    expect(result).toEqual({ command: 'codex', prefixArgs: [] });
    expect(facts.fileExists).not.toHaveBeenCalled();
    expect(facts.readFile).not.toHaveBeenCalled();
  });

  it('319-01/AC-5: darwin returns an absolute bin untouched with no probing', () => {
    const facts = makeFacts({ platform: 'darwin', files: {} });
    const result = resolveHostCliCommand('/usr/local/bin/codex', facts);
    expect(result).toEqual({ command: '/usr/local/bin/codex', prefixArgs: [] });
    expect(facts.fileExists).not.toHaveBeenCalled();
    expect(facts.readFile).not.toHaveBeenCalled();
  });

  it('319-01/AC-5: darwin with an already-suffixed bin is still untouched', () => {
    const facts = makeFacts({ platform: 'darwin', files: {} });
    const result = resolveHostCliCommand('codex.cmd', facts);
    expect(result).toEqual({ command: 'codex.cmd', prefixArgs: [] });
    expect(facts.fileExists).not.toHaveBeenCalled();
  });
});

describe('319-01/AC-1: bare name resolves via PATH x PATHEXT to a native executable', () => {
  it('319-01/AC-1: bare name resolves to codex.exe via Path/PATHEXT, skipping ext-less and non-PATHEXT siblings', () => {
    const facts = makeFacts({
      env: { Path: 'C:\\tools\\codex' },
      files: {
        'C:\\tools\\codex\\codex': 'sh script, no extension',
        'C:\\tools\\codex\\codex.ps1': '# powershell, not in PATHEXT',
        'C:\\tools\\codex\\codex.exe': 'binary',
      },
    });
    const result = resolveHostCliCommand('codex', facts);
    expect(result).toEqual({ command: 'C:\\tools\\codex\\codex.exe', prefixArgs: [] });
  });

  it('319-01/AC-1: PATH key spelled in any case (lowercase "path") is honored', () => {
    const facts = makeFacts({
      env: { path: 'C:\\tools\\codex' },
      files: { 'C:\\tools\\codex\\codex.exe': 'binary' },
    });
    expect(resolveHostCliCommand('codex', facts)).toEqual({
      command: 'C:\\tools\\codex\\codex.exe',
      prefixArgs: [],
    });
  });

  it('319-01/AC-1: PATHEXT unset falls back to default .COM;.EXE;.BAT;.CMD order', () => {
    const facts = makeFacts({
      env: { Path: 'C:\\tools' },
      files: {
        'C:\\tools\\codex.bat': 'bat',
        'C:\\tools\\codex.exe': 'exe wins because .EXE precedes .BAT in the default order',
      },
    });
    expect(resolveHostCliCommand('codex', facts)).toEqual({
      command: 'C:\\tools\\codex.exe',
      prefixArgs: [],
    });
  });

  it('319-01/AC-1: searches PATH directories in order — dir1 hit wins over dir2', () => {
    const facts = makeFacts({
      env: { Path: 'C:\\dir1;C:\\dir2' },
      files: {
        'C:\\dir1\\codex.exe': 'dir1',
        'C:\\dir2\\codex.exe': 'dir2',
      },
    });
    expect(resolveHostCliCommand('codex', facts)).toEqual({ command: 'C:\\dir1\\codex.exe', prefixArgs: [] });
  });

  it('319-01/AC-1: within a directory, PATHEXT extensions are tried in order', () => {
    const facts = makeFacts({
      env: { Path: 'C:\\tools', PATHEXT: '.CMD;.EXE' },
      files: {
        'C:\\tools\\codex.cmd': npmCmdShim('bin\\codex.js'),
        'C:\\tools\\codex.exe': 'exe',
        'C:\\tools\\bin\\codex.js': 'js',
      },
    });
    // .CMD precedes .EXE in this custom PATHEXT, so the shim wins.
    const result = resolveHostCliCommand('codex', facts);
    expect(result.prefixArgs).toEqual(['C:\\tools\\bin\\codex.js']);
  });

  it('319-01/AC-1: UNC PATH directory joins correctly', () => {
    const facts = makeFacts({
      env: { Path: '\\\\build-server\\tools' },
      files: { '\\\\build-server\\tools\\codex.exe': 'binary' },
    });
    expect(resolveHostCliCommand('codex', facts)).toEqual({
      command: '\\\\build-server\\tools\\codex.exe',
      prefixArgs: [],
    });
  });

  it('319-01/AC-1: quoted, empty, and trailing-separator PATH segments are handled', () => {
    const facts = makeFacts({
      env: { Path: ';"C:\\quoted\\dir";C:\\trailing\\' },
      files: {
        'C:\\quoted\\dir\\codex.exe': 'binary',
      },
    });
    expect(resolveHostCliCommand('codex', facts)).toEqual({
      command: 'C:\\quoted\\dir\\codex.exe',
      prefixArgs: [],
    });
  });

  it('319-01/AC-1: a PATH directory with a trailing separator resolves a binary that exists only there', () => {
    const facts = makeFacts({
      env: { Path: 'C:\\trailing\\' },
      files: { 'C:\\trailing\\codex.exe': 'binary' },
    });
    expect(resolveHostCliCommand('codex', facts)).toEqual({
      command: 'C:\\trailing\\codex.exe',
      prefixArgs: [],
    });
  });

  it('319-01/AC-1: when multiple case-variant PATH keys exist, the later-spread key wins', () => {
    const facts = makeFacts({
      env: { Path: 'C:\\old', PATH: 'C:\\new' },
      files: { 'C:\\new\\codex.exe': 'binary' },
    });
    expect(resolveHostCliCommand('codex', facts)).toEqual({
      command: 'C:\\new\\codex.exe',
      prefixArgs: [],
    });
  });

  it('319-01/AC-1: ".", drive-relative "C:tools", and root-relative "\\tools" segments never resolve a binary', () => {
    const facts = makeFacts({
      env: { Path: '.;C:tools;\\tools' },
      files: {
        // Seeded so a wrongly-permissive resolver WOULD find these.
        '.\\codex.exe': 'cwd',
        'C:tools\\codex.exe': 'drive-relative',
        '\\tools\\codex.exe': 'root-relative',
      },
    });
    expect(() => resolveHostCliCommand('codex', facts)).toThrow(
      expect.objectContaining({ code: 'ENOENT' }),
    );
  });

  it('319-01/AC-1 / current directory is never searched: every probed path is fully qualified', () => {
    const facts = makeFacts({
      env: { Path: 'C:\\real;.;C:relative;\\rootrel' },
      files: { 'C:\\real\\codex.exe': 'binary' },
    });
    resolveHostCliCommand('codex', facts);
    const probed = (facts.fileExists as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as string);
    for (const p of probed) {
      expect(p).toMatch(/^[A-Za-z]:[\\/]|^\\\\/);
    }
  });
});

describe('319-01/AC-2: npm .cmd launcher runs its JavaScript target with Node, no shell', () => {
  it('319-01/AC-2: bare name resolves through the canonical shim to node.exe + prefixArgs[js target]', () => {
    const facts = makeFacts({
      env: { Path: 'C:\\npm' },
      files: {
        codex: 'sh',
        'C:\\npm\\codex': 'sh',
        'C:\\npm\\codex.ps1': 'ps1',
        'C:\\npm\\codex.cmd': npmCmdShim('node_modules\\@openai\\codex\\bin\\codex.js'),
        'C:\\npm\\node.exe': 'node binary',
      },
    });
    const result = resolveHostCliCommand('codex', facts);
    expect(result).toEqual({
      command: 'C:\\npm\\node.exe',
      prefixArgs: ['C:\\npm\\node_modules\\@openai\\codex\\bin\\codex.js'],
    });
  });

  it('319-01/AC-2: falls back to execPath when no node.exe sits next to the shim', () => {
    const facts = makeFacts({
      env: { Path: 'C:\\npm' },
      files: {
        'C:\\npm\\codex.cmd': npmCmdShim('node_modules\\@openai\\codex\\bin\\codex.js'),
      },
      execPath: 'C:\\different\\node.exe',
    });
    const result = resolveHostCliCommand('codex', facts);
    expect(result.command).toBe('C:\\different\\node.exe');
  });

  it('319-01/AC-2: bare codex.cmd resolves even when PATHEXT omits .CMD (probed as given, not re-suffixed)', () => {
    const facts = makeFacts({
      env: { Path: 'C:\\npm', PATHEXT: '.COM;.EXE' },
      files: {
        'C:\\npm\\codex.cmd': npmCmdShim('node_modules\\@openai\\codex\\bin\\codex.js'),
        'C:\\npm\\node.exe': 'node',
      },
    });
    const result = resolveHostCliCommand('codex.cmd', facts);
    expect(result.command).toBe('C:\\npm\\node.exe');
    expect(result.prefixArgs).toEqual(['C:\\npm\\node_modules\\@openai\\codex\\bin\\codex.js']);
  });

  it('319-01/AC-2: absolute path to codex.cmd resolves even when PATHEXT omits .CMD', () => {
    const facts = makeFacts({
      env: { PATHEXT: '.COM;.EXE' },
      files: {
        'C:\\npm\\codex.cmd': npmCmdShim('node_modules\\@openai\\codex\\bin\\codex.js'),
        'C:\\npm\\node.exe': 'node',
      },
    });
    const result = resolveHostCliCommand('C:\\npm\\codex.cmd', facts);
    expect(result.command).toBe('C:\\npm\\node.exe');
    expect(result.prefixArgs).toEqual(['C:\\npm\\node_modules\\@openai\\codex\\bin\\codex.js']);
  });

  it('319-01/AC-2: real indented legacy IF/ELSE shim (CRLF) resolves via the IF-branch node.exe line only', () => {
    const facts = makeFacts({
      env: { Path: 'C:\\npm' },
      files: {
        'C:\\npm\\codex.cmd': legacyIndentedCmdShim('node_modules\\foo\\bin\\foo.js', '\r\n'),
        'C:\\npm\\node.exe': 'node',
      },
    });
    const result = resolveHostCliCommand('codex', facts);
    expect(result).toEqual({
      command: 'C:\\npm\\node.exe',
      prefixArgs: ['C:\\npm\\node_modules\\foo\\bin\\foo.js'],
    });
  });

  it('319-01/AC-2: real indented legacy IF/ELSE shim (LF) resolves the same way', () => {
    const facts = makeFacts({
      env: { Path: 'C:\\npm-lf' },
      files: {
        'C:\\npm-lf\\codex.cmd': legacyIndentedCmdShim('node_modules\\foo\\bin\\foo.js', '\n'),
        'C:\\npm-lf\\node.exe': 'node',
      },
    });
    const result = resolveHostCliCommand('codex', facts);
    expect(result).toEqual({
      command: 'C:\\npm-lf\\node.exe',
      prefixArgs: ['C:\\npm-lf\\node_modules\\foo\\bin\\foo.js'],
    });
  });

  it('319-01/AC-2: indented legacy IF/ELSE shim falls back to execPath when no node.exe sits beside it', () => {
    const facts = makeFacts({
      env: { Path: 'C:\\npm-noexe' },
      files: {
        'C:\\npm-noexe\\codex.cmd': legacyIndentedCmdShim('node_modules\\foo\\bin\\foo.js', '\r\n'),
      },
      execPath: 'C:\\different\\node.exe',
    });
    const result = resolveHostCliCommand('codex', facts);
    expect(result).toEqual({
      command: 'C:\\different\\node.exe',
      prefixArgs: ['C:\\npm-noexe\\node_modules\\foo\\bin\\foo.js'],
    });
  });

  it('319-01/AC-2: a canonical shim whose target is an .exe returns that .exe with no prefix args', () => {
    const facts = makeFacts({
      env: { Path: 'C:\\npm' },
      files: {
        'C:\\npm\\codex.cmd': exeFormCmdShim('vendor\\codex.exe'),
        'C:\\npm\\vendor\\codex.exe': 'native binary',
      },
    });
    const result = resolveHostCliCommand('codex', facts);
    expect(result).toEqual({ command: 'C:\\npm\\vendor\\codex.exe', prefixArgs: [] });
  });

  it('319-01/AC-2: a relative, separator-bearing path like .\\codex.exe is probed as given (explicit operator path)', () => {
    const facts = makeFacts({ files: { '.\\codex.exe': 'binary' } });
    const result = resolveHostCliCommand('.\\codex.exe', facts);
    expect(result).toEqual({ command: '.\\codex.exe', prefixArgs: [] });
  });

  it('319-01/AC-2: the IF EXIST "%dp0%\\node.exe" line is never mistaken for the invoking line', () => {
    // Sanity check that a shim with node.exe present resolves to that
    // node.exe as the *command*, and the target stays the real JS file —
    // not "node.exe" itself misparsed as the target.
    const facts = makeFacts({
      env: { Path: 'C:\\npm' },
      files: {
        'C:\\npm\\codex.cmd': npmCmdShim('node_modules\\@openai\\codex\\bin\\codex.js'),
        'C:\\npm\\node.exe': 'node',
      },
    });
    const result = resolveHostCliCommand('codex', facts);
    expect(result.prefixArgs[0]).toBe('C:\\npm\\node_modules\\@openai\\codex\\bin\\codex.js');
    expect(result.prefixArgs[0]).not.toContain('node.exe');
  });
});

describe('319-01/AC-3 & AC-4: refusals and ENOENT (resolver-level behaviors)', () => {
  it('319-01/AC-3: a shim target escaping its own directory (sibling-prefix escape) is refused, not shelled', () => {
    const facts = makeFacts({
      env: { Path: 'C:\\npm' },
      files: {
        'C:\\npm\\codex.cmd': npmCmdShim('..\\npm-evil\\payload.js'),
        'C:\\npm-evil\\payload.js': 'malicious',
      },
    });
    expect(() => resolveHostCliCommand('codex', facts)).toThrow(/codex/);
    try {
      resolveHostCliCommand('codex', facts);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as NodeJS.ErrnoException).code).toBeUndefined();
      expect((err as Error).message).toContain('codex');
      expect((err as Error).message).toContain('CADENCE_HOST_CLI_BIN');
    }
  });

  it('319-01/AC-3: a target containing an unexpanded % is refused', () => {
    const facts = makeFacts({
      env: { Path: 'C:\\npm' },
      files: { 'C:\\npm\\codex.cmd': npmCmdShim('%evil%\\payload.js') },
    });
    try {
      resolveHostCliCommand('codex', facts);
      expect.unreachable();
    } catch (err) {
      expect((err as NodeJS.ErrnoException).code).toBeUndefined();
      expect((err as Error).message).toContain('codex');
      expect((err as Error).message).toContain('CADENCE_HOST_CLI_BIN');
    }
  });

  it('319-01/AC-3: a .cmd that does not match the canonical invoking line (no %* at all) is refused', () => {
    const facts = makeFacts({
      env: { Path: 'C:\\npm' },
      files: {
        'C:\\npm\\codex.cmd': ['@ECHO off', 'node "%dp0%\\codex.js" %1 %2 %3'].join('\r\n'),
      },
    });
    try {
      resolveHostCliCommand('codex', facts);
      expect.unreachable();
    } catch (err) {
      expect((err as NodeJS.ErrnoException).code).toBeUndefined();
      expect((err as Error).message).toContain('codex');
      expect((err as Error).message).toContain('CADENCE_HOST_CLI_BIN');
    }
  });

  // Fix-round item 1/2: lines that DO end in "<quoted dp0 target>" %*" but are
  // not the canonical shim invocation (no mandatory prog token ahead of a
  // non-.exe target, or preceded by something other than line-start/"&")
  // must still be refused — the earlier, unanchored regex mistakenly ran
  // these through node.exe/execPath.
  const NON_CANONICAL_BUT_TAIL_MATCHING_SHIMS: Record<string, string> = {
    'literal "node" prefix instead of "%_prog%"/"%~dp0\\node.exe"': 'node "%dp0%\\codex.js" %*',
    'cscript prefix': 'cscript //nologo "%dp0%\\codex.js" %*',
    'a prog quote that is neither %_prog% nor %~dp0\\node.exe (python.exe)':
      '"%dp0%\\python.exe" "%dp0%\\codex.js" %*',
    'REM-commented line': 'REM "%dp0%\\codex.js" %*',
    'prog-less target that is not .exe': '"%dp0%\\codex.js" %*',
    // Fix-round 2 item A: indentation (as inside a real legacy IF/ELSE
    // block) must not make an otherwise-non-canonical line start matching —
    // `^[ \t]*@?` only widens what counts as "line start", it doesn't relax
    // which forms are accepted there.
    'indented REM-commented line': '  REM "%dp0%\\codex.js" %*',
    'indented prog-less target that is not .exe': '  "%dp0%\\codex.js" %*',
    'indented prog quote that is neither %_prog% nor %~dp0\\node.exe (python.exe)':
      '  "%dp0%\\python.exe" "%dp0%\\codex.js" %*',
  };

  for (const [label, line] of Object.entries(NON_CANONICAL_BUT_TAIL_MATCHING_SHIMS)) {
    it(`319-01/AC-3: refuses a shim line that superficially ends "<target>" %* but isn't canonical — ${label}`, () => {
      const facts = makeFacts({
        env: { Path: 'C:\\npm' },
        files: { 'C:\\npm\\codex.cmd': ['@ECHO off', line].join('\r\n') },
      });
      try {
        resolveHostCliCommand('codex', facts);
        expect.unreachable();
      } catch (err) {
        expect((err as NodeJS.ErrnoException).code).toBeUndefined();
        expect((err as Error).message).toContain('codex');
        expect((err as Error).message).toContain('CADENCE_HOST_CLI_BIN');
      }
    });
  }

  it('319-01/AC-3: two lines both matching the canonical invoking line is refused as ambiguous', () => {
    const facts = makeFacts({
      env: { Path: 'C:\\npm' },
      files: {
        'C:\\npm\\codex.cmd': [
          '@ECHO off',
          '"%_prog%"  "%dp0%\\good.js" %*',
          'exit /b',
          '"%_prog%"  "%dp0%\\other.js" %*',
        ].join('\r\n'),
        'C:\\npm\\node.exe': 'node',
      },
    });
    try {
      resolveHostCliCommand('codex', facts);
      expect.unreachable();
    } catch (err) {
      expect((err as NodeJS.ErrnoException).code).toBeUndefined();
      expect((err as Error).message).toContain('codex');
      expect((err as Error).message).toContain('CADENCE_HOST_CLI_BIN');
    }
  });

  it('319-01/AC-3: a REM-commented line containing "& <canonical tail>" is refused, not treated as a real invocation', () => {
    // cmd.exe treats the ENTIRE line as a comment once it starts with REM —
    // the "&" inside it is inert text, not a real command separator. A
    // matcher that only anchors on "&" (ignoring REM) would wrongly resolve
    // this.
    const facts = makeFacts({
      env: { Path: 'C:\\npm' },
      files: {
        'C:\\npm\\codex.cmd': ['@ECHO off', 'REM & "%_prog%"  "%dp0%\\x.js" %*'].join('\r\n'),
      },
    });
    try {
      resolveHostCliCommand('codex', facts);
      expect.unreachable();
    } catch (err) {
      expect((err as NodeJS.ErrnoException).code).toBeUndefined();
      expect((err as Error).message).toContain('codex');
      expect((err as Error).message).toContain('CADENCE_HOST_CLI_BIN');
    }
  });

  it('319-01/AC-3: a "::"-commented line containing "& <canonical tail>" is refused', () => {
    const facts = makeFacts({
      env: { Path: 'C:\\npm' },
      files: {
        'C:\\npm\\codex.cmd': ['@ECHO off', ':: & "%_prog%"  "%dp0%\\x.js" %*'].join('\r\n'),
      },
    });
    try {
      resolveHostCliCommand('codex', facts);
      expect.unreachable();
    } catch (err) {
      expect((err as NodeJS.ErrnoException).code).toBeUndefined();
      expect((err as Error).message).toContain('codex');
      expect((err as Error).message).toContain('CADENCE_HOST_CLI_BIN');
    }
  });

  it('319-01/AC-3: a shim whose expansion uses %CD% instead of %dp0%/%~dp0 is refused', () => {
    const facts = makeFacts({
      env: { Path: 'C:\\npm' },
      files: {
        'C:\\npm\\codex.cmd': ['@ECHO off', '"%_prog%"  "%CD%\\codex.js" %*'].join('\r\n'),
      },
    });
    expect(() => resolveHostCliCommand('codex', facts)).toThrow(/CADENCE_HOST_CLI_BIN/);
  });

  it('319-01/AC-3: a shim target that is neither JS nor .exe (e.g. .ps1) is refused', () => {
    const facts = makeFacts({
      env: { Path: 'C:\\npm' },
      files: { 'C:\\npm\\codex.cmd': npmCmdShim('codex.ps1') },
    });
    try {
      resolveHostCliCommand('codex', facts);
      expect.unreachable();
    } catch (err) {
      expect((err as NodeJS.ErrnoException).code).toBeUndefined();
      expect((err as Error).message).toContain('CADENCE_HOST_CLI_BIN');
    }
  });

  it('319-01/AC-3: a shim target literally named "..foo.js" (not a parent-directory escape) is allowed', () => {
    // ".." is only a parent-reference when it is a whole path SEGMENT
    // (".."  or "..\\..."); a filename that merely *starts* with two dots,
    // like "..foo.js", must resolve normally and not be refused as an escape.
    const facts = makeFacts({
      env: { Path: 'C:\\npm' },
      files: {
        'C:\\npm\\codex.cmd': npmCmdShim('..foo.js'),
        'C:\\npm\\node.exe': 'node',
      },
    });
    const result = resolveHostCliCommand('codex', facts);
    expect(result).toEqual({ command: 'C:\\npm\\node.exe', prefixArgs: ['C:\\npm\\..foo.js'] });
  });

  it('319-01/AC-4: a bare name found only in the cwd (not on any PATH directory) is not resolved', () => {
    const facts = makeFacts({
      env: { Path: 'C:\\real', PATHEXT: '.EXE' },
      files: {
        // "cwd" file — never on PATH, and PATH also contains a "." segment
        // and a drive-relative segment that some shells treat as cwd-ish.
        'codex.exe': 'cwd file',
        'C:\\cwd\\codex.exe': 'cwd file 2',
      },
    });
    expect(() => resolveHostCliCommand('codex', facts)).toThrow(
      expect.objectContaining({ code: 'ENOENT' }),
    );
  });

  it('319-01/AC-4: Path=".;C:relative" never resolves a bare name from the cwd', () => {
    const facts = makeFacts({
      env: { Path: '.;C:relative' },
      files: { '.\\codex.exe': 'cwd', 'C:relative\\codex.exe': 'drive-relative' },
    });
    expect(() => resolveHostCliCommand('codex', facts)).toThrow(
      expect.objectContaining({ code: 'ENOENT' }),
    );
  });

  it('319-01/AC-4: every exhausted lookup form throws ENOENT naming the bin — bare name', () => {
    const facts = makeFacts({ env: { Path: 'C:\\empty' }, files: {} });
    try {
      resolveHostCliCommand('codex', facts);
      expect.unreachable();
    } catch (err) {
      expect((err as NodeJS.ErrnoException).code).toBe('ENOENT');
      expect((err as Error).message).toContain('codex');
    }
  });

  it('319-01/AC-4: every exhausted lookup form throws ENOENT naming the bin — already-suffixed bare name', () => {
    const facts = makeFacts({ env: { Path: 'C:\\empty' }, files: {} });
    try {
      resolveHostCliCommand('codex.cmd', facts);
      expect.unreachable();
    } catch (err) {
      expect((err as NodeJS.ErrnoException).code).toBe('ENOENT');
      expect((err as Error).message).toContain('codex.cmd');
    }
  });

  it('319-01/AC-4: every exhausted lookup form throws ENOENT naming the bin — nonexistent separator-bearing path', () => {
    const facts = makeFacts({ files: {} });
    try {
      resolveHostCliCommand('C:\\nowhere\\codex.exe', facts);
      expect.unreachable();
    } catch (err) {
      expect((err as NodeJS.ErrnoException).code).toBe('ENOENT');
      expect((err as Error).message).toContain('C:\\nowhere\\codex.exe');
    }
  });

  it('319-01/AC-4: ENOENT wording differs for a bare (PATH-searched) lookup vs an explicit configured path', () => {
    const bareFacts = makeFacts({ env: { Path: 'C:\\empty' }, files: {} });
    expect(() => resolveHostCliCommand('codex', bareFacts)).toThrow(/PATH × PATHEXT/);

    const pathFacts = makeFacts({ files: {} });
    expect(() => resolveHostCliCommand('.\\codex.exe', pathFacts)).toThrow(/configured path/);
  });
});
