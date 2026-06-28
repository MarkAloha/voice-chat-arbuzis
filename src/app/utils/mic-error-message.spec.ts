import { getMicErrorMessage, isMicNotFoundError, isMicPermissionError } from './mic-error-message';

describe('mic-error-message', () => {
    it('detects permission errors by DOMException name', () => {
        expect(isMicPermissionError(new DOMException('Denied', 'NotAllowedError'))).toBe(true);
    });

    it('detects permission errors by message text', () => {
        expect(isMicPermissionError(new Error('Permission denied'))).toBe(true);
    });

    it('detects missing microphone errors', () => {
        expect(isMicNotFoundError(new DOMException('Missing', 'NotFoundError'))).toBe(true);
    });

    it('returns a friendly permission message', () => {
        expect(getMicErrorMessage(new Error('Permission denied'))).toContain('Разрешите доступ');
    });

    it('returns a friendly not-found message', () => {
        expect(getMicErrorMessage(new DOMException('Missing', 'NotFoundError'))).toContain(
            'не найден',
        );
    });
});
