/**
 * The one send path for every email the CMS sends on its own behalf.
 *
 * A feature calls `sendPurposeMail('user_password_reset', { to, context })` and
 * this decides the rest: whether the operator has it enabled, whether they've
 * replaced the body, which variables resolve, and how it renders. Features stop
 * owning HTML, and every purpose gains a toggle and a block editor for free.
 *
 * ## Enabled-by-default is deliberate
 *
 * An unconfigured purpose falls back to `defaultEnabled` from the registry,
 * which is `true` for every email the system already sent. Introducing this
 * layer must not silently stop mail an operator depends on — a password reset
 * that quietly doesn't send is worse than one that looks ugly.
 *
 * ## Never throws
 *
 * Like `notify()`, a send failure is logged and swallowed. These fire from the
 * middle of registration, checkout and form submission; an SMTP outage must not
 * roll back an order. Callers that genuinely need to know get the boolean.
 */
import type { FlatBlock, } from './renderer';
import { mailPurpose, type MailPurposeConfig, type MailPurposeSettings, } from '@sitesurge/types';
import { getMailPurposes, getUsersSettings, } from '../settings';
import { logger, } from '../../utils/logger';
import { sendEmail, } from '../email';
import { loadMailRenderContext, } from './siteContext';

// The renderer, the `{{ }}` engine and the default bodies are imported LAZILY.
// They pull in the whole template runtime (which reaches the media service and
// its config), and every feature that merely *sends* would otherwise drag that
// entire graph in at module load — which broke unit tests that import a mailer
// without booting config. Loading them at send time keeps the import surface
// honest: you only pay for the renderer when you actually render.
type RenderStandaloneMail = typeof import('./transactional')['renderStandaloneMail'];
type ResolveMailTemplate = typeof import('./templateRuntime')['resolveMailTemplate'];
type DefaultPurposeHtml = typeof import('./purposeDefaults')['defaultPurposeHtml'];

async function renderers(): Promise<{
    renderStandaloneMail: RenderStandaloneMail;
    resolveMailTemplate: ResolveMailTemplate;
    defaultPurposeHtml: DefaultPurposeHtml;
}> {
    const [transactional, templateRuntime, purposeDefaults,] = await Promise.all([
        import('./transactional.js'),
        import('./templateRuntime.js'),
        import('./purposeDefaults.js'),
    ],);
    return {
        renderStandaloneMail: transactional.renderStandaloneMail,
        resolveMailTemplate: templateRuntime.resolveMailTemplate,
        defaultPurposeHtml: purposeDefaults.defaultPurposeHtml,
    };
}

/** The whole `mail_purposes` settings row (empty when never configured). */
export async function getMailPurposeSettings(): Promise<MailPurposeSettings> {
    return (await getMailPurposes() as MailPurposeSettings | null) ?? {};
}

/** Operator config for one purpose, merged over the registry defaults. */
export async function getPurposeConfig(key: string,): Promise<MailPurposeConfig & { enabled: boolean; autoSend: boolean; }> {
    const meta = mailPurpose(key,);
    const all = await getMailPurposeSettings();
    let cfg = all[key] ?? {};

    // The verification email predates this registry and lived in
    // `users_settings.verificationEmail`. Fall back to it when the new location
    // is empty, so upgrading doesn't silently revert an operator's customised
    // template to the built-in default. Saving from the admin migrates it.
    if (key === 'user_verification' && !cfg.blocks?.length && !cfg.subject) {
        const legacy = await getUsersSettings();
        const blocks = (legacy.verificationEmail?.blocks ?? []) as unknown[];
        const subject = legacy.verificationEmail?.subject ?? '';
        if (blocks.length > 0 || subject) cfg = { ...cfg, blocks, subject, };
    }
    return {
        ...cfg,
        enabled: cfg.enabled ?? meta?.defaultEnabled ?? false,
        // autoSend is opt-IN — a purpose that supports it defaults to off.
        autoSend: cfg.autoSend ?? false,
    };
}

export interface SendPurposeMailInput {
    /** Recipient address, or several. Each gets its own message. */
    to: string | string[];
    /** Variables for the `{{ }}` engine. `site` is merged in automatically. */
    context?: Record<string, unknown>;
    /** Send even when the operator has the purpose disabled. */
    force?: boolean;
    /**
     * Body to use when the operator hasn't written their own, INSTEAD of the
     * registry's generic default.
     *
     * This exists because some features already build a far better default than
     * a registry entry could — the shop's order emails render a real line-item
     * table with per-supplier groups and totals. Forcing those through a generic
     * default would be a downgrade dressed up as consolidation. The operator
     * still gets the toggle and can still replace the body with blocks; they
     * just get a good starting point when they don't.
     */
    defaultHtml?: string;
    /** Subject to use when the operator hasn't set one; overrides the registry. */
    defaultSubject?: string;
    fromName?: string;
    fromEmail?: string;
    replyTo?: string;
}

/**
 * Render and send one purpose. Returns true when at least one message was
 * handed to the transport, false when disabled, unaddressed or failed.
 */
export async function sendPurposeMail(key: string, input: SendPurposeMailInput,): Promise<boolean> {
    try {
        const meta = mailPurpose(key,);
        if (!meta) {
            // A typo'd key must fail loudly in the log rather than silently not
            // sending — there is no legitimate caller for an unknown purpose.
            logger.error('sendPurposeMail: unknown purpose', { key, },);
            return false;
        }

        const cfg = await getPurposeConfig(key,);
        if (!cfg.enabled && !input.force) {
            logger.info('Purpose email skipped (disabled)', { key, },);
            return false;
        }

        const recipients = (Array.isArray(input.to,) ? input.to : [input.to,])
            .map((t,) => t.trim())
            .filter(Boolean,);
        if (recipients.length === 0) {
            logger.warn('Purpose email has no recipients', { key, },);
            return false;
        }

        const site = await loadMailRenderContext();
        const { renderStandaloneMail, resolveMailTemplate, defaultPurposeHtml, } = await renderers();
        const context: Record<string, unknown> = {
            site: { name: site.siteName, url: site.siteUrl, },
            ...input.context,
        };

        const subjectTpl = cfg.subject?.trim() || input.defaultSubject || meta.defaultSubject;
        const blocks = (cfg.blocks ?? []) as FlatBlock[];

        let subject: string;
        let html: string;
        if (blocks.length > 0) {
            // Operator-authored body: same renderer + engine as campaigns.
            const rendered = await renderStandaloneMail({ subject: subjectTpl, blocks, }, context,);
            subject = rendered.subject;
            html = rendered.html;
        } else {
            // Built-in default. The subject still runs through the engine so
            // `{{site.name}}` works even when the body is untouched.
            subject = await resolveMailTemplate(subjectTpl, context,);
            html = input.defaultHtml
                ? await resolveMailTemplate(input.defaultHtml, context,)
                : await defaultPurposeHtml(key, context, site,);
        }

        // One message per recipient — no shared To: header, so a single bad
        // address can't sink the rest (same rule as the form-action mailer).
        for (const to of recipients) {
            await sendEmail({
                to,
                subject,
                html,
                fromName: input.fromName,
                fromEmail: input.fromEmail,
                replyTo: input.replyTo,
            },);
        }
        logger.info('Purpose email sent', {
            key, count: recipients.length, custom: blocks.length > 0,
        },);
        return true;
    } catch (err) {
        logger.error('sendPurposeMail failed', { key, error: err, },);
        return false;
    }
}
