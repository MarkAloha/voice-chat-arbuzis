import type { RequestHandler } from 'express';
import { randomBytes } from 'node:crypto';
import { AccessToken } from 'livekit-server-sdk';
import { Router, json } from 'express';
import { getConfig } from './config';
import { ensureRoomParticipantLimit, listRoomParticipants } from './livekit-room';
import { assignColorIndex, resolveUniqueDisplayName } from './join-utils';
import { withJoinLock } from './join-lock';
import {
    getEffectiveParticipantCount,
    getReservedDisplayNames,
    reserveJoinSlot,
    syncReservationsWithParticipants,
} from './join-reservations';
import { createParticipantMetadata } from '../shared/participant-colors';

// TODO: вернуть перед продакшеном — см. git history или блок ниже
// createRateLimiter({
//     windowMs: 15 * 60 * 1000,
//     max: 20,
//     message: 'Слишком много попыток входа. Попробуйте через 15 минут.',
// })
const joinRateLimit: RequestHandler = (_req, _res, next) => next();

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
        await withJoinLock(async () => {
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

            try {
                await ensureRoomParticipantLimit(config.roomMaxParticipants);
            } catch {
                res.status(503).json({ error: 'Не удалось подготовить комнату. Попробуйте позже.' });
                return;
            }

            let participants;
            try {
                participants = await listRoomParticipants();
            } catch {
                res.status(503).json({ error: 'Не удалось проверить комнату. Попробуйте позже.' });
                return;
            }

            syncReservationsWithParticipants(participants);

            const participantCount = participants.length;
            const effectiveCount = getEffectiveParticipantCount(participantCount);

            if (effectiveCount >= config.roomMaxParticipants) {
                res.status(503).json({
                    error: 'Комната заполнена',
                    code: 'room_full',
                });
                return;
            }

            const existingNames = [
                ...participants.map((participant) => participant.name ?? '').filter(Boolean),
                ...getReservedDisplayNames(),
            ];
            const displayName = resolveUniqueDisplayName(nickname.trim(), existingNames);
            const colorIndex = assignColorIndex(participants, participantCount);
            const identity = makeIdentity(displayName);

            reserveJoinSlot(identity, displayName);

            const token = new AccessToken(config.livekitApiKey, config.livekitApiSecret, {
                identity,
                name: displayName,
                metadata: createParticipantMetadata(colorIndex),
            });

            token.addGrant({
                roomJoin: true,
                room: config.roomName,
                canPublish: true,
                canSubscribe: true,
                canPublishData: true,
                canUpdateOwnMetadata: true,
            });

            const jwt = await token.toJwt();

            res.json({
                token: jwt,
                livekitUrl: config.livekitUrl,
                roomName: config.roomName,
                identity,
                displayName,
                colorIndex,
            });
        });
    });

    return router;
}
