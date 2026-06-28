import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
    getEffectiveParticipantCount,
    getReservedJoinCount,
    releaseJoinSlot,
    reserveJoinSlot,
    resetJoinReservationsForTests,
    syncReservationsWithParticipants,
} from './join-reservations';

describe('join-reservations', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        resetJoinReservationsForTests();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('counts only fresh reservations toward room limit', () => {
        reserveJoinSlot('user-a', 'Alice');
        expect(getEffectiveParticipantCount(0)).toBe(1);

        vi.advanceTimersByTime(31_000);
        expect(getEffectiveParticipantCount(0)).toBe(0);
    });

    it('clears stale reservations when the LiveKit room is empty', () => {
        reserveJoinSlot('user-a', 'Alice');
        reserveJoinSlot('user-b', 'Bob');

        vi.advanceTimersByTime(31_000);
        syncReservationsWithParticipants([]);

        expect(getReservedJoinCount()).toBe(0);
        expect(getEffectiveParticipantCount(0)).toBe(0);
    });

    it('keeps active reservations while someone is still connecting', () => {
        reserveJoinSlot('user-a', 'Alice');

        syncReservationsWithParticipants([]);

        expect(getEffectiveParticipantCount(0)).toBe(1);
    });

    it('drops reservation after a successful LiveKit connection', () => {
        reserveJoinSlot('user-a', 'Alice');

        syncReservationsWithParticipants([{ identity: 'user-a', name: 'Alice' } as never]);

        expect(getReservedJoinCount()).toBe(0);
    });

    it('releases a slot explicitly when connect fails', () => {
        reserveJoinSlot('user-a', 'Alice');
        releaseJoinSlot('user-a');

        expect(getEffectiveParticipantCount(0)).toBe(0);
    });
});
