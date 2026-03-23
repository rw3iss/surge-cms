import crypto from 'crypto';
import { NextFunction, Request, Response, } from 'express';

// Generate CSRF token and set as cookie
export function csrfToken(req: Request, res: Response, next: NextFunction,) {
    if (!req.cookies['csrf-token']) {
        const token = crypto.randomBytes(32,).toString('hex',);
        res.cookie('csrf-token', token, {
            httpOnly: false, // Must be readable by JS
            sameSite: 'strict',
            secure: process.env.NODE_ENV === 'production',
            path: '/',
        },);
    }
    next();
}

// Verify CSRF token on state-changing requests
export function csrfProtection(req: Request, res: Response, next: NextFunction,) {
    // Skip for safe methods
    if (['GET', 'HEAD', 'OPTIONS',].includes(req.method,)) {
        return next();
    }

    // Skip for Stripe webhooks (they have their own signature verification)
    if (req.path.includes('/payments/webhook',)) {
        return next();
    }

    const cookieToken = req.cookies['csrf-token'];
    const headerToken = req.headers['x-csrf-token'];

    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
        return res.status(403,).json({
            success: false,
            error: { code: 'CSRF_ERROR', message: 'Invalid CSRF token', },
        },);
    }

    next();
}
