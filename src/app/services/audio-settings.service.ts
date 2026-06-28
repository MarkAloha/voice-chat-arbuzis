import { Injectable, signal } from '@angular/core';

const STORAGE_KEY = 'voice-chat.noise-suppression';

/** Предпочтения аудио; по умолчанию шумоподавление выключено. */
@Injectable({ providedIn: 'root' })
export class AudioSettingsService {
    readonly noiseSuppression = signal(this.readNoiseSuppression());

    setNoiseSuppression(enabled: boolean): void {
        this.noiseSuppression.set(enabled);
        this.writeNoiseSuppression(enabled);
    }

    private readNoiseSuppression(): boolean {
        if (typeof localStorage === 'undefined') {
            return false;
        }

        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw === null) {
            return false;
        }

        try {
            return JSON.parse(raw) as boolean;
        } catch {
            return false;
        }
    }

    private writeNoiseSuppression(enabled: boolean): void {
        if (typeof localStorage === 'undefined') {
            return;
        }

        localStorage.setItem(STORAGE_KEY, JSON.stringify(enabled));
    }
}
