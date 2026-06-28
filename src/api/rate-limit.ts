import type { NextFunction, Request, Response } from 'express';
import { RateLimitBucket, RateLimitOptions } from './types/rate-limit.types';

export type { RateLimitOptions } from './types/rate-limit.types';

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
