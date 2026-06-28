const PERMISSION_ERROR_NAMES = new Set(['NotAllowedError', 'PermissionDeniedError']);
const NOT_FOUND_ERROR_NAMES = new Set(['NotFoundError', 'DevicesNotFoundError']);

function errorText(error: unknown): string {
    if (error instanceof Error) {
        return error.message.toLowerCase();
    }

    return String(error).toLowerCase();
}

/** LiveKit/браузер шлют разный текст — ловим и DOMException.name, и message. */
export function isMicPermissionError(error: unknown): boolean {
    if (error instanceof DOMException && PERMISSION_ERROR_NAMES.has(error.name)) {
        return true;
    }

    const text = errorText(error);
    return (
        text.includes('permission') ||
        text.includes('notallowed') ||
        text.includes('not allowed') ||
        text.includes('denied')
    );
}

export function isMicNotFoundError(error: unknown): boolean {
    if (error instanceof DOMException && NOT_FOUND_ERROR_NAMES.has(error.name)) {
        return true;
    }

    const text = errorText(error);
    return text.includes('requested device not found') || text.includes('device not found');
}

/** Человекочитаемый текст вместо Permission denied / NotAllowedError. */
export function getMicErrorMessage(error: unknown): string {
    if (isMicPermissionError(error)) {
        return 'Разрешите доступ к микрофону: нажмите на замок в адресной строке, включите микрофон и попробуйте снова.';
    }

    if (isMicNotFoundError(error)) {
        return 'Микрофон не найден. Подключите микрофон или проверьте настройки системы.';
    }

    return 'Не удалось включить микрофон. Проверьте настройки браузера и попробуйте снова.';
}
