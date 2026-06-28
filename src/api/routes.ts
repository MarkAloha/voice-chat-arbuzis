import { randomBytes } from 'node:crypto';
import type { Request } from 'express';
import { Router, json } from 'express';
import { getConfig } from './config';
import { ensureRoomParticipantLimit, listRoomParticipants } from './livekit-room';
import { assignColorIndex, resolveUniqueDisplayName } from './join-utils';
import { withJoinLock } from './join-lock';
import {
    getEffectiveParticipantCount,
    getReservedDisplayNames,
    releaseJoinSlot,
    reserveJoinSlot,
    syncReservationsWithParticipants,
} from './join-reservations';
import { createRateLimiter } from './rate-limit';
import { createParticipantToken, isValidParticipantIdentity } from './join-token';
import {
    issueResumeCredential,
    revokeResumeCredential,
    verifyResumeCredential,
} from './join-resume-credentials';
import { resolveLivekitClientUrl } from './public-host';

const joinRateLimit = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: 'Слишком много попыток входа. Попробуйте через 15 минут.',
});

/** Суффикс в identity — чтобы два «Вася» не конфликтовали в LiveKit при одном displayName. */
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

function buildJoinResponse(
    req: Request,
    identity: string,
    displayName: string,
    colorIndex: number,
    token: string,
    resumeSecret: string,
) {
    const config = getConfig();
    return {
        token,
        livekitUrl: resolveLivekitClientUrl(req, config.livekitUrl),
        roomName: config.roomName,
        identity,
        displayName,
        colorIndex,
        resumeSecret,
    };
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

            const resumeSecret = issueResumeCredential(identity, displayName, colorIndex);
            const jwt = await createParticipantToken(identity, displayName, colorIndex);

            res.json(buildJoinResponse(req, identity, displayName, colorIndex, jwt, resumeSecret));
        });
    });

    /** Новый JWT с тем же identity — после блокировки экрана или истечения токена. */
    router.post('/join/resume', joinRateLimit, async (req, res) => {
        await withJoinLock(async () => {
            let config;
            try {
                config = getConfig();
            } catch {
                res.status(500).json({ error: 'Сервер не настроен. Обратитесь к администратору.' });
                return;
            }

            const password = req.body?.password as string | undefined;
            const identity = req.body?.identity as string | undefined;
            const resumeSecret = req.body?.resumeSecret as string | undefined;

            if (!password || !identity?.trim() || !resumeSecret?.trim()) {
                res.status(400).json({ error: 'Укажите пароль и данные сессии.' });
                return;
            }

            if (password !== config.sitePassword) {
                res.status(401).json({ error: 'Неверный пароль.' });
                return;
            }

            const trimmedIdentity = identity.trim();
            if (!isValidParticipantIdentity(trimmedIdentity)) {
                res.status(400).json({ error: 'Некорректная сессия. Войдите заново.' });
                return;
            }

            const credential = verifyResumeCredential(trimmedIdentity, resumeSecret.trim());
            if (!credential) {
                res.status(403).json({ error: 'Сессия истекла. Войдите заново.' });
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

            const alreadyConnected = participants.some(
                (participant) => participant.identity === trimmedIdentity,
            );

            if (
                !alreadyConnected &&
                getEffectiveParticipantCount(participants.length) >= config.roomMaxParticipants
            ) {
                res.status(503).json({
                    error: 'Комната заполнена',
                    code: 'room_full',
                });
                return;
            }

            const jwt = await createParticipantToken(
                trimmedIdentity,
                credential.displayName,
                credential.colorIndex,
            );

            res.json(
                buildJoinResponse(
                    req,
                    trimmedIdentity,
                    credential.displayName,
                    credential.colorIndex,
                    jwt,
                    resumeSecret.trim(),
                ),
            );
        });
    });

    /** Освобождает слот, если JWT выдан, но до LiveKit пользователь не дошёл. */
    router.post('/join/release', json(), (req, res) => {
        const identity = req.body?.identity as string | undefined;
        if (!identity?.trim()) {
            res.status(400).json({ error: 'Не указан участник.' });
            return;
        }

        releaseJoinSlot(identity.trim());
        revokeResumeCredential(identity.trim());
        res.status(204).end();
    });

    return router;
}
