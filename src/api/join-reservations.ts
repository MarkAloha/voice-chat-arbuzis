import type { ParticipantInfo } from 'livekit-server-sdk';

/** How long a reserved slot counts toward the room limit (race window while connecting). */
const RESERVATION_ACTIVE_MS = 30_000;
/** Hard cleanup for entries left in the in-memory map. */
const RESERVATION_TTL_MS = 60_000;

interface JoinReservation {
    displayName: string;
    createdAt: number;
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

function isActiveReservation(reservation: JoinReservation, now = Date.now()): boolean {
    return now - reservation.createdAt < RESERVATION_ACTIVE_MS;
}

/** Слот резервируется до подключения к LiveKit — защита от гонки при одновременном входе. */
export function syncReservationsWithParticipants(participants: ParticipantInfo[]): void {
    pruneExpiredReservations();
    const connectedIdentities = new Set(participants.map((participant) => participant.identity));

    for (const identity of [...reservations.keys()]) {
        if (connectedIdentities.has(identity)) {
            reservations.delete(identity);
        }
    }

    // Failed joins reserve a slot but never reach LiveKit — drop stale holds on an empty room.
    if (participants.length === 0) {
        const now = Date.now();
        for (const [identity, reservation] of reservations) {
            if (!isActiveReservation(reservation, now)) {
                reservations.delete(identity);
            }
        }
    }
}

export function getReservedJoinCount(): number {
    return getActiveReservationCount();
}

export function getActiveReservationCount(now = Date.now()): number {
    pruneExpiredReservations(now);

    let count = 0;
    for (const reservation of reservations.values()) {
        if (isActiveReservation(reservation, now)) {
            count += 1;
        }
    }

    return count;
}

export function getReservedDisplayNames(): string[] {
    pruneExpiredReservations();
    const now = Date.now();

    return [...reservations.values()]
        .filter((reservation) => isActiveReservation(reservation, now))
        .map((reservation) => reservation.displayName);
}

export function reserveJoinSlot(identity: string, displayName: string): void {
    pruneExpiredReservations();
    const now = Date.now();

    reservations.set(identity, {
        displayName,
        createdAt: now,
        expiresAt: now + RESERVATION_TTL_MS,
    });
}

export function releaseJoinSlot(identity: string): void {
    reservations.delete(identity);
}

/** connected + «висящие» JWT; без этого лимит обходится параллельными /join. */
export function getEffectiveParticipantCount(connectedCount: number): number {
    return connectedCount + getActiveReservationCount();
}

/** @internal */
export function resetJoinReservationsForTests(): void {
    reservations.clear();
}
