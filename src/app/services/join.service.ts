import { Injectable, computed, signal } from '@angular/core';
import { JoinSession } from '../models/join.model';

const SESSION_STORAGE_KEY = 'voice-chat.join-session';
const PASSWORD_STORAGE_KEY = 'voice-chat.site-password';

/** JWT и identity между /login и /room; F5 на /room без этого снова на login. */
@Injectable({ providedIn: 'root' })
export class JoinService {
    private readonly sessionState = signal<JoinSession | null>(this.readStoredSession());

    readonly session = this.sessionState.asReadonly();
    readonly isJoined = computed(() => this.sessionState() !== null);

    setSession(session: JoinSession, password?: string): void {
        this.sessionState.set(session);
        this.writeStoredSession(session);
        if (password) {
            this.writeStoredPassword(password);
        }
    }

    updateSession(session: JoinSession): void {
        this.sessionState.set(session);
        this.writeStoredSession(session);
    }

    getPassword(): string | null {
        return this.readStoredPassword();
    }

    clear(): void {
        this.sessionState.set(null);
        this.removeStoredSession();
        this.removeStoredPassword();
    }

    /** SSR/пререндер: sessionStorage недоступен — просто null. */
    private readStoredSession(): JoinSession | null {
        if (typeof sessionStorage === 'undefined') {
            return null;
        }

        try {
            const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
            if (!raw) {
                return null;
            }

            return JSON.parse(raw) as JoinSession;
        } catch {
            return null;
        }
    }

    private writeStoredSession(session: JoinSession): void {
        if (typeof sessionStorage === 'undefined') {
            return;
        }

        sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    }

    private removeStoredSession(): void {
        if (typeof sessionStorage === 'undefined') {
            return;
        }

        sessionStorage.removeItem(SESSION_STORAGE_KEY);
    }

    private readStoredPassword(): string | null {
        if (typeof sessionStorage === 'undefined') {
            return null;
        }

        return sessionStorage.getItem(PASSWORD_STORAGE_KEY);
    }

    private writeStoredPassword(password: string): void {
        if (typeof sessionStorage === 'undefined') {
            return;
        }

        sessionStorage.setItem(PASSWORD_STORAGE_KEY, password);
    }

    private removeStoredPassword(): void {
        if (typeof sessionStorage === 'undefined') {
            return;
        }

        sessionStorage.removeItem(PASSWORD_STORAGE_KEY);
    }
}
