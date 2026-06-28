export type RateLimitOptions = {
    windowMs: number;
    max: number;
    message: string;
};

export type RateLimitBucket = {
    count: number;
    resetAt: number;
};
