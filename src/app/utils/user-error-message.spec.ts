import { getLiveKitErrorMessage, getUserErrorMessage } from './user-error-message';

describe('user-error-message', () => {
    it('translates LiveKit signal connection + failed to fetch', () => {
        const message = getLiveKitErrorMessage(
            new Error('could not establish signal connection: Failed to fetch'),
        );

        expect(message).toContain('сервером голосовой связи');
        expect(message).not.toContain('Failed to fetch');
    });

    it('translates pc connection errors', () => {
        expect(getLiveKitErrorMessage(new Error('could not establish pc connection'))).toContain(
            'медиа-соединение',
        );
    });

    it('keeps Russian API messages', () => {
        expect(getUserErrorMessage(new Error('Неверный пароль.'), 'fallback')).toBe(
            'Неверный пароль.',
        );
    });

    it('translates failed to fetch on login', () => {
        expect(getUserErrorMessage(new TypeError('Failed to fetch'), 'Не удалось войти.')).toContain(
            'Сервер недоступен',
        );
    });
});
