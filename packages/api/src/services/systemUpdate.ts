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
 */
import { spawn, } from 'child_process';
import { promises as fs, } from 'fs';
import path from 'path';
import { logger, } from '../utils/logger';
import { logAudit, } from './audit';
import type { AuditContext, } from './types';

/** The CMS distribution packages (a Changesets fixed group). Only the ones
 *  actually present in `node_modules` are updated. */
const PRIMARY_PACKAGE = '@sitesurge/server';
const CMS_PACKAGES = ['@sitesurge/server', '@sitesurge/admin', '@sitesurge/cli',];

const NPM_REGISTRY = 'https://registry.npmjs.org';

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
    /** True when the npm registry couldn't be reached (latest is unknown). */
    latestUnavailable: boolean;
    /** ISO timestamp of this check. */
    checkedAt: string;
}

export async function getVersionInfo(): Promise<CmsVersionInfo> {
    const [current, latest,] = await Promise.all([
        readInstalledVersion(PRIMARY_PACKAGE,),
        fetchLatestVersion(PRIMARY_PACKAGE,),
    ],);
    return {
        name: PRIMARY_PACKAGE,
        current,
        latest,
        updateAvailable: Boolean(current && latest && semverGt(latest, current,)),
        latestUnavailable: latest === null,
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

export async function runUpdate(ctx: AuditContext,): Promise<UpdateResult> {
    const fromVersion = await readInstalledVersion(PRIMARY_PACKAGE,);
    const pkgs = await installedPackages();
    logger.info(
        `systemUpdate: installing ${pkgs.map(p => `${p}@latest`,).join(', ',)} in ${installRoot()}`,
    );

    const { code, output, } = await runNpmInstall(pkgs,);
    if (code !== 0) {
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
