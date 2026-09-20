/**
 * Scheduled sends — "mail this template to this list at this time, this often".
 *
 * WHY A DATABASE CURSOR AND NOT TIMERS
 *
 * The job system is node-cron, which holds tasks in process memory. A timer per
 * schedule dies with the process, so a restart or a deploy would silently
 * un-schedule everything and nobody would find out until a newsletter failed to
 * arrive. Instead each row owns its own `next_run_at`, and ONE cron job sweeps
 * for whatever is due. Restarting costs nothing, because the schedule was never
 * in memory to lose.
 *
 * It also makes a missed window recoverable rather than skipped: a server down
 * at 09:00 fires when it comes back.
 *
 * WHY POSTGRES COMPUTES THE NEXT RUN
 *
 * "09:00 in America/New_York" is a wall-clock time, not an offset. Across a
 * daylight-saving boundary the correct UTC instant shifts by an hour, and doing
 * that arithmetic in JavaScript means hand-rolling zone offsets. Postgres
 * already carries the IANA database, so `AT TIME ZONE` gets it right for every
 * zone and every transition — see `computeNextRun`.
 *
 * CATCH-UP POLICY: a daily schedule that missed three days sends ONCE, not
 * three times. The next run is always the first occurrence strictly after now,
 * so an outage never turns into a burst of duplicate mail.
 */
import { query, } from '../db';
import { logger, } from '../utils/logger';
import { NotFoundError, ValidationError, } from '../core/errors';
import { mapRow, } from '../utils/mapRow';
import { logAudit, } from './audit';
import type { AuditContext, } from './types';
import * as mailSend from './mailSend';
import * as mailTemplates from './mailTemplates';
import { getPublicSettings, } from './settings';

export type MailScheduleFrequency = 'once' | 'daily' | 'weekly' | 'monthly' | 'yearly';

/** Fallback zone when the site has no configured default. */
const DEFAULT_TIMEZONE = 'America/New_York';

/**
 * How far ahead to look for the next occurrence.
 *
 * Bounded so a corrupt row cannot spin forever. 400 covers a year of daily
 * runs; for weekly/monthly/yearly the step is larger, so the reach is longer
 * still — comfortably past any real schedule.
 */
const MAX_LOOKAHEAD_STEPS = 400;

export interface MailScheduleInput {
    name: string;
    listId: string;
    templateId?: string | null;
    subject?: string | null;
    preheader?: string | null;
    fromName?: string | null;
    fromEmail?: string | null;
    replyTo?: string | null;
    blocks?: unknown[] | null;
    frequency: MailScheduleFrequency;
    timeOfDay: string;
    timezone?: string | null;
    startDate: string;
    enabled?: boolean;
}

/** The site's authoring timezone, or the documented fallback. */
export async function defaultTimezone(): Promise<string> {
    try {
        // The public projection is where `defaults` lives (it is published so
        // admin authoring forms can pre-fill from it).
        const s = await getPublicSettings();
        const tz = s?.defaults?.timezone;
        return tz && isValidTimezone(tz,) ? tz : DEFAULT_TIMEZONE;
    } catch {
        return DEFAULT_TIMEZONE;
    }
}

/**
 * Is this a zone Postgres will accept?
 *
 * Checked in the app rather than letting the INSERT fail: an unknown zone
 * raises a runtime error inside `AT TIME ZONE`, which would surface as an
 * opaque 500 from whichever query happened to touch it next — possibly the
 * sweeper, long after the operator typed it.
 */
export function isValidTimezone(tz: string,): boolean {
    try {
        // Constructed for its side effect: the constructor throws a RangeError
        // for an unknown zone, which is the only cheap way to ask whether one
        // is valid. The result is deliberately unused.
        const probe = new Intl.DateTimeFormat('en-US', { timeZone: tz, },);
        return Boolean(probe,);
    } catch {
        return false;
    }
}

/** `HH:MM` or `HH:MM:SS`. */
export function isValidTimeOfDay(v: string,): boolean {
    return /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(v,);
}

/**
 * The first occurrence strictly after `after` (default: now).
 *
 * `generate_series` enumerates candidate local dates from `start_date`, each is
 * combined with the wall-clock time and converted out of the schedule's zone,
 * and the first one past the cutoff wins. Expressing it as one query keeps the
 * zone arithmetic — including DST transitions — inside Postgres.
 *
 * Returns null when the recurrence is exhausted: a `once` schedule whose date
 * has passed, or a recurring one whose lookahead found nothing.
 */
export async function computeNextRun(
    opts: {
        frequency: MailScheduleFrequency;
        startDate: string;
        timeOfDay: string;
        timezone: string;
        after?: Date;
    },
): Promise<Date | null> {
    const { frequency, startDate, timeOfDay, timezone, } = opts;
    const after = opts.after ?? new Date();

    if (frequency === 'once') {
        const r = await query<{ ts: Date; }>(
            `SELECT (($1::date + $2::time) AT TIME ZONE $3) AS ts`,
            [startDate, timeOfDay, timezone,],
        );
        const ts = r.rows[0]?.ts ?? null;
        // A one-off in the past is not rescheduled — it simply never runs
        // again. Firing it late would mail a dated announcement after the fact.
        return ts && ts.getTime() > after.getTime() ? ts : null;
    }

    // `step` is the interval between occurrences; `n` starts at 0 so the start
    // date itself is a candidate (a schedule created for 09:00 today should run
    // today, not tomorrow).
    const step: Record<Exclude<MailScheduleFrequency, 'once'>, string> = {
        daily: '1 day',
        weekly: '1 week',
        monthly: '1 month',
        yearly: '1 year',
    };

    const r = await query<{ ts: Date; }>(
        `SELECT ts FROM (
             SELECT (($1::date + (n * $2::interval) + $3::time) AT TIME ZONE $4) AS ts
             FROM generate_series(0, $5::int) AS n
         ) s
         WHERE ts > $6::timestamptz
         ORDER BY ts
         LIMIT 1`,
        [startDate, step[frequency], timeOfDay, timezone, MAX_LOOKAHEAD_STEPS, after.toISOString(),],
    );
    return r.rows[0]?.ts ?? null;
}

const SELECT_COLUMNS = `
    s.id, s.name, s.list_id, s.template_id,
    s.subject, s.preheader, s.from_name, s.from_email, s.reply_to, s.blocks,
    s.frequency, s.time_of_day, s.timezone,
    -- As TEXT, not DATE. The pg driver turns a DATE into a JS Date at the
    -- server's local midnight, so serialising it to ISO can roll the day
    -- backwards for a server east of UTC — the edit form would then show the
    -- day before the one that was saved.
    to_char(s.start_date, 'YYYY-MM-DD') AS start_date,
    s.enabled,
    s.next_run_at, s.last_run_at, s.last_status, s.last_error, s.last_job_id,
    s.run_count, s.created_at, s.updated_at,
    l.name AS list_name,
    t.name AS template_name`;

const FROM_JOINS = `
    FROM mail_schedules s
    JOIN mailing_lists l ON l.id = s.list_id
    LEFT JOIN mail_templates t ON t.id = s.template_id`;

export async function list() {
    const r = await query(
        `SELECT ${SELECT_COLUMNS} ${FROM_JOINS} ORDER BY s.enabled DESC, s.next_run_at NULLS LAST, s.created_at DESC`,
    );
    return r.rows.map(mapRow,);
}

export async function getById(id: string,) {
    const r = await query(`SELECT ${SELECT_COLUMNS} ${FROM_JOINS} WHERE s.id = $1`, [id,],);
    if (!r.rows[0]) throw new NotFoundError('Schedule',);
    return mapRow(r.rows[0],);
}

/** Shared validation for create + update. */
async function normalize(input: MailScheduleInput,): Promise<MailScheduleInput & { timezone: string; }> {
    if (!input.name?.trim()) throw new ValidationError('A name is required',);
    if (!input.listId) throw new ValidationError('A list is required',);
    if (!input.templateId && !(input.blocks && input.blocks.length)) {
        throw new ValidationError('Pick a template, or supply content to send',);
    }
    if (!isValidTimeOfDay(input.timeOfDay,)) {
        throw new ValidationError('Time must be HH:MM (24-hour)',);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate,)) {
        throw new ValidationError('Start date must be YYYY-MM-DD',);
    }
    const timezone = input.timezone || await defaultTimezone();
    if (!isValidTimezone(timezone,)) throw new ValidationError(`Unknown timezone: ${timezone}`,);
    return { ...input, timezone, };
}

export async function create(input: MailScheduleInput, ctx: AuditContext,) {
    const v = await normalize(input,);
    const nextRun = v.enabled === false
        ? null
        : await computeNextRun({
            frequency: v.frequency, startDate: v.startDate,
            timeOfDay: v.timeOfDay, timezone: v.timezone,
        },);

    const r = await query<{ id: string; }>(
        `INSERT INTO mail_schedules
            (name, list_id, template_id, subject, preheader, from_name, from_email, reply_to,
             blocks, frequency, time_of_day, timezone, start_date, enabled, next_run_at, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         RETURNING id`,
        [
            v.name.trim(), v.listId, v.templateId || null,
            v.subject || null, v.preheader || null, v.fromName || null,
            v.fromEmail || null, v.replyTo || null,
            v.blocks ? JSON.stringify(v.blocks,) : null,
            v.frequency, v.timeOfDay, v.timezone, v.startDate,
            v.enabled !== false, nextRun, uuidOrNull(ctx.userId,),
        ],
    );
    await logAudit({ ...ctx, action: 'create', entityType: 'mail_schedule', entityId: r.rows[0].id, },);
    return getById(r.rows[0].id,);
}

export async function update(id: string, input: MailScheduleInput, ctx: AuditContext,) {
    const existing = await getById(id,) as { enabled: boolean; };
    const v = await normalize(input,);
    const enabled = v.enabled ?? existing.enabled;
    // Recomputed on every update: changing the time, frequency, zone or start
    // date must move the cursor, or the edit would not take effect until after
    // one more run at the OLD time.
    const nextRun = enabled
        ? await computeNextRun({
            frequency: v.frequency, startDate: v.startDate,
            timeOfDay: v.timeOfDay, timezone: v.timezone,
        },)
        : null;

    await query(
        `UPDATE mail_schedules SET
            name=$2, list_id=$3, template_id=$4, subject=$5, preheader=$6,
            from_name=$7, from_email=$8, reply_to=$9, blocks=$10,
            frequency=$11, time_of_day=$12, timezone=$13, start_date=$14,
            enabled=$15, next_run_at=$16
         WHERE id=$1`,
        [
            id, v.name.trim(), v.listId, v.templateId || null,
            v.subject || null, v.preheader || null, v.fromName || null,
            v.fromEmail || null, v.replyTo || null,
            v.blocks ? JSON.stringify(v.blocks,) : null,
            v.frequency, v.timeOfDay, v.timezone, v.startDate, enabled, nextRun,
        ],
    );
    await logAudit({ ...ctx, action: 'update', entityType: 'mail_schedule', entityId: id, },);
    return getById(id,);
}

/** Pause or resume. Resuming recomputes the cursor from now. */
export async function setEnabled(id: string, enabled: boolean, ctx: AuditContext,) {
    const s = await getById(id,) as {
        frequency: MailScheduleFrequency; startDate: string;
        timeOfDay: string; timezone: string;
    };
    const nextRun = enabled
        ? await computeNextRun({
            frequency: s.frequency,
            startDate: toDateString(s.startDate as unknown as Date | string,),
            timeOfDay: String(s.timeOfDay,),
            timezone: s.timezone,
        },)
        : null;
    await query(`UPDATE mail_schedules SET enabled=$2, next_run_at=$3 WHERE id=$1`, [id, enabled, nextRun,],);
    await logAudit({ ...ctx, action: enabled ? 'enable' : 'disable', entityType: 'mail_schedule', entityId: id, },);
    return getById(id,);
}

export async function remove(id: string, ctx: AuditContext,): Promise<void> {
    const r = await query(`DELETE FROM mail_schedules WHERE id=$1 RETURNING id`, [id,],);
    if (!r.rows[0]) throw new NotFoundError('Schedule',);
    await logAudit({ ...ctx, action: 'delete', entityType: 'mail_schedule', entityId: id, },);
}

interface DueRow {
    id: string;
    name: string;
    list_id: string;
    template_id: string | null;
    subject: string | null;
    preheader: string | null;
    from_name: string | null;
    from_email: string | null;
    reply_to: string | null;
    blocks: unknown[] | null;
    frequency: MailScheduleFrequency;
    time_of_day: string;
    timezone: string;
    start_date: Date;
}

/**
 * Claim everything due, atomically.
 *
 * `FOR UPDATE SKIP LOCKED` + clearing `next_run_at` in the same statement is
 * what makes a send happen once. Crons are primary-only today, but a second
 * process (a rolling deploy overlapping by a second, or a future multi-node
 * setup) would otherwise both see the same due row and mail the list twice —
 * the one failure mode a scheduler must not have.
 */
async function claimDue(limit = 25,): Promise<DueRow[]> {
    const r = await query<DueRow>(
        `UPDATE mail_schedules SET next_run_at = NULL, last_run_at = NOW()
          WHERE id IN (
              SELECT id FROM mail_schedules
               WHERE enabled AND next_run_at IS NOT NULL AND next_run_at <= NOW()
               ORDER BY next_run_at
               FOR UPDATE SKIP LOCKED
               LIMIT $1
          )
      RETURNING id, name, list_id, template_id, subject, preheader, from_name,
                from_email, reply_to, blocks, frequency, time_of_day, timezone, start_date`,
        [limit,],
    );
    return r.rows;
}

/** Record the outcome and set the cursor for the next occurrence. */
async function finish(
    row: DueRow,
    status: 'sent' | 'failed' | 'skipped',
    detail: { jobId?: string; error?: string; },
): Promise<void> {
    // Always recomputed, even after a failure: one bad send must not silently
    // end a recurring schedule. The error is recorded and the next run still
    // gets a cursor, so a transient outage self-heals.
    const nextRun = await computeNextRun({
        frequency: row.frequency,
        startDate: toDateString(row.start_date,),
        timeOfDay: String(row.time_of_day,),
        timezone: row.timezone,
    },);

    await query(
        `UPDATE mail_schedules
            SET next_run_at = $2,
                last_status = $3,
                last_error = $4,
                last_job_id = $5,
                run_count = run_count + 1,
                -- A 'once' schedule has nothing further to do; pausing it keeps
                -- it visible in the admin as a record of what was sent, rather
                -- than leaving an enabled row that will never fire again.
                enabled = CASE WHEN $2::timestamptz IS NULL THEN false ELSE enabled END
          WHERE id = $1`,
        [row.id, nextRun, status, detail.error ?? null, detail.jobId ?? null,],
    );
}

/**
 * Send one due schedule through the ORDINARY campaign pipeline.
 *
 * Deliberately `mailSend.send` rather than mailing subscribers directly: that
 * is what gives a scheduled send the same batching, retry, RFC 8058
 * unsubscribe headers and resume-after-restart as a hand-composed one. A
 * scheduler that grew its own delivery path would drift from the real one.
 */
async function runOne(row: DueRow,): Promise<void> {
    // A synthetic actor, like the other background writers. `logAudit` folds a
    // non-UUID userId into new_values.actor rather than the FK column.
    const ctx: AuditContext = { userId: `schedule:${row.name}`, userAgent: 'mail-scheduler', };

    try {
        let blocks = row.blocks as { blockType: string; position: number; settings?: unknown; }[] | null;
        let subject = row.subject ?? '';
        let preheader = row.preheader ?? undefined;
        let fromName = row.from_name ?? undefined;
        let fromEmail = row.from_email ?? undefined;
        let replyTo = row.reply_to ?? undefined;

        // No custom body → resolve the template AT SEND TIME, so edits to the
        // template reach the next scheduled send. That is the point of
        // scheduling a template rather than a snapshot of one.
        if (!blocks || blocks.length === 0) {
            if (!row.template_id) {
                await finish(row, 'skipped', { error: 'No template and no content', },);
                logger.warn(`Mail schedule "${row.name}" skipped: no template or content`,);
                return;
            }
            const tpl = await mailTemplates.getById(row.template_id,) as {
                name?: string; subject?: string; preheader?: string;
                fromName?: string; fromEmail?: string; replyTo?: string;
                blocks?: { blockType: string; position: number; settings?: unknown; }[];
            } | null;
            if (!tpl) {
                await finish(row, 'skipped', { error: 'Template no longer exists', },);
                logger.warn(`Mail schedule "${row.name}" skipped: template ${row.template_id} is gone`,);
                return;
            }
            blocks = tpl.blocks ?? [];
            // Per-schedule overrides win; anything unset falls back to the
            // template's own value.
            subject = subject || tpl.subject || tpl.name || 'Newsletter';
            preheader = preheader ?? tpl.preheader;
            fromName = fromName ?? tpl.fromName;
            fromEmail = fromEmail ?? tpl.fromEmail;
            replyTo = replyTo ?? tpl.replyTo;
        }

        if (!subject) subject = row.name;

        const { jobId, total, } = await mailSend.send({
            listId: row.list_id,
            templateId: row.template_id,
            subject,
            preheader,
            fromName,
            fromEmail,
            replyTo,
            blocks: blocks as never,
        }, ctx,);

        await finish(row, 'sent', { jobId, },);
        logger.info(`Mail schedule "${row.name}" sent`, { scheduleId: row.id, jobId, recipients: total, },);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err,);
        await finish(row, 'failed', { error: message, },);
        // Logged, not rethrown: one broken schedule must not abort the sweep
        // and strand every other schedule that is also due.
        logger.error(`Mail schedule "${row.name}" failed`, { scheduleId: row.id, error: message, },);
    }
}

/**
 * The sweeper. Registered as a single cron job; see `initMailScheduleCron`.
 *
 * Exported for tests and for a manual "run now" path.
 */
export async function runDueSchedules(): Promise<{ claimed: number; }> {
    const due = await claimDue();
    if (due.length === 0) return { claimed: 0, };
    logger.info(`Mail scheduler: ${due.length} schedule(s) due`,);
    // Sequential on purpose: each one expands a recipient list and starts a
    // send worker, and firing several at once would spike SMTP concurrency
    // beyond what the send worker's own limits expect.
    for (const row of due) await runOne(row,);
    return { claimed: due.length, };
}

/**
 * A DATE column as `YYYY-MM-DD`, however the driver handed it over.
 *
 * `toISOString()` on a Date is UTC, and the driver builds that Date at the
 * SERVER's local midnight — so for a server east of UTC the ISO form is the
 * previous day, and the schedule would drift a day earlier on every write.
 * Formatting from the local parts avoids the conversion entirely.
 */
function toDateString(v: Date | string,): string {
    if (typeof v === 'string') return v.slice(0, 10,);
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0',);
    const d = String(v.getDate()).padStart(2, '0',);
    return `${y}-${m}-${d}`;
}

/** Local helper — non-UUID audit actors (`schedule:*`) must not break the FK. */
function uuidOrNull(v: string | null | undefined,): string | null {
    if (!v) return null;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v,) ? v : null;
}
