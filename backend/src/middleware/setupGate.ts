import type { NextFunction, Request, Response, } from 'express';
import { shouldBlockRequest, } from '../http/policies/setupGate';
import { getInstallationState, peekInstallationState, } from '../services/installation';

/**
 * Express adapter for the setup-gate policy. Reads installation state
 * (cached, async) and delegates the decision to the pure policy
 * function. When porting to another framework, this file is the only
 * one that needs to change.
 */
export async function setupGate(
    req: Request,
    res: Response,
    next: NextFunction,
): Promise<void> {
    let state = peekInstallationState();
    if (!state) state = await getInstallationState();

    const decision = shouldBlockRequest(state, req.path,);
    if (!decision.block) return next();

    res.status(503,).json(decision.body,);
}
