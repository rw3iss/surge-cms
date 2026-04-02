import { Router, } from 'express';
import { authenticate, requireAdmin, } from '../middleware/auth';
import { cronRegistry, } from '../services/cron';
import { sendSuccess, handleRouteError, } from '../utils/response';

const router = Router();

// GET /dev/crons - List all registered cron jobs
router.get('/crons', authenticate(), requireAdmin, async (_req, res,) => {
    try {
        const jobs = cronRegistry.list();
        sendSuccess(res, jobs,);
    } catch (error) {
        handleRouteError(res, error, 'list cron jobs',);
    }
},);

// GET /dev/crons/:name - Get a specific cron job
router.get('/crons/:name', authenticate(), requireAdmin, async (req, res,) => {
    try {
        const job = cronRegistry.getJob(req.params.name,);
        if (!job) {
            sendSuccess(res, null,);
            return;
        }
        sendSuccess(res, job,);
    } catch (error) {
        handleRouteError(res, error, 'get cron job',);
    }
},);

export default router;
