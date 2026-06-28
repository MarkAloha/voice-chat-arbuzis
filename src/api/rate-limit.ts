import type { NextFunction, Request, Response } from 'express';

type Bucket = {
    count: number;
    resetAt: number;
};

export type RateLimitOptions = {
    windowMs: number;
    max: number;
    message: string;
};

export function createRateLimiter(options: RateLimitOptions) {
    const buckets = new Map<string, Bucket>();

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
