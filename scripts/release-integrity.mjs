#!/usr/bin/env node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CADENCE_SCOPE = '@thomas-powers-jr/cadence-';
const DEFAULT_ROOT = fileURLToPath(new URL('..', import.meta.url));

// Real incidents: the post-publish "verify registry" step failed although the
// publish had already succeeded and every package was live moments later.
//   - 2026-07-25, v1.51.0 (Release run 30136637570): host-codex still showed the
//     OLD version after 3 quick retries (~3s of backoff).
//   - 2026-10-04, v1.69.0 (plus 1.67.3 and 1.68.0): a 10-attempt linear backoff
//     (~45s total) still lost the race.
// Cause: the npm registry edge serves the packument with `max-age=300`, so a
// stale answer can persist for about five minutes after publish. `npm view`
// already revalidates (`preferOnline: true` is hardcoded), so no cache flag
// helps; the stale copy is the edge's, and only time fixes it. The pre-publish
// `--verify-npm` check fetches the packument seconds before publish and can
// warm that edge copy, so the 300s window may start before the publish does.
// Hence a flat 15s poll for up to 40 attempts: (40 - 1) * 15s = 585s of
// waiting, comfortably longer than the 300s edge cache. Wall time is longer
// still, because spawnSync checks the packages one after another each round.
// Each miss prints a progress line to stderr so the wait is visible in the
// workflow log.
// This budget is deliberately only used post-publish (runReleaseIntegrity).
// The pre-publish idempotency check (verifyNpmPublished) keeps the fast
// 3-attempt default so a genuinely unpublished package is detected quickly.
export const POST_PUBLISH_VERIFY_ATTEMPTS = 40;
export const POST_PUBLISH_VERIFY_INTERVAL_MS = 15_000;

export function normalizeVersion(raw) {
  const version = String(raw ?? '').trim().replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid package version: ${raw}`);
  }
  return version;
}

export function extractChangelogEntry(changelog, version) {
  const normalized = normalizeVersion(version);
  const lines = String(changelog).split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${normalized}`);
  if (start === -1) {
    throw new Error(`packages/core/CHANGELOG.md has no ## ${normalized} entry`);
  }

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^##\s+\S/.test(lines[i])) {
      end = i;
      break;
    }
  }

  return lines.slice(start + 1, end).join('\n').trim();
}

export function validatePackageVersions(packages, version) {
  const normalized = normalizeVersion(version);
  const mismatches = packages.filter((pkg) => pkg.version !== normalized);
  if (mismatches.length > 0) {
    throw new Error(
      `Package version mismatch for ${normalized}: ${mismatches
        .map((pkg) => `${pkg.name}@${pkg.version}`)
        .join(', ')}`,
    );
  }
}

export function buildReleaseNotes({ version, packages, changelogEntry, runUrl }) {
  const normalized = normalizeVersion(version);
  const packageList = packages.map((pkg) => `- \`${pkg.name}\``).join('\n');
  const verification = [
    '- npm publish completed with provenance in the Release workflow.',
    `- Remote tag \`v${normalized}\` is verified before the GitHub Release is created.`,
    '- npm package versions and GitHub Release metadata are verified after publish.',
  ];

  if (runUrl) {
    verification.push(`- Workflow run: ${runUrl}`);
  }

  return [
    `## Package Changelog`,
    '',
    changelogEntry,
    '',
    '## Published Packages',
    '',
    `All public packages are published on npm as \`${normalized}\`:`,
    '',
    packageList,
    '',
    '## Verification',
    '',
    verification.join('\n'),
    '',
  ].join('\n');
}

export async function discoverPublicPackages(root) {
  const packagesDir = join(root, 'packages');
  const entries = await readdir(packagesDir, { withFileTypes: true });
  const packages = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = join(packagesDir, entry.name);
    const packageJsonPath = join(dir, 'package.json');
    let json;
    try {
      json = JSON.parse(await readFile(packageJsonPath, 'utf8'));
    } catch {
      continue;
    }
    if (json.private === true) continue;
    if (typeof json.name !== 'string' || !json.name.startsWith(CADENCE_SCOPE)) continue;
    packages.push({ name: json.name, version: normalizeVersion(json.version), dir });
  }

  packages.sort((a, b) => a.name.localeCompare(b.name));
  if (packages.length === 0) {
    throw new Error(`No public ${CADENCE_SCOPE} packages found under ${packagesDir}`);
  }
  return packages;
}

export function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: 'utf8',
    shell: false,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(
      `${command} ${args.join(' ')} failed with exit ${result.status}${detail ? `:\n${detail}` : ''}`,
    );
  }
  return result.stdout.trim();
}

async function retry(label, fn, attempts = 3, { delay = (attempt) => 1000 * attempt, onFailure } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (onFailure) onFailure(err, attempt);
      if (attempt === attempts) break;
      await new Promise((resolve) => setTimeout(resolve, delay(attempt)));
    }
  }
  throw new Error(`${label} failed after ${attempts} attempts: ${lastError?.message ?? lastError}`);
}

async function readCoreVersion(root) {
  const coreJson = JSON.parse(await readFile(join(root, 'packages', 'core', 'package.json'), 'utf8'));
  return normalizeVersion(coreJson.version);
}

async function readCoreChangelogEntry(root, version) {
  const changelog = await readFile(join(root, 'packages', 'core', 'CHANGELOG.md'), 'utf8');
  return extractChangelogEntry(changelog, version);
}

function workflowRunUrl(env) {
  if (!env.GITHUB_SERVER_URL || !env.GITHUB_REPOSITORY || !env.GITHUB_RUN_ID) return '';
  return `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;
}

function assertRemoteTag(root, tag, env) {
  const output = runCommand('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tag}`], {
    cwd: root,
    env,
  });
  if (!output.includes(`refs/tags/${tag}`)) {
    throw new Error(`Remote tag ${tag} was not found on origin`);
  }
}

function releaseExists(tag, root, env) {
  const result = spawnSync('gh', ['release', 'view', tag], {
    cwd: root,
    env,
    encoding: 'utf8',
    shell: false,
  });
  if (result.status === 0) return true;
  const combined = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  if (combined.includes('release not found')) return false;
  throw new Error(`gh release view ${tag} failed:\n${combined.trim()}`);
}

function upsertGitHubRelease(root, tag, title, notesFile, env) {
  if (releaseExists(tag, root, env)) {
    runCommand(
      'gh',
      [
        'release',
        'edit',
        tag,
        '--title',
        title,
        '--notes-file',
        notesFile,
        '--draft=false',
        '--prerelease=false',
        '--latest',
        '--verify-tag',
      ],
      { cwd: root, env },
    );
    return 'updated';
  }

  runCommand(
    'gh',
    ['release', 'create', tag, '--title', title, '--notes-file', notesFile, '--latest', '--verify-tag'],
    { cwd: root, env },
  );
  return 'created';
}

function collapseWhitespace(text) {
  return String(text).replace(/\s+/g, ' ').trim();
}

// Progress lines must stay one line each and bounded: a real `npm view`
// failure carries several lines (including "A complete log of this run can be
// found in ..."), and the post-publish poll can print up to 40 of them per
// package.
const PROGRESS_REASON_MAX_CHARS = 200;

function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function describeSeen(err) {
  if (err.published !== undefined) return err.published || '<empty>';
  return `error: ${truncate(collapseWhitespace(err.message), PROGRESS_REASON_MAX_CHARS)}`;
}

async function verifyNpmPackages(packages, version, root, env, { attempts = 3, delay, progress } = {}) {
  await Promise.all(
    packages.map(async (pkg) => {
      let startedAt;
      const elapsedSeconds = () => Math.round((Date.now() - startedAt) / 1000);
      try {
        await retry(
          `npm view ${pkg.name}`,
          async () => {
            startedAt ??= Date.now();
            const published = runCommand('npm', ['view', pkg.name, 'version'], { cwd: root, env });
            if (published !== version) {
              const err = new Error(`${pkg.name} is ${published} on npm, expected ${version}`);
              err.published = published;
              throw err;
            }
          },
          attempts,
          {
            ...(delay ? { delay } : {}),
            ...(progress
              ? {
                  onFailure: (err, attempt) =>
                    progress({
                      pkg: pkg.name,
                      seen: describeSeen(err),
                      expected: version,
                      attempt,
                      attempts,
                      elapsedSeconds: elapsedSeconds(),
                    }),
                }
              : {}),
          },
        );
      } catch (err) {
        if (!progress) throw err;
        throw new Error(`${err.message} (elapsed ${elapsedSeconds()}s since first attempt)`);
      }
    }),
  );
}

function verifyGitHubRelease(root, tag, env) {
  const raw = runCommand(
    'gh',
    ['release', 'view', tag, '--json', 'tagName,name,isDraft,isPrerelease,url'],
    { cwd: root, env },
  );
  const release = JSON.parse(raw);
  if (release.tagName !== tag) {
    throw new Error(`GitHub Release tagName is ${release.tagName}, expected ${tag}`);
  }
  if (release.name !== tag) {
    throw new Error(`GitHub Release name is ${release.name}, expected ${tag}`);
  }
  if (release.isDraft) {
    throw new Error(`GitHub Release ${tag} is still a draft`);
  }
  if (release.isPrerelease) {
    throw new Error(`GitHub Release ${tag} is marked prerelease`);
  }
  return release.url;
}

export async function buildReleasePlan(root = DEFAULT_ROOT, env = process.env) {
  const version = await readCoreVersion(root);
  const packages = await discoverPublicPackages(root);
  validatePackageVersions(packages, version);
  const changelogEntry = await readCoreChangelogEntry(root, version);
  const notes = buildReleaseNotes({
    version,
    packages,
    changelogEntry,
    runUrl: workflowRunUrl(env),
  });
  return { version, tag: `v${version}`, packages, notes };
}

export async function verifyNpmPublished({ root = DEFAULT_ROOT, env = process.env } = {}) {
  const plan = await buildReleasePlan(root, env);
  await verifyNpmPackages(plan.packages, plan.version, root, env);
  return plan;
}

export async function runReleaseIntegrity({ root = DEFAULT_ROOT, env = process.env, dryRun = false } = {}) {
  const plan = await buildReleasePlan(root, env);
  if (dryRun) {
    return { ...plan, action: 'dry-run', releaseUrl: '' };
  }

  const tempDir = mkdtempSync(join(tmpdir(), 'cadence-release-'));
  const notesFile = join(tempDir, `${plan.tag}-notes.md`);
  try {
    writeFileSync(notesFile, plan.notes);
    assertRemoteTag(root, plan.tag, env);
    const action = upsertGitHubRelease(root, plan.tag, plan.tag, notesFile, env);
    await verifyNpmPackages(plan.packages, plan.version, root, env, {
      attempts: POST_PUBLISH_VERIFY_ATTEMPTS,
      delay: () => POST_PUBLISH_VERIFY_INTERVAL_MS,
      progress: ({ pkg, seen, expected, attempt, attempts, elapsedSeconds }) => {
        process.stderr.write(
          `release-integrity: ${pkg} saw ${seen}, expected ${expected} (attempt ${attempt}/${attempts}, elapsed ${elapsedSeconds}s)\n`,
        );
      },
    });
    assertRemoteTag(root, plan.tag, env);
    const releaseUrl = verifyGitHubRelease(root, plan.tag, env);
    return { ...plan, action, releaseUrl };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  return {
    dryRun: argv.includes('--dry-run'),
    verifyNpm: argv.includes('--verify-npm'),
    json: argv.includes('--json'),
    root: argv.includes('--root') ? argv[argv.indexOf('--root') + 1] : DEFAULT_ROOT,
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.verifyNpm) {
    const result = await verifyNpmPublished(opts);
    if (opts.json) {
      process.stdout.write(
        `${JSON.stringify({
          version: result.version,
          tag: result.tag,
          packages: result.packages.map((pkg) => pkg.name),
          action: 'verified-npm',
        })}\n`,
      );
      return;
    }
    process.stdout.write(
      `release-integrity: verified ${result.packages.length} public npm package(s) at ${result.version}\n`,
    );
    return;
  }

  const result = await runReleaseIntegrity(opts);
  if (opts.json) {
    process.stdout.write(
      `${JSON.stringify({
        version: result.version,
        tag: result.tag,
        packages: result.packages.map((pkg) => pkg.name),
        action: result.action,
        releaseUrl: result.releaseUrl,
      })}\n`,
    );
    return;
  }
  process.stdout.write(
    [
      `release-integrity: ${result.action} GitHub Release ${result.tag}`,
      `release-integrity: verified ${result.packages.length} public npm package(s)`,
      result.releaseUrl ? `release-integrity: ${result.releaseUrl}` : '',
    ]
      .filter(Boolean)
      .join('\n') + '\n',
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    process.stderr.write(`release-integrity: ${err.message}\n`);
    process.exitCode = 1;
  });
}
