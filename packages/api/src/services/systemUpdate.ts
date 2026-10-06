/**
 * CMS self-update — report the installed `@sitesurge/server` version, check
 * npm for the latest release, and (on operator request) npm-install the latest
 * distribution packages and restart the process.
 *
 * Assumes an npm-dependency install (the packages live under
 * `<cwd>/node_modules/@sitesurge/*`) running under a process supervisor that
 * relaunches on exit (systemd / pm2 / Docker restart policy). The update runs
 * `npm install <pkg>@latest` for every installed CMS package, then exits so the
 * supervisor restarts with the new build; `bootRunningMode()` applies any new
 * migrations on startup.
 *
 * Surfaced through Settings → Admin → Admin Operations (admin-only).
 *
 * Where versions come from (see docs/PUBLISHING.md):
 *   - npm is the source of truth — `@sitesurge/server`'s `latest` dist-tag is
 *     exactly what `npm install …@latest` installs.
 *   - the GitHub Release for that version (`pnpm release` creates one per
 *     version) supplies the release notes shown in the panel, and stands in
 *     for `latest` only when npm cannot be reached.
 */
import { spawn, } from 'child_process';
import { existsSync, promises as fs, } from 'fs';
import path from 'path';
import { logger, } from '../utils/logger';
import { logAudit, } from './audit';
import type { AuditContext, } from './types';

/** The CMS distribution packages (a Changesets fixed group). Only the ones
 *  actually present in `node_modules` are updated. */
const PRIMARY_PACKAGE = '@sitesurge/server';
const CMS_PACKAGES = ['@sitesurge/server', '@sitesurge/admin', '@sitesurge/cli',];

const NPM_REGISTRY = 'https://registry.npmjs.org';

/** GitHub repository whose Releases carry the notes for each CMS version. */
const RELEASES_REPO = process.env.CMS_RELEASES_REPO || 'rw3iss/surge-cms';

export interface ReleaseInfo {
    tag: string;
    url: string;
    notes: string;
    publishedAt: string | null;
    version: string;
}

/** GitHub's unauthenticated API allows 60 requests/hour per IP — cache. */
const RELEASE_TTL_MS = 10 * 60_000;
const releaseCache = new Map<string, { at: number; value: ReleaseInfo | null; }>();

/** The GitHub Release for a tag (`v1.2.0`), or the latest one (`'latest'`). */
async function fetchRelease(which: string,): Promise<ReleaseInfo | null> {
    const hit = releaseCache.get(which,);
    if (hit && Date.now() - hit.at < RELEASE_TTL_MS) return hit.value;
    let value: ReleaseInfo | null = null;
    try {
        const url = which === 'latest'
            ? `https://api.github.com/repos/${RELEASES_REPO}/releases/latest`
            : `https://api.github.com/repos/${RELEASES_REPO}/releases/tags/${encodeURIComponent(which,)}`;
        const res = await fetch(url, {
            headers: { accept: 'application/vnd.github+json', 'user-agent': 'sitesurge-cms-updater', },
            signal: AbortSignal.timeout(5000,),
        },);
        if (res.ok) {
            const j = await res.json() as { tag_name?: string; html_url?: string; body?: string; published_at?: string; };
            if (j.tag_name) {
                const notes = (j.body ?? '').trim();
                value = {
                    tag: j.tag_name,
                    url: j.html_url ?? `https://github.com/${RELEASES_REPO}/releases/tag/${j.tag_name}`,
                    // The full change list can run long; the panel links out for the rest.
                    notes: notes.length > 6000 ? `${notes.slice(0, 6000,)}\n…` : notes,
                    publishedAt: j.published_at ?? null,
                    version: j.tag_name.replace(/^v/, '',),
                };
            }
        }
    } catch (err) {
        logger.warn(`systemUpdate: GitHub release lookup failed (${which}): ${(err as Error).message}`,);
    }
    releaseCache.set(which, { at: Date.now(), value, },);
    return value;
}

/** Where `node_modules` lives — the process working directory for a normal
 *  npm-dependency install (and the monorepo root in dev). */
function installRoot(): string {
    return process.cwd();
}

/** Read the installed version of a package from its on-disk package.json. */
async function readInstalledVersion(pkg: string,): Promise<string | null> {
    const candidates = [
        path.join(installRoot(), 'node_modules', pkg, 'package.json',),
    ];
    // For the server itself, also fall back to THIS module's own package root
    // (dist/services/systemUpdate.js → ../../package.json) so an oddly-located
    // install still reports its own version.
    if (pkg === PRIMARY_PACKAGE) {
        candidates.push(path.resolve(__dirname, '..', '..', 'package.json',),);
    }
    for (const file of candidates) {
        try {
            const raw = await fs.readFile(file, 'utf8',);
            const json = JSON.parse(raw,) as { name?: string; version?: string; };
            if (json.version) return json.version;
        } catch {
            // try the next candidate
        }
    }
    return null;
}

/** Look up a package's `latest` dist-tag version from the npm registry. */
async function fetchLatestVersion(pkg: string,): Promise<string | null> {
    try {
        const res = await fetch(`${NPM_REGISTRY}/${encodeURIComponent(pkg,)}/latest`, {
            headers: { accept: 'application/vnd.npm.install-v1+json, application/json', },
        },);
        if (!res.ok) return null;
        const json = await res.json() as { version?: string; };
        return json.version ?? null;
    } catch (err) {
        logger.warn(`systemUpdate: npm latest lookup failed for ${pkg}: ${(err as Error).message}`,);
        return null;
    }
}

function parseSemver(v: string,): { nums: number[]; pre: string; } {
    const [core, pre = '',] = v.replace(/^v/, '',).split('-',);
    const nums = core.split('.',).map(n => parseInt(n, 10,) || 0);
    while (nums.length < 3) nums.push(0,);
    return { nums, pre, };
}

/** True when semver `a` is strictly greater than `b`. */
function semverGt(a: string, b: string,): boolean {
    const pa = parseSemver(a,);
    const pb = parseSemver(b,);
    for (let i = 0; i < 3; i++) {
        if (pa.nums[i] !== pb.nums[i]) return pa.nums[i] > pb.nums[i];
    }
    // Equal core: a stable release outranks a prerelease of the same version.
    if (!pa.pre && pb.pre) return true;
    if (pa.pre && !pb.pre) return false;
    return pa.pre > pb.pre;
}

export interface CmsVersionInfo {
    name: string;
    current: string | null;
    latest: string | null;
    updateAvailable: boolean;
    /** True when neither npm nor GitHub could be reached (latest is unknown). */
    latestUnavailable: boolean;
    latestSource: 'npm' | 'github' | null;
    installKind: 'npm' | 'source';
    release: { tag: string; url: string; notes: string; publishedAt: string | null; } | null;
    /** ISO timestamp of this check. */
    checkedAt: string;
}

export async function getVersionInfo(): Promise<CmsVersionInfo> {
    const [current, npmLatest,] = await Promise.all([
        readInstalledVersion(PRIMARY_PACKAGE,),
        fetchLatestVersion(PRIMARY_PACKAGE,),
    ],);
    // Notes for the npm version; with npm unreachable, the latest GitHub
    // Release stands in so the panel can still say what's out there.
    const release = await fetchRelease(npmLatest ? `v${npmLatest}` : 'latest',);
    const latest = npmLatest ?? release?.version ?? null;
    return {
        name: PRIMARY_PACKAGE,
        current,
        latest,
        updateAvailable: Boolean(current && latest && semverGt(latest, current,)),
        latestUnavailable: latest === null,
        latestSource: npmLatest ? 'npm' : release ? 'github' : null,
        installKind: looksLikeDevCheckout() ? 'source' : 'npm',
        release: release ? { tag: release.tag, url: release.url, notes: release.notes, publishedAt: release.publishedAt, } : null,
        checkedAt: new Date().toISOString(),
    };
}

export interface UpdateResult {
    ok: boolean;
    fromVersion: string | null;
    toVersion: string | null;
    /** Packages passed to `npm install …@latest`. */
    updated: string[];
    /** Tail of the combined npm stdout/stderr. */
    output: string;
    /** True when the process will exit shortly for a supervisor restart. */
    restarting: boolean;
}

/** Which CMS packages are actually installed (so we don't ADD ones the
 *  deployment never had). The server is always included. */
async function installedPackages(): Promise<string[]> {
    const present: string[] = [];
    for (const pkg of CMS_PACKAGES) {
        try {
            await fs.access(path.join(installRoot(), 'node_modules', pkg, 'package.json',),);
            present.push(pkg,);
        } catch {
            // not installed here
        }
    }
    if (!present.includes(PRIMARY_PACKAGE,)) present.unshift(PRIMARY_PACKAGE,);
    return present;
}

function tail(s: string, n = 4000,): string {
    return s.length > n ? s.slice(-n,) : s;
}

function runNpmInstall(pkgs: string[],): Promise<{ code: number; output: string; }> {
    return new Promise((resolve,) => {
        const args = ['install', ...pkgs.map(p => `${p}@latest`,), '--no-audit', '--no-fund',];
        const child = spawn('npm', args, { cwd: installRoot(), env: process.env, },);
        let output = '';
        const cap = (buf: Buffer,) => {
            output += buf.toString();
            // Keep memory bounded on very chatty installs.
            if (output.length > 20000) output = output.slice(-20000,);
        };
        child.stdout.on('data', cap,);
        child.stderr.on('data', cap,);
        child.on('error', (err,) => resolve({ code: -1, output: `${output}\nspawn error: ${err.message}`, }),);
        child.on('close', (code,) => resolve({ code: code ?? -1, output, }),);
    },);
}

/** Delay before exit so the HTTP response flushes to the client first. */
const RESTART_DELAY_MS = 1500;

/** Serialize updates — two concurrent `npm install`s in the same tree corrupt
 *  node_modules. Reset only on failure (success exits the process). */
let updateInProgress = false;

/**
 * True when the process appears to be running from the source monorepo rather
 * than an installed package (a dev checkout). Self-update exits the process to
 * hand off to a supervisor; in a dev checkout there's usually no supervisor, so
 * exiting would just kill the server with no relaunch. We refuse to exit there.
 */
function looksLikeDevCheckout(): boolean {
    const root = installRoot();
    return existsSync(path.join(root, 'pnpm-workspace.yaml',),)
        || existsSync(path.join(root, 'packages', 'api', 'src',),);
}

export async function runUpdate(ctx: AuditContext,): Promise<UpdateResult> {
    const fromVersion = await readInstalledVersion(PRIMARY_PACKAGE,);

    // A source checkout is not updated by npm: installing @sitesurge/* into the
    // monorepo would shadow its own workspace packages. It updates by pulling
    // the release tag and rebuilding (docs/PUBLISHING.md).
    if (looksLikeDevCheckout()) {
        return {
            ok: false,
            fromVersion,
            toVersion: fromVersion,
            updated: [],
            output: 'This installation runs from a source checkout. Update it by pulling the release tag '
                + '(git fetch --tags && git checkout vX.Y.Z), then rebuild and restart — or your deploy script. '
                + 'One-click updates are for npm installs.',
            restarting: false,
        };
    }

    // Guard: don't reinstall/restart when already on the latest published
    // version (the panel disables the button, but the endpoint is unguarded).
    // Skip the guard when npm was unreachable (latest unknown → allow).
    const info = await getVersionInfo();
    if (!info.updateAvailable && !info.latestUnavailable) {
        return {
            ok: true,
            fromVersion,
            toVersion: fromVersion,
            updated: [],
            output: `Already up to date (${fromVersion ?? 'unknown'}).`,
            restarting: false,
        };
    }

    // Guard: one update at a time.
    if (updateInProgress) {
        return {
            ok: false,
            fromVersion,
            toVersion: fromVersion,
            updated: [],
            output: 'An update is already in progress.',
            restarting: false,
        };
    }
    updateInProgress = true;

    const pkgs = await installedPackages();
    logger.info(
        `systemUpdate: installing ${pkgs.map(p => `${p}@latest`,).join(', ',)} in ${installRoot()}`,
    );

    const { code, output, } = await runNpmInstall(pkgs,);
    if (code !== 0) {
        updateInProgress = false;
        logger.error(`systemUpdate: npm install failed (exit ${code})`,);
        await logAudit({
            userId: ctx.userId,
            action: 'cms-update-failed',
            entityType: 'settings',
            entityId: 'cms_update',
            newValues: { fromVersion, code, },
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
        },);
        return { ok: false, fromVersion, toVersion: fromVersion, updated: pkgs, output: tail(output,), restarting: false, };
    }

    const toVersion = await readInstalledVersion(PRIMARY_PACKAGE,);
    await logAudit({
        userId: ctx.userId,
        action: 'cms-update',
        entityType: 'settings',
        entityId: 'cms_update',
        newValues: { fromVersion, toVersion, packages: pkgs, },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);

    logger.info(`systemUpdate: updated ${fromVersion} → ${toVersion}; exiting in ${RESTART_DELAY_MS}ms for restart`,);
    // Exit shortly after we return so the response flushes; the supervisor
    // relaunches with the new build and migrations apply on boot.
    setTimeout(() => {
        logger.info('systemUpdate: exiting now for supervisor restart',);
        process.exit(0,);
    }, RESTART_DELAY_MS,);

    return { ok: true, fromVersion, toVersion, updated: pkgs, output: tail(output,), restarting: true, };
}
