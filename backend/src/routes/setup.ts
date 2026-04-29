import crypto from 'crypto';
import { Request, Response, Router, } from 'express';
import { AlreadyInstalledError, AppError, ValidationError, } from '../core/errors';
import { getInstallationState, } from '../services/installation';
import { transitionToRunning, } from '../services/lifecycle';
import {
    postgresTester,
    redisTester,
    runInstallation,
    s3Tester,
    smtpTester,
} from '../services/setup';
import type {
    PostgresTesterInput,
    RedisTesterInput,
    S3TesterInput,
    SmtpTesterInput,
} from '../services/setup';
import { logger, } from '../utils/logger';

/**
 * Thin HTTP adapter for the setup pipeline. Each handler is one line of
 * "parse request → call service → format response"; all business logic
 * lives in `services/setup/`. When migrating to Fastify, this file is
 * the only one that needs to be re-written.
 *
 * All endpoints reject when the instance is already installed (except
 * GET /status, which always responds — the frontend uses it to decide
 * whether to redirect to /setup at all).
 */

const router = Router();

router.get('/status', async (_req, res,) => {
    const state = await getInstallationState();
    res.json({ success: true, data: state, },);
},);

async function ensureSetupAllowed(): Promise<void> {
    const state = await getInstallationState();
    if (!state.needsSetup) throw new AlreadyInstalledError();
}

router.post('/test-db', async (req: Request, res: Response,) => {
    await ensureSetupAllowed();
    const input = req.body as PostgresTesterInput;
    const result = await postgresTester.test(input,);
    res.json({ success: true, data: result, },);
},);

router.post('/test-redis', async (req: Request, res: Response,) => {
    await ensureSetupAllowed();
    const input = req.body as RedisTesterInput;
    const result = await redisTester.test(input,);
    res.json({ success: true, data: result, },);
},);

router.post('/test-smtp', async (req: Request, res: Response,) => {
    await ensureSetupAllowed();
    const input = req.body as SmtpTesterInput;
    const result = await smtpTester.test(input,);
    res.json({ success: true, data: result, },);
},);

router.post('/test-s3', async (req: Request, res: Response,) => {
    await ensureSetupAllowed();
    const input = req.body as S3TesterInput;
    const result = await s3Tester.test(input,);
    res.json({ success: true, data: result, },);
},);

router.post('/generate-jwt', async (_req, res,) => {
    await ensureSetupAllowed();
    res.json({
        success: true,
        data: { secret: crypto.randomBytes(48,).toString('base64url',), },
    },);
},);

router.post('/install', async (req: Request, res: Response,) => {
    await ensureSetupAllowed();
    try {
        const result = await runInstallation(req.body,);
        // Send the success response BEFORE triggering restart, otherwise
        // the client never sees ok:true.
        res.json({ success: true, data: result, },);
        // Fire-and-forget: process exits after a short delay so the
        // supervisor restarts us with the freshly-written .env.
        setImmediate(() => {
            transitionToRunning().catch((err,) => {
                logger.error('transitionToRunning failed', { error: (err as Error).message, },);
            },);
        },);
    } catch (error) {
        if (error instanceof ValidationError) {
            const details = (error.details as { errors: unknown[]; stage?: string; }) || {};
            return res.status(400,).json({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: error.message, details, },
            },);
        }
        if (error instanceof AppError) {
            return res.status(error.statusCode,).json({
                success: false,
                error: { code: error.code, message: error.message, details: error.details, },
            },);
        }
        logger.error('Install error', { error: (error as Error).message, },);
        res.status(500,).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: 'Installation failed unexpectedly', },
        },);
    }
},);

export default router;
