import { describe, expect, it } from 'vitest';
import type { Request } from 'express';
import { resolveLivekitClientUrl } from './public-host';

function mockRequest(headers: Record<string, string>, protocol = 'http'): Request {
    return {
        get(name: string) {
            return headers[name.toLowerCase()];
        },
        protocol,
    } as Request;
}

describe('resolveLivekitClientUrl', () => {
    const fallback = 'ws://localhost:7880';

    it('returns fallback for localhost dev', () => {
        const req = mockRequest({ host: 'localhost:4200' });
        expect(resolveLivekitClientUrl(req, fallback)).toBe(fallback);
    });

    it('returns fallback for 127.0.0.1 dev', () => {
        const req = mockRequest({ host: '127.0.0.1:4200' });
        expect(resolveLivekitClientUrl(req, fallback)).toBe(fallback);
    });

    it('uses wss /livekit for production host behind Caddy', () => {
        const req = mockRequest({
            host: 'arbuzis.online',
            'x-forwarded-proto': 'https',
        });
        expect(resolveLivekitClientUrl(req, fallback)).toBe('wss://arbuzis.online/livekit');
    });

    it('uses ws /livekit for plain http production host', () => {
        const req = mockRequest({ host: 'example.com' }, 'http');
        expect(resolveLivekitClientUrl(req, fallback)).toBe('ws://example.com/livekit');
    });
});
