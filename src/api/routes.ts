import { randomBytes } from 'node:crypto';
import { AccessToken } from 'livekit-server-sdk';
import { Router, json } from 'express';
import { getConfig } from './config';
import { getRoomParticipantCount } from './livekit-room';
import { createRateLimiter } from './rate-limit';

const joinRateLimit = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: 'Слишком много попыток входа. Попробуйте через 15 минут.',
});

function makeIdentity(nickname: string): string {
    const slug =
        nickname
            .trim()
            .toLowerCase()
            .replace(/[^\p{L}\p{N}]+/gu, '-')
            .replace(/^-|-$/g, '') || 'guest';
    const suffix = randomBytes(2).toString('hex');
    return `${slug}-${suffix}`;
}

export function createApiRouter(): Router {
    const router = Router();
    router.use(json());

    router.post('/join', joinRateLimit, async (req, res) => {
        let config;
        try {
            config = getConfig();
        } catch {
            res.status(500).json({ error: 'Сервер не настроен. Обратитесь к администратору.' });
            return;
        }

        const password = req.body?.password as string | undefined;
        const nickname = req.body?.nickname as string | undefined;

        if (!password || !nickname?.trim()) {
            res.status(400).json({ error: 'Укажите пароль и имя.' });
            return;
        }

        if (password !== config.sitePassword) {
            res.status(401).json({ error: 'Неверный пароль.' });
            return;
        }

        let participantCount: number;
        try {
            participantCount = await getRoomParticipantCount();
        } catch {
            res.status(503).json({ error: 'Не удалось проверить комнату. Попробуйте позже.' });
            return;
        }

        if (participantCount >= config.roomMaxParticipants) {
            res.status(503).json({
                error: 'Комната заполнена',
                code: 'room_full',
            });
            return;
        }

        const displayName = nickname.trim().slice(0, 32);
        const identity = makeIdentity(displayName);

        const token = new AccessToken(config.livekitApiKey, config.livekitApiSecret, {
            identity,
            name: displayName,
        });

        token.addGrant({
            roomJoin: true,
            room: config.roomName,
            canPublish: true,
            canSubscribe: true,
        });

        const jwt = await token.toJwt();

        res.json({
            token: jwt,
            livekitUrl: config.livekitUrl,
            roomName: config.roomName,
            identity,
            displayName,
        });
    });

    return router;
}
