import type { NextFunction, Request, Response } from 'express';
import { RateLimitBucket, RateLimitOptions } from './types/rate-limit.types';

export type { RateLimitOptions } from './types/rate-limit.types';

function isProduction(): boolean {
    return process.env['NODE_ENV'] === 'production';
}

/** In-memory лимит по IP; в dev отключён, чтобы не мешать локальной отладке. */
export function createJoinRateLimiter(options: RateLimitOptions) {
    if (!isProduction()) {
        return (_req: Request, _res: Response, next: NextFunction): void => {
            next();
        };
    }

    const buckets = new Map<string, RateLimitBucket>();

    return (req: Request, res: Response, next: NextFunction): void => {
        const key = req.ip || req.socket.remoteAddress || 'unknown';
        const now = Date.now();
        const bucket = buckets.get(key);

        if (!bucket || bucket.resetAt <= now) {
            buckets.set(key, { count: 1, resetAt: now + options.windowMs });
            next();
            return;
        }

        if (bucket.count >= options.max) {
            res.status(429).json({ error: options.message });
            return;
        }

        bucket.count += 1;
        next();
    };
}

/** @internal — для unit-тестов и createRateLimiter. */
export function createRateLimiter(options: RateLimitOptions) {
    const buckets = new Map<string, RateLimitBucket>();

    return (req: Request, res: Response, next: NextFunction): void => {
        const key = req.ip || req.socket.remoteAddress || 'unknown';
        const now = Date.now();
        const bucket = buckets.get(key);

        if (!bucket || bucket.resetAt <= now) {
            buckets.set(key, { count: 1, resetAt: now + options.windowMs });
            next();
            return;
        }

        if (bucket.count >= options.max) {
            res.status(429).json({ error: options.message });
            return;
        }

        bucket.count += 1;
        next();
    };
}
