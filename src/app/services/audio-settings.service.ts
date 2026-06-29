import { Injectable, signal } from '@angular/core';

const STORAGE_KEY = 'voice-chat.noise-suppression';
const UI_SOUNDS_KEY = 'voice-chat.ui-sounds';

/** Предпочтения аудио; по умолчанию шумоподавление выключено. */
@Injectable({ providedIn: 'root' })
export class AudioSettingsService {
    readonly noiseSuppression = signal(this.readNoiseSuppression());
    readonly uiSounds = signal(this.readUiSounds());

    setNoiseSuppression(enabled: boolean): void {
        this.noiseSuppression.set(enabled);
        this.writeBoolean(STORAGE_KEY, enabled);
    }

    setUiSounds(enabled: boolean): void {
        this.uiSounds.set(enabled);
        this.writeBoolean(UI_SOUNDS_KEY, enabled);
    }

    private readNoiseSuppression(): boolean {
        return this.readBoolean(STORAGE_KEY, false);
    }

    private readUiSounds(): boolean {
        return this.readBoolean(UI_SOUNDS_KEY, true);
    }

    private readBoolean(key: string, fallback: boolean): boolean {
        if (typeof localStorage === 'undefined') {
            return fallback;
        }

        const raw = localStorage.getItem(key);
        if (raw === null) {
            return fallback;
        }

        try {
            return JSON.parse(raw) as boolean;
        } catch {
            return fallback;
        }
    }

    private writeBoolean(key: string, enabled: boolean): void {
        if (typeof localStorage === 'undefined') {
            return;
        }

        localStorage.setItem(key, JSON.stringify(enabled));
    }
}
