/** CS2 cl_color: 0=yellow, 1=purple, 2=green, 3=blue, 4=orange */
export const CS2_PLAYER_COLORS = ['#E8C948', '#B166FF', '#6BC04B', '#5BBAF2', '#F0A040'] as const;

export const CS2_PLAYER_COLOR_COUNT = CS2_PLAYER_COLORS.length;

export function getPlayerColorHex(index: number): string {
    const safeIndex = Math.max(0, Math.min(CS2_PLAYER_COLOR_COUNT - 1, index));
    return CS2_PLAYER_COLORS[safeIndex];
}

export function createParticipantMetadata(colorIndex: number): string {
    return JSON.stringify({ colorIndex });
}

export function readColorIndex(metadata?: string): number | null {
    if (!metadata) {
        return null;
    }

    try {
        const parsed = JSON.parse(metadata) as { colorIndex?: unknown };
        if (
            typeof parsed.colorIndex === 'number' &&
            parsed.colorIndex >= 0 &&
            parsed.colorIndex < CS2_PLAYER_COLOR_COUNT
        ) {
            return parsed.colorIndex;
        }
    } catch {
        // Ignore malformed metadata.
    }

    return null;
}
