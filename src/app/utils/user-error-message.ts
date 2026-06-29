function errorText(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }

    return String(error);
}

function normalizedText(error: unknown): string {
    return errorText(error).toLowerCase();
}

function hasCyrillic(text: string): boolean {
    return /[а-яё]/i.test(text);
}

/** Ошибки LiveKit / WebRTC — вместо английских ConnectionError. */
export function getLiveKitErrorMessage(error: unknown): string {
    const text = normalizedText(error);

    if (text.includes('signal connection')) {
        if (text.includes('failed to fetch') || text.includes('network')) {
            return 'Не удалось связаться с сервером голосовой связи. Запустите LiveKit (npm run livekit) и убедитесь, что Docker Desktop работает.';
        }

        return 'Не удалось подключиться к серверу сигнализации. Проверьте интернет и настройки LiveKit.';
    }

    if (text.includes('pc connection') || text.includes('peer connection')) {
        return 'Не удалось установить медиа-соединение. Проверьте сеть, VPN и что UDP-порты на сервере открыты.';
    }

    if (text.includes('failed to fetch') || text.includes('networkerror') || text.includes('load failed')) {
        return 'Сервер недоступен. Проверьте интернет и что приложение запущено (npm run dev).';
    }

    if (text.includes('cancelled') || text.includes('aborted')) {
        return 'Подключение прервано. Попробуйте снова.';
    }

    if (text.includes('token') && (text.includes('invalid') || text.includes('expired') || text.includes('jwt'))) {
        return 'Сессия истекла. Войдите в комнату заново.';
    }

    if (text.includes('room full') || text.includes('комната заполнена')) {
        return 'Комната заполнена. Попробуйте позже.';
    }

    const raw = errorText(error);
    if (hasCyrillic(raw)) {
        return raw;
    }

    return 'Не удалось подключиться к комнате. Проверьте интернет и попробуйте снова.';
}

/** Общие ошибки входа / API — русский текст вместо Failed to fetch. */
export function getUserErrorMessage(error: unknown, fallback: string): string {
    const raw = errorText(error);
    const text = raw.toLowerCase();

    if (hasCyrillic(raw)) {
        return raw;
    }

    if (text.includes('failed to fetch') || text.includes('networkerror') || text.includes('load failed')) {
        return 'Сервер недоступен. Проверьте, что запущен npm run dev (API на порту 3000).';
    }

    if (text.includes('timeout') || text.includes('timed out')) {
        return 'Превышено время ожидания. Проверьте интернет и попробуйте снова.';
    }

    if (raw.trim()) {
        return getLiveKitErrorMessage(error);
    }

    return fallback;
}
