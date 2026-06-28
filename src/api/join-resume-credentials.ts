import { randomBytes, timingSafeEqual } from 'node:crypto';
import { DEPARTURE_TIMEOUT_SEC } from './livekit-room';

interface ResumeCredential {
    secret: Buffer;
    displayName: string;
    colorIndex: number;
    expiresAt: number;
}

const credentials = new Map<string, ResumeCredential>();

function pruneExpiredCredentials(now = Date.now()): void {
    for (const [identity, credential] of credentials) {
        if (credential.expiresAt <= now) {
            credentials.delete(identity);
        }
    }
}

/** Выдаёт одноразовый секрет для /join/resume — без него нельзя занять чужой identity. */
export function issueResumeCredential(
    identity: string,
    displayName: string,
    colorIndex: number,
): string {
    pruneExpiredCredentials();
    const secret = randomBytes(24).toString('hex');

    credentials.set(identity, {
        secret: Buffer.from(secret, 'utf8'),
        displayName,
        colorIndex,
        expiresAt: Date.now() + DEPARTURE_TIMEOUT_SEC * 1000,
    });

    return secret;
}

export function verifyResumeCredential(
    identity: string,
    secret: string,
): { displayName: string; colorIndex: number } | null {
    pruneExpiredCredentials();
    const credential = credentials.get(identity);
    if (!credential || credential.expiresAt <= Date.now()) {
        credentials.delete(identity);
        return null;
    }

    const provided = Buffer.from(secret, 'utf8');
    if (
        provided.length !== credential.secret.length ||
        !timingSafeEqual(provided, credential.secret)
    ) {
        return null;
    }

    credential.expiresAt = Date.now() + DEPARTURE_TIMEOUT_SEC * 1000;
    return {
        displayName: credential.displayName,
        colorIndex: credential.colorIndex,
    };
}

export function revokeResumeCredential(identity: string): void {
    credentials.delete(identity);
}

/** @internal */
export function resetResumeCredentialsForTests(): void {
    credentials.clear();
}
