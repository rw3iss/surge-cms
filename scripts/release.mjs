#!/usr/bin/env node
/**
 * Publish a new SiteSurge CMS version — one command.
 *
 *   pnpm release 1.2.0            # or: patch | minor | major
 *   pnpm release 1.2.0 --dry-run  # everything except publish + push
 *
 * Every published package (@sitesurge/server, admin, cli, types, client, mcp
 * and create-sitesurge) carries ONE version — the CMS version. The steps:
 *
 *   1. Preflight   on `main`, clean tree, signed in to npm + GitHub, the
 *                  version is new (not tagged, not on npm, > current).
 *   2. Bump        every package.json (and the private root) to the version.
 *   3. Build+test  `pnpm -r run build`, `pnpm -r run test` (--skip-tests skips).
 *   4. Index       prepend CHANGELOG.md; update releases.json (the version
 *                  index: latest + history, read by humans and tooling).
 *   5. Commit+tag  "release: vX.Y.Z" + annotated tag vX.Y.Z.
 *   6. npm         `pnpm -r publish` — pnpm rewrites workspace: ranges and
 *                  skips any package whose version is already on npm.
 *   7. Push        main + the tag. The tag triggers the Docker image workflow.
 *   8. GitHub      Release vX.Y.Z (marked latest) with the notes and the
 *                  package tarballs attached.
 *
 * npm is the registry installs update FROM: Settings → Admin → CMS Version
 * ("Check for update" / "Update & restart") reads @sitesurge/server's
 * `latest` dist-tag and runs `npm install …@latest`. The GitHub Release is the
 * human-readable record and the updater's release-notes source.
 *
 * Re-runnable: if a run dies after the commit+tag (e.g. npm 2FA timed out),
 * run the same command again — it sees the tag on HEAD and resumes from the
 * publish step. npm publish skips what is already up; push and the GitHub
 * Release are idempotent.
 */
import { execFileSync, spawnSync, } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url,),), '..',);
const REPO = process.env.CMS_RELEASES_REPO || 'rw3iss/surge-cms';
const PRIMARY = '@sitesurge/server';

// ── args ──
const args = process.argv.slice(2,);
const flag = (f,) => args.includes(f,);
const DRY = flag('--dry-run',);
const SKIP_TESTS = flag('--skip-tests',);
const YES = flag('--yes',) || flag('-y',);
const requested = args.find((a,) => !a.startsWith('-',),);

const c = { b: (s,) => `\x1b[1m${s}\x1b[0m`, g: (s,) => `\x1b[32m${s}\x1b[0m`, y: (s,) => `\x1b[33m${s}\x1b[0m`, r: (s,) => `\x1b[31m${s}\x1b[0m`, d: (s,) => `\x1b[2m${s}\x1b[0m`, };
const step = (n, s,) => console.log(`\n${c.b(`▶ ${n}.`,)} ${s}`,);
const fail = (msg,) => {
    console.error(`\n${c.r('✗',)} ${msg}`,);
    process.exit(1,);
};

if (!requested || flag('--help',) || flag('-h',)) {
    console.log(`Usage: pnpm release <version|patch|minor|major> [--dry-run] [--skip-tests] [--yes]\n\nSee docs/PUBLISHING.md.`,);
    process.exit(requested ? 0 : 1,);
}

// ── helpers ──
const sh = (cmd, a, opts = {},) => execFileSync(cmd, a, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe',], ...opts, },).trim();
const tryShell = (cmd, a,) => {
    try {
        return { ok: true, out: sh(cmd, a,), };
    } catch (e) {
        return { ok: false, out: `${e.stdout ?? ''}${e.stderr ?? ''}`.trim(), };
    }
};
const run = (cmd, a, opts = {},) => {
    console.log(c.d(`$ ${cmd} ${a.join(' ',)}`,),);
    const r = spawnSync(cmd, a, { cwd: ROOT, stdio: 'inherit', ...opts, },);
    if (r.status !== 0) fail(`\`${cmd} ${a.join(' ',)}\` failed (exit ${r.status}).`,);
};
const readJson = (f,) => JSON.parse(readFileSync(f, 'utf8',),);
const writeJson = (f, v,) => writeFileSync(f, `${JSON.stringify(v, null, 2,)}\n`,);

function semver(v,) {
    const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(v,);
    return m ? { maj: +m[1], min: +m[2], pat: +m[3], pre: m[4] ?? '', } : null;
}
function gt(a, b,) {
    const x = semver(a,), y = semver(b,);
    for (const k of ['maj', 'min', 'pat',]) if (x[k] !== y[k]) return x[k] > y[k];
    if (!x.pre && y.pre) return true;
    if (x.pre && !y.pre) return false;
    return x.pre > y.pre;
}

/** Every publishable workspace package (non-private, has a name). */
function packages() {
    return readdirSync(path.join(ROOT, 'packages',),)
        .map((d,) => path.join(ROOT, 'packages', d, 'package.json',))
        .filter((f,) => existsSync(f,))
        .map((file,) => ({ file, json: readJson(file,), }))
        .filter((p,) => p.json.name && !p.json.private);
}

// ── version ──
const pkgs = packages();
const server = pkgs.find((p,) => p.json.name === PRIMARY);
if (!server) fail(`${PRIMARY} not found under packages/.`,);
const current = server.json.version;
let version = requested;
if (['patch', 'minor', 'major',].includes(requested,)) {
    const s = semver(current,);
    version = requested === 'major' ? `${s.maj + 1}.0.0` : requested === 'minor' ? `${s.maj}.${s.min + 1}.0` : `${s.maj}.${s.min}.${s.pat + 1}`;
}
if (!semver(version,)) fail(`"${requested}" is not a version (x.y.z) or patch|minor|major.`,);
const TAG = `v${version}`;

console.log(`${c.b('SiteSurge CMS release',)}  ${current} → ${c.g(version,)}  ${DRY ? c.y('(dry run)',) : ''}`,);

// ── 1. preflight ──
step(1, 'Preflight',);
const branch = sh('git', ['rev-parse', '--abbrev-ref', 'HEAD',],);
if (branch !== 'main') fail(`Releases are cut from main (you are on ${branch}).`,);

const tagAtHead = tryShell('git', ['rev-parse', `${TAG}^{commit}`,],);
const head = sh('git', ['rev-parse', 'HEAD',],);
const resuming = tagAtHead.ok && tagAtHead.out === head;
if (tagAtHead.ok && !resuming) fail(`Tag ${TAG} already exists on another commit — pick a new version.`,);
if (resuming) console.log(c.y(`  ${TAG} is already on HEAD — resuming from the publish step.`,),);

if (!resuming) {
    const dirty = sh('git', ['status', '--porcelain',],);
    if (dirty) fail(`Working tree is not clean — commit or stash first:\n${dirty}`,);
    if (!gt(version, current,)) fail(`${version} is not newer than the current ${current}.`,);
}

const npmUser = tryShell('npm', ['whoami',],);
if (!npmUser.ok) {
    if (DRY) console.log(c.y('  npm: not signed in (fine for a dry run; run `npm login` before releasing).',),);
    else fail('Not signed in to npm. Run `npm login` (npmjs.com account with publish rights on @sitesurge), then re-run.',);
} else console.log(`  npm: signed in as ${npmUser.out}`,);

const ghAuth = tryShell('gh', ['auth', 'status',],);
if (!ghAuth.ok) fail('GitHub CLI is not signed in. Run `gh auth login`, then re-run.',);
console.log(`  gh: signed in (repo ${REPO})`,);

const onNpm = tryShell('npm', ['view', `${PRIMARY}@${version}`, 'version',],);
if (onNpm.ok && onNpm.out === version && !resuming) fail(`${PRIMARY}@${version} is already on npm.`,);

if (!YES && !DRY && process.stdin.isTTY) {
    process.stdout.write(`\nPublish ${c.b(TAG,)} to npm and GitHub? [y/N] `,);
    const answer = spawnSync('bash', ['-c', 'read -r a; echo "$a"',], { stdio: ['inherit', 'pipe', 'inherit',], encoding: 'utf8', },).stdout.trim();
    if (!/^y(es)?$/i.test(answer,)) fail('Cancelled.',);
}

// ── release notes (from git history since the previous release) ──
function previousReleaseRef() {
    const tags = tryShell('git', ['tag', '--sort=-creatordate', '--list', 'v*', `${PRIMARY}@*`,],);
    const list = tags.ok ? tags.out.split('\n',).filter((t,) => t && t !== TAG) : [];
    return list[0] ?? null;
}
function releaseNotes() {
    const prev = previousReleaseRef();
    const range = prev ? `${prev}..${resuming ? `${TAG}~1` : 'HEAD'}` : 'HEAD';
    const log = tryShell('git', ['log', '--no-merges', '--format=%s', range,],);
    const subjects = (log.ok ? log.out.split('\n',) : []).filter((s,) => s && !/^release: v/.test(s,));
    const lines = subjects.map((s,) => `- ${s}`);
    return {
        prev,
        count: subjects.length,
        body: [
            `SiteSurge CMS ${version}.`,
            '',
            '**Update an installation:** Settings → Admin → CMS Version → **Check for update**, then **Update & restart** (npm installs). From source: pull this tag and rebuild. See docs/PUBLISHING.md.',
            '',
            `### Changes${prev ? ` since ${prev}` : ''} (${subjects.length})`,
            '',
            ...lines,
            '',
        ].join('\n',),
    };
}

const notes = releaseNotes();

if (!resuming) {
    // ── 2. bump ──
    step(2, `Set every package to ${version}`,);
    for (const p of pkgs) {
        p.json.version = version;
        writeJson(p.file, p.json,);
        console.log(`  ${p.json.name.padEnd(22,)} ${version}`,);
    }
    const rootPkg = path.join(ROOT, 'package.json',);
    const root = readJson(rootPkg,);
    root.version = version;
    writeJson(rootPkg, root,);

    // ── 3. build + test ──
    step(3, 'Build and test',);
    run('pnpm', ['-r', 'run', 'build',],);
    if (SKIP_TESTS) console.log(c.y('  tests skipped (--skip-tests)',),);
    else run('pnpm', ['-r', 'run', 'test',],);

    // ── 4. changelog + version index ──
    step(4, 'Update CHANGELOG.md and releases.json',);
    const date = new Date().toISOString().slice(0, 10,);
    const changelogFile = path.join(ROOT, 'CHANGELOG.md',);
    const prevChangelog = existsSync(changelogFile,) ? readFileSync(changelogFile, 'utf8',).replace(/^# Changelog\s*\n/, '',) : '';
    writeFileSync(changelogFile, `# Changelog\n\n## ${version} — ${date}\n\n${notes.body.split('\n',).slice(4,).join('\n',)}\n${prevChangelog}`,);

    const indexFile = path.join(ROOT, 'releases.json',);
    const index = existsSync(indexFile,) ? readJson(indexFile,) : { releases: [], };
    index.$comment = 'SiteSurge CMS version index — written by `pnpm release`. npm (@sitesurge/server "latest") is what installs update from; this file and the GitHub Releases are the record.';
    index.repository = `https://github.com/${REPO}`;
    index.npm = PRIMARY;
    index.latest = version;
    index.releases = [
        {
            version,
            tag: TAG,
            date,
            changes: notes.count,
            notes: `https://github.com/${REPO}/releases/tag/${TAG}`,
            packages: pkgs.map((p,) => p.json.name),
        },
        ...(index.releases ?? []).filter((r,) => r.version !== version),
    ];
    writeJson(indexFile, index,);
    console.log(`  latest → ${version} (${notes.count} changes since ${notes.prev ?? 'the start'})`,);

    // ── 5. commit + tag ──
    step(5, `Commit and tag ${TAG}`,);
    if (DRY) {
        console.log(c.y('  dry run — no commit or tag (the bump is reverted at the end).',),);
    } else {
        run('git', ['add', '-A', 'package.json', 'packages', 'CHANGELOG.md', 'releases.json',],);
        run('git', ['commit', '-m', `release: ${TAG}`, '--no-verify',],);
        run('git', ['tag', '-a', TAG, '-m', `SiteSurge CMS ${version}`,],);
    }
}

// ── 6. npm ──
step(6, DRY ? 'npm publish (dry run)' : 'Publish to npm',);
run('pnpm', ['-r', 'publish', '--access', 'public', '--no-git-checks', ...(DRY ? ['--dry-run',] : []),],);

// tarballs for the GitHub Release
const packDir = path.join(ROOT, '.release', TAG,);
mkdirSync(packDir, { recursive: true, },);
for (const p of packages()) {
    run('pnpm', ['pack', '--pack-destination', packDir,], { cwd: path.dirname(p.file,), stdio: ['ignore', 'ignore', 'inherit',], },);
}
const tarballs = readdirSync(packDir,).filter((f,) => f.endsWith('.tgz',)).map((f,) => path.join(packDir, f,));

if (DRY) {
    step(7, 'Push + GitHub Release — skipped (dry run)',);
    if (!resuming) {
        console.log(c.y('  reverting the version bump, changelog and index.',),);
        run('git', ['checkout', '--', '.',],);
        run('git', ['clean', '-fdq', '--', 'CHANGELOG.md', 'releases.json',],);
    }
    console.log(`\n${c.g('✓',)} Dry run complete. ${tarballs.length} package tarballs in ${path.relative(ROOT, packDir,)}.`,);
    console.log(`  Release notes preview (${notes.count} changes):\n${c.d(notes.body.split('\n',).slice(0, 14,).join('\n',),)}\n  …`,);
    process.exit(0,);
}

// ── 7. push ──
step(7, 'Push main and the tag',);
run('git', ['push', 'origin', 'main',],);
run('git', ['push', 'origin', TAG,],);

// ── 8. GitHub Release ──
step(8, `GitHub Release ${TAG}`,);
const exists = tryShell('gh', ['release', 'view', TAG, '-R', REPO,],);
const notesFile = path.join(packDir, 'NOTES.md',);
writeFileSync(notesFile, notes.body,);
if (exists.ok) {
    console.log('  release already exists — uploading any missing assets.',);
    run('gh', ['release', 'upload', TAG, '-R', REPO, '--clobber', ...tarballs,],);
} else {
    run('gh', ['release', 'create', TAG, '-R', REPO, '--title', `SiteSurge CMS ${version}`, '--notes-file', notesFile, '--latest', ...tarballs,],);
}

console.log(`\n${c.g('✓',)} Released ${c.b(TAG,)}`,);
console.log(`  npm:     https://www.npmjs.com/package/${PRIMARY}/v/${version}`,);
console.log(`  GitHub:  https://github.com/${REPO}/releases/tag/${TAG}`,);
console.log(`  Image:   ghcr.io/${REPO.split('/',)[0]}/sitesurge-server:${version} (built by .github/workflows/image.yml)`,);
console.log('  Installs pick it up from Settings → Admin → CMS Version → Check for update.',);
