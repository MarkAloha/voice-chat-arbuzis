import type { ParticipantInfo } from 'livekit-server-sdk';

const RESERVATION_TTL_MS = 5 * 60_000;

interface JoinReservation {
    displayName: string;
    expiresAt: number;
}

const reservations = new Map<string, JoinReservation>();

function pruneExpiredReservations(now = Date.now()): void {
    for (const [identity, reservation] of reservations) {
        if (reservation.expiresAt <= now) {
            reservations.delete(identity);
        }
    }
}

export function syncReservationsWithParticipants(participants: ParticipantInfo[]): void {
    pruneExpiredReservations();
    const connectedIdentities = new Set(participants.map((participant) => participant.identity));

    for (const identity of [...reservations.keys()]) {
        if (connectedIdentities.has(identity)) {
            reservations.delete(identity);
        }
    }
}

export function getReservedJoinCount(): number {
    pruneExpiredReservations();
    return reservations.size;
}

export function getReservedDisplayNames(): string[] {
    pruneExpiredReservations();
    return [...reservations.values()].map((reservation) => reservation.displayName);
}

export function reserveJoinSlot(identity: string, displayName: string): void {
    pruneExpiredReservations();
    reservations.set(identity, {
        displayName,
        expiresAt: Date.now() + RESERVATION_TTL_MS,
    });
}

export function getEffectiveParticipantCount(connectedCount: number): number {
    return connectedCount + getReservedJoinCount();
}
