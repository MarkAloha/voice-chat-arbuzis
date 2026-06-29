import type { Request } from 'express';

/** Публичный Host за Caddy (X-Forwarded-Host или Host). */
export function resolvePublicHost(req: Request): string | null {
    const forwarded = req.get('x-forwarded-host');
    if (forwarded) {
        return forwarded.split(',')[0]?.trim().split(':')[0] ?? null;
    }

    const host = req.get('host');
    return host?.split(':')[0] ?? null;
}

function isLocalDevHost(host: string): boolean {
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

function resolveRequestProto(req: Request): string {
    const forwarded = req.get('x-forwarded-proto')?.split(',')[0]?.trim();
    if (forwarded) {
        return forwarded;
    }

    return req.protocol || 'http';
}

/**
 * LiveKit WS на том же домене, с которого открыли сайт (Caddy /livekit).
 * Локально — прямой порт из LIVEKIT_URL (7880), без /livekit.
 */
export function resolveLivekitClientUrl(req: Request, fallback: string): string {
    const host = resolvePublicHost(req);
    if (!host || isLocalDevHost(host)) {
        return fallback;
    }

    const proto = resolveRequestProto(req);
    const wsProto = proto === 'https' ? 'wss' : 'ws';
    return `${wsProto}://${host}/livekit`;
}

export function parseSiteHosts(raw: string | undefined): string[] {
    if (!raw?.trim()) {
        return ['localhost'];
    }

    return raw
        .split(',')
        .map((host) => host.trim().toLowerCase())
        .filter(Boolean);
}
