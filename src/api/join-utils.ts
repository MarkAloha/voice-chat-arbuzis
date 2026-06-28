import { CS2_PLAYER_COLOR_COUNT, readColorIndex } from '../shared/participant-colors';

/** Регистронезависимое сравнение; «вася» и «Вася» считаются одним именем. */
function normalizeDisplayName(name: string): string {
    return name.trim().toLocaleLowerCase('ru');
}

/** Авто-суффикс « 2», « 3»… — чтобы в UI не было двух одинаковых имён в одной комнате. */
export function resolveUniqueDisplayName(rawName: string, existingNames: string[]): string {
    const baseName = rawName.trim().slice(0, 32);
    const taken = new Set(existingNames.map((name) => normalizeDisplayName(name)));

    if (!taken.has(normalizeDisplayName(baseName))) {
        return baseName;
    }

    for (let suffix = 2; suffix <= 99; suffix += 1) {
        const suffixText = ` ${suffix}`;
        const maxBaseLength = Math.max(1, 32 - suffixText.length);
        const candidate = `${rawName.trim().slice(0, maxBaseLength)}${suffixText}`;

        if (!taken.has(normalizeDisplayName(candidate))) {
            return candidate;
        }
    }

    return `${baseName.slice(0, 28)} ${Date.now().toString().slice(-3)}`.slice(0, 32);
}

/** Сначала свободный цвет из палитры; если заняты все — fallback по числу участников. */
export function assignColorIndex(
    participants: { metadata?: string }[],
    participantCount: number,
): number {
    const used = new Set<number>();

    for (const participant of participants) {
        const colorIndex = readColorIndex(participant.metadata);
        if (colorIndex !== null) {
            used.add(colorIndex);
        }
    }

    for (let index = 0; index < CS2_PLAYER_COLOR_COUNT; index += 1) {
        if (!used.has(index)) {
            return index;
        }
    }

    return participantCount % CS2_PLAYER_COLOR_COUNT;
}
