import { describe, it, expect } from 'vitest';
import { redactOutput, secretValues } from '../../src/verify/test-runner.js';

// Phase 348 (T1): four named secret shapes the phase-346 output-tail
// redaction let through. Redaction stays best-effort; each "not covered"
// assertion below pins a stated limit, not a guarantee.

/** The literal list a credential-named environment produces, as the runner builds it. */
function envLiterals(env: NodeJS.ProcessEnv): string[] {
  return secretValues(undefined, env);
}

describe('phase 348 AC-1: a credential flag or -u at the start of the text', () => {
  it('348-01/AC-1: --auth-token at the very start of the text has its value redacted and its flag name kept', () => {
    expect(redactOutput('--auth-token s3cretvalue99')).toBe('--auth-token [REDACTED]');
  });

  it('348-01/AC-1: --db-pass= at the very start of the text has its value redacted and its flag name kept', () => {
    expect(redactOutput('--db-pass=hunter2pw')).toBe('--db-pass=[REDACTED]');
  });

  it('348-01/AC-1: -u user:pw at the very start of the text is redacted and -u is kept', () => {
    expect(redactOutput('-u alice:hunter2pw')).toBe('-u [REDACTED]');
  });

  it('348-01/AC-1: the same three inputs after a newline are redacted', () => {
    expect(redactOutput('run\n--auth-token s3cretvalue99')).toBe('run\n--auth-token [REDACTED]');
    expect(redactOutput('run\n--db-pass=hunter2pw')).toBe('run\n--db-pass=[REDACTED]');
    expect(redactOutput('run\n-u alice:hunter2pw')).toBe('run\n-u [REDACTED]');
    // A newline as the very first character, too.
    expect(redactOutput('\n--auth-token s3cretvalue99')).toBe('\n--auth-token [REDACTED]');
    expect(redactOutput('\n--db-pass=hunter2pw')).toBe('\n--db-pass=[REDACTED]');
    expect(redactOutput('\n-u alice:hunter2pw')).toBe('\n-u [REDACTED]');
  });

  it('348-01/AC-1: the same three inputs after one space are redacted', () => {
    expect(redactOutput(' --auth-token s3cretvalue99')).toBe(' --auth-token [REDACTED]');
    expect(redactOutput(' --db-pass=hunter2pw')).toBe(' --db-pass=[REDACTED]');
    expect(redactOutput(' -u alice:hunter2pw')).toBe(' -u [REDACTED]');
    expect(redactOutput('tool --auth-token s3cretvalue99')).toBe('tool --auth-token [REDACTED]');
    expect(redactOutput('tool --db-pass=hunter2pw')).toBe('tool --db-pass=[REDACTED]');
    expect(redactOutput('curl -u alice:hunter2pw')).toBe('curl -u [REDACTED]');
  });

  it('348-01/AC-1: a command that starts with a credential flag gains a literal in secretValues', () => {
    expect(secretValues('--auth-token s3cretvalue99 run', {})).toContain('s3cretvalue99');
    expect(secretValues('--db-pass=hunter2pw run', {})).toContain('hunter2pw');
    const literals = secretValues('--auth-token s3cretvalue99 run', {});
    expect(redactOutput('connecting with s3cretvalue99', literals)).toBe('connecting with [REDACTED]');
  });

  it('348-01/AC-1: two spaces after -u is outside what AC-1 claims; the phase-346 pattern (-u, then any whitespace) still redacts it', () => {
    // AC-1 lists this as "not covered", meaning not promised. The pattern has
    // matched `-u\s+` since phase 346, so mid-text it was already redacted;
    // phase 348 does not narrow that, and the start-of-text form now behaves
    // the same as the mid-text form. Pinned as built, not as a guarantee.
    expect(redactOutput('curl -u  alice:hunter2pw')).toBe('curl -u  [REDACTED]');
    expect(redactOutput('-u  alice:hunter2pw')).toBe('-u  [REDACTED]');
  });

  it('348-01/AC-1: text after the redacted start-of-text value is kept', () => {
    expect(redactOutput('--auth-token s3cretvalue99 --verbose\nnext line')).toBe(
      '--auth-token [REDACTED] --verbose\nnext line',
    );
    expect(redactOutput('-u alice:hunter2pw http://x')).toBe('-u [REDACTED] http://x');
  });
});

describe('phase 348 AC-2: a /-prefixed credential value containing + or =', () => {
  it('348-01/AC-2: API_TOKEN=/AbCdEf123456+/xyz== is a literal and is redacted in the output', () => {
    const value = '/AbCdEf123456+/xyz==';
    const literals = envLiterals({ API_TOKEN: value });
    expect(literals).toContain(value);
    expect(redactOutput(`sent header x-svc: ${value} ok`, literals)).toBe('sent header x-svc: [REDACTED] ok');
  });

  it('348-01/AC-2: API_TOKEN=/AbCdEf123456/xyz== is a literal and is redacted in the output', () => {
    const value = '/AbCdEf123456/xyz==';
    const literals = envLiterals({ API_TOKEN: value });
    expect(literals).toContain(value);
    expect(redactOutput(`sent header x-svc: ${value} ok`, literals)).toBe('sent header x-svc: [REDACTED] ok');
  });

  it('348-01/AC-2: SSH_AUTH_SOCK and GIT_ASKPASS paths are still not literals', () => {
    expect(envLiterals({ SSH_AUTH_SOCK: '/tmp/ssh-abc/agent.123' })).toEqual([]);
    expect(envLiterals({ GIT_ASKPASS: '/usr/bin/askpass' })).toEqual([]);
    const literals = envLiterals({ SSH_AUTH_SOCK: '/tmp/ssh-abc/agent.123', GIT_ASKPASS: '/usr/bin/askpass' });
    const text = 'agent at /tmp/ssh-abc/agent.123 via /usr/bin/askpass';
    expect(redactOutput(text, literals)).toBe(text);
  });

  it('348-01/AC-2: ~, . and drive-prefixed values are still not literals, even with + and =', () => {
    expect(envLiterals({ API_TOKEN: '~/abc+def==xyz' })).toEqual([]);
    expect(envLiterals({ API_TOKEN: './abc+def==xyz' })).toEqual([]);
    expect(envLiterals({ API_TOKEN: 'C:\\abc+def==' })).toEqual([]);
    for (const value of ['~/abc+def==xyz', './abc+def==xyz', 'C:\\abc+def==']) {
      const text = `read ${value} done`;
      expect(redactOutput(text, envLiterals({ API_TOKEN: value })), value).toBe(text);
    }
  });

  it('348-01/AC-2: not covered: a /-prefixed value with neither + nor = is not a literal', () => {
    const value = '/AbCdEf123456/xyz';
    const literals = envLiterals({ API_TOKEN: value });
    expect(literals).toEqual([]);
    expect(redactOutput(`sent ${value} ok`, literals)).toBe(`sent ${value} ok`);
  });

  it('348-01/AC-2: not covered: a /-prefixed value under 8 characters is not a literal', () => {
    for (const value of ['/a+b=', '/abc+d=']) {
      const literals = envLiterals({ API_TOKEN: value });
      expect(literals, value).toEqual([]);
      expect(redactOutput(`sent ${value} ok`, literals), value).toBe(`sent ${value} ok`);
    }
    // Exactly 8 characters is covered.
    expect(envLiterals({ API_TOKEN: '/abc+de=' })).toEqual(['/abc+de=']);
  });
});

describe('phase 348 AC-3: a quoted auth header value', () => {
  it('348-01/AC-3: "Authorization":"Bearer …" has its value replaced and its key kept', () => {
    expect(redactOutput('"Authorization":"Bearer abcdef1234567890"')).toBe('"Authorization":"[REDACTED]"');
  });

  it('348-01/AC-3: "Proxy-Authorization": "Basic …" has its value replaced and its key kept', () => {
    expect(redactOutput('"Proxy-Authorization": "Basic dXNlcjpwYXNzd29yZA=="')).toBe(
      '"Proxy-Authorization": "[REDACTED]"',
    );
  });

  it('348-01/AC-3: a single-quoted key and value come back with the key as written and a double-quoted [REDACTED]', () => {
    expect(redactOutput("'authorization': 'Bearer abcdef1234567890'")).toBe(`'authorization': "[REDACTED]"`);
  });

  it('348-01/AC-3: "Cookie":"sid=…" has its value replaced and its key kept', () => {
    expect(redactOutput('"Cookie":"sid=abcdef1234567890"')).toBe('"Cookie":"[REDACTED]"');
  });

  it('348-01/AC-3: "SET-COOKIE" : "…" (any letter case, whitespace around the colon) has its value replaced', () => {
    expect(redactOutput('"SET-COOKIE" : "sid=abc; Path=/"')).toBe('"SET-COOKIE" : "[REDACTED]"');
  });

  it('348-01/AC-3: an escaped quote inside the value does not leave its suffix visible', () => {
    const out = redactOutput('"Authorization":"Bearer a\\"b-suffix"');
    expect(out).toBe('"Authorization":"[REDACTED]"');
    expect(out).not.toContain('b-suffix');
  });

  it('348-01/AC-3: each of the four header names counts in any letter case, and the rest of the object is kept', () => {
    for (const key of [
      'Authorization',
      'authorization',
      'AUTHORIZATION',
      'Proxy-Authorization',
      'proxy-authorization',
      'PROXY-AUTHORIZATION',
      'Cookie',
      'cookie',
      'COOKIE',
      'Set-Cookie',
      'set-cookie',
      'sEt-cOOkie',
    ]) {
      expect(redactOutput(`{ "${key}"\t:  "opaque-value-123", "user": "me" }`), key).toBe(
        `{ "${key}"\t:  "[REDACTED]", "user": "me" }`,
      );
    }
  });

  it('348-01/AC-3: not covered: other key names are left unchanged', () => {
    for (const text of ['"x-authorization":"Bearer abcdef1234567890"', '"cookies":"sid=abcdef1234567890"']) {
      expect(redactOutput(text), text).toBe(text);
    }
  });

  it('348-01/AC-3: not covered: an unquoted key with a quoted value is left unchanged', () => {
    for (const text of ['Authorization: "Bearer abcdef1234567890"', 'Cookie: "sid=abcdef1234567890"']) {
      expect(redactOutput(text), text).toBe(text);
    }
  });

  it('348-01/AC-3: not covered: a quoted key with an unquoted value is left unchanged', () => {
    for (const text of ['"Authorization": Bearer abcdef1234567890', '"Cookie": sid=abcdef1234567890']) {
      expect(redactOutput(text), text).toBe(text);
    }
  });

  it('348-01/AC-3: an unquoted Authorization header line is handled by the shared phase-346 pattern, not by the quoted-key pattern', () => {
    // Existing behaviour, unchanged by phase 348: the shared `redactSecrets`
    // pattern redacts `authorization: <scheme> <value>` whatever precedes it.
    expect(redactOutput('Authorization: Bearer abcdef1234567890')).toBe('Authorization: [REDACTED]');
    expect(redactOutput('x-authorization: Bearer abcdef1234567890')).toBe('x-authorization: [REDACTED]');
  });

  it('348-01/AC-3: the quoted-header scan stays fast on long adversarial lines', () => {
    const started = Date.now();
    redactOutput(`"cookie":'`.repeat(26000));
    redactOutput(`'cookie':"a\\`.repeat(26000));
    redactOutput('"authorization"' + ' '.repeat(262144));
    redactOutput('"set-cookie":"' + 'a\\"'.repeat(87000));
    redactOutput('-u '.repeat(87000));
    redactOutput('--key-'.repeat(43000));
    const ms = Date.now() - started;
    expect(ms).toBeLessThan(3000);
  });
});

describe('phase 348 AC-4: two or more consecutive words of a passphrase', () => {
  const literals = envLiterals({ DB_PASSWORD: 'blue cat sat mat' });

  it('348-01/AC-4: blue cat is replaced by [REDACTED]', () => {
    expect(literals).toContain('blue cat sat mat');
    expect(redactOutput('saw blue cat here', literals)).toBe('saw [REDACTED] here');
    expect(redactOutput('blue cat', literals)).toBe('[REDACTED]');
  });

  it('348-01/AC-4: cat sat mat is replaced by [REDACTED]', () => {
    expect(redactOutput('saw cat sat mat here', literals)).toBe('saw [REDACTED] here');
    expect(redactOutput('cat sat mat', literals)).toBe('[REDACTED]');
  });

  it('348-01/AC-4: the whole phrase is replaced by one [REDACTED], longest run first', () => {
    expect(redactOutput('saw blue cat sat mat here', literals)).toBe('saw [REDACTED] here');
    expect(redactOutput('blue cat sat mat', literals)).toBe('[REDACTED]');
    // The three-word run from the first word wins over its two-word prefix.
    expect(redactOutput('saw blue cat sat here', literals)).toBe('saw [REDACTED] here');
  });

  it('348-01/AC-4: DB_PASSWORD=blue cat sat mat leaves none of cat, sat, mat', () => {
    const out = redactOutput('DB_PASSWORD=blue cat sat mat', literals);
    expect(out).not.toContain('cat');
    expect(out).not.toContain('sat');
    expect(out).not.toContain('mat');
    expect(out).not.toContain('blue');
    expect(out).toContain('DB_PASSWORD=');
  });

  it('348-01/AC-4: not covered: a run under 8 characters (cat sat alone) is left unchanged', () => {
    expect(redactOutput('the cat sat down', literals)).toBe('the cat sat down');
    expect(redactOutput('cat sat', literals)).toBe('cat sat');
    expect(redactOutput('a sat mat b', literals)).toBe('a sat mat b');
  });

  it('348-01/AC-4: not covered: one word under 8 characters on its own is left unchanged', () => {
    expect(redactOutput('cat', literals)).toBe('cat');
    expect(redactOutput('a blue thing and a mat', literals)).toBe('a blue thing and a mat');
  });

  it('348-01/AC-4: not covered: the same words separated by different whitespace are left unchanged', () => {
    expect(redactOutput('blue  cat', literals)).toBe('blue  cat');
    expect(redactOutput('blue\ncat', literals)).toBe('blue\ncat');
    expect(redactOutput('blue\tcat', literals)).toBe('blue\tcat');
  });

  it("348-01/AC-4: a run keeps the literal's own whitespace", () => {
    const wide = envLiterals({ DB_PASSWORD: 'blue  cat sat mat' });
    expect(redactOutput('saw blue  cat here', wide)).toBe('saw [REDACTED] here');
    expect(redactOutput('saw blue cat here', wide)).toBe('saw blue cat here');
  });

  it('348-01/AC-4: runs start and end on word boundaries of the literal, never inside a word', () => {
    // `lue cat` + more is not a run of the literal: only whole-word substrings are.
    const two = envLiterals({ DB_PASSWORD: 'abcd efgh' });
    expect(redactOutput('x bcd efgh y', two)).toBe('x bcd efgh y');
    expect(redactOutput('x abcd efg y', two)).toBe('x abcd efg y');
    expect(redactOutput('x abcd efgh y', two)).toBe('x [REDACTED] y');
  });

  it('348-01/AC-4: a literal of 12 words produces runs; a literal of 13 words produces none', () => {
    const twelve = 'aa bb cc dd ee ff gg hh ii jj kk ll';
    const thirteen = `${twelve} mm`;
    expect(twelve.split(' ')).toHaveLength(12);
    expect(thirteen.split(' ')).toHaveLength(13);
    expect(redactOutput('saw aa bb cc here', envLiterals({ DB_PASSWORD: twelve }))).toBe('saw [REDACTED] here');
    const lits13 = envLiterals({ DB_PASSWORD: thirteen });
    expect(lits13).toEqual([thirteen]);
    expect(redactOutput('saw aa bb cc here', lits13)).toBe('saw aa bb cc here');
    expect(redactOutput('saw kk ll mm here', lits13)).toBe('saw kk ll mm here');
    // The whole 13-word literal is still redacted as a literal.
    expect(redactOutput(`saw ${thirteen} here`, lits13)).toBe('saw [REDACTED] here');
  });
});

describe('phase 348 AC-5: the named unrelated inputs are left unchanged', () => {
  it('348-01/AC-5: vitest run --passWithNoTests foo is byte-identical', () => {
    const text = 'vitest run --passWithNoTests foo';
    expect(redactOutput(text, envLiterals({}))).toBe(text);
  });

  it('348-01/AC-5: --passWithNoTests foo at the very start is byte-identical', () => {
    const text = '--passWithNoTests foo';
    expect(redactOutput(text, envLiterals({}))).toBe(text);
    expect(secretValues(text, {})).toEqual([]);
  });

  it('348-01/AC-5: GIT_AUTHOR_NAME=Ada Lovelace leaves "Ada Lovelace wrote this" byte-identical', () => {
    const literals = envLiterals({ GIT_AUTHOR_NAME: 'Ada Lovelace' });
    expect(literals).toEqual([]);
    expect(redactOutput('Ada Lovelace wrote this', literals)).toBe('Ada Lovelace wrote this');
  });

  it('348-01/AC-5: DISABLE_AUTH=true leaves the text "true" byte-identical', () => {
    const literals = envLiterals({ DISABLE_AUTH: 'true' });
    expect(literals).toEqual([]);
    expect(redactOutput('true', literals)).toBe('true');
  });

  it('348-01/AC-5: {"author":"Ada"} is byte-identical', () => {
    const text = '{"author":"Ada"}';
    expect(redactOutput(text, envLiterals({}))).toBe(text);
  });

  it('348-01/AC-5: DB_PASSWORD=blue dog ran far leaves "the cat sat" byte-identical', () => {
    const literals = envLiterals({ DB_PASSWORD: 'blue dog ran far' });
    expect(literals).toContain('blue dog ran far');
    expect(redactOutput('the cat sat', literals)).toBe('the cat sat');
  });
});

describe('phase 348: redactOutput stays safe to apply twice', () => {
  const passphrase = envLiterals({ DB_PASSWORD: 'blue cat sat mat' });
  const slash = envLiterals({ API_TOKEN: '/AbCdEf123456+/xyz==', OTHER_TOKEN: '/AbCdEf123456/xyz==' });
  const cases: Array<[string, readonly string[]]> = [
    ['--auth-token s3cretvalue99', []],
    ['--db-pass=hunter2pw', []],
    ['-u alice:hunter2pw', []],
    ['run\n--auth-token s3cretvalue99\n--db-pass=hunter2pw\n-u alice:hunter2pw', []],
    [' --auth-token s3cretvalue99 --db-pass=hunter2pw -u alice:hunter2pw', []],
    ['sent /AbCdEf123456+/xyz== and /AbCdEf123456/xyz== ok', slash],
    ['"Authorization":"Bearer abcdef1234567890"', []],
    ['"Proxy-Authorization": "Basic dXNlcjpwYXNzd29yZA=="', []],
    ["'authorization': 'Bearer abcdef1234567890'", []],
    ['"Cookie":"sid=abcdef1234567890"', []],
    ['"SET-COOKIE" : "sid=abc; Path=/"', []],
    ['"Authorization":"Bearer a\\"b-suffix"', []],
    ['blue cat', passphrase],
    ['cat sat mat', passphrase],
    ['blue cat sat mat', passphrase],
    ['DB_PASSWORD=blue cat sat mat', passphrase],
  ];

  it('348-01/AC-1: applying redactOutput twice equals applying it once for the AC-1 to AC-4 inputs', () => {
    for (const [text, literals] of cases) {
      const once = redactOutput(text, literals);
      expect(once, text).not.toBe(text);
      expect(redactOutput(once, literals), text).toBe(once);
    }
  });
});
