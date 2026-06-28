export const RANDOM_NICKNAMES = [
    'Владислав',
    'Дмитрий',
    'Чечен',
    'Бутуз',
    'Артём',
    'Владон',
    'Алексей',
    'Лёха',
    'Марк',
    'ArBuZiS',
    'Alfem',
    'Данил',
    'Андрей',
    'Кристина',
] as const;

export function pickRandomNickname(): string {
    const index = Math.floor(Math.random() * RANDOM_NICKNAMES.length);
    return RANDOM_NICKNAMES[index];
}
