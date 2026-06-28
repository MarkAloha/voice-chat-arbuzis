import { AccessToken } from 'livekit-server-sdk';
import { getConfig } from './config';
import { createParticipantMetadata } from '../shared/participant-colors';

/** JWT для LiveKit — достаточно для сессии и переподключений в течение звонка. */
const TOKEN_TTL = '6h';

export async function createParticipantToken(
    identity: string,
    displayName: string,
    colorIndex: number,
): Promise<string> {
    const config = getConfig();
    const token = new AccessToken(config.livekitApiKey, config.livekitApiSecret, {
        identity,
        name: displayName,
        metadata: createParticipantMetadata(colorIndex),
        ttl: TOKEN_TTL,
    });

    token.addGrant({
        roomJoin: true,
        room: config.roomName,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
        canUpdateOwnMetadata: true,
    });

    return token.toJwt();
}

/** identity из makeIdentity — защита от произвольных значений в /join/resume. */
export function isValidParticipantIdentity(identity: string): boolean {
    return /^[\p{L}\p{N}][\p{L}\p{N}-]*-[0-9a-f]{4}$/u.test(identity);
}
