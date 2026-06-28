import { Injectable } from '@angular/core';

/** Не даёт экрану гаснуть, пока пользователь в комнате (где браузер поддерживает Wake Lock). */
@Injectable({ providedIn: 'root' })
export class WakeLockService {
    private sentinel: WakeLockSentinel | null = null;

    async acquire(): Promise<void> {
        if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) {
            return;
        }

        if (this.sentinel && !this.sentinel.released) {
            return;
        }

        try {
            await this.release();
            this.sentinel = await navigator.wakeLock.request('screen');
            this.sentinel.addEventListener('release', () => {
                if (this.sentinel?.released) {
                    this.sentinel = null;
                }
            });
        } catch {
            // Пользователь отклонил или API недоступен — не блокируем звонок.
        }
    }

    async release(): Promise<void> {
        const current = this.sentinel;
        this.sentinel = null;

        if (!current || current.released) {
            return;
        }

        try {
            await current.release();
        } catch {
            // ignore
        }
    }

    /** После разблокировки телефона Wake Lock сбрасывается — запрашиваем снова. */
    async reacquireIfVisible(): Promise<void> {
        if (typeof document === 'undefined' || document.visibilityState !== 'visible') {
            return;
        }

        await this.acquire();
    }
}
