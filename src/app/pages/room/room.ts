import { Component, OnDestroy, computed, effect, inject, signal, viewChild, ElementRef } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MicIconComponent } from '../../components/mic-icon/mic-icon';
import { JoinService } from '../../services/join.service';
import { AuthApiService } from '../../services/auth-api.service';
import { LiveKitService } from '../../services/livekit.service';
import { WakeLockService } from '../../services/wake-lock.service';
import { JoinSession } from '../../models/join.model';
import { ParticipantView } from '../../models/participant.model';
import { getPlayerColorHex } from '../../../shared/participant-colors';

@Component({
    selector: 'app-room',
    imports: [DatePipe, FormsModule, MicIconComponent],
    templateUrl: './room.html',
    styleUrl: './room.scss',
})
export class RoomComponent implements OnDestroy {
    private readonly joinService = inject(JoinService);
    private readonly authApi = inject(AuthApiService);
    private readonly liveKit = inject(LiveKitService);
    private readonly wakeLock = inject(WakeLockService);
    private readonly router = inject(Router);

    protected readonly joinSession = this.joinService.session;
    protected readonly headerSubtitle = computed(() => {
        const session = this.joinSession();
        const roomName = session?.roomName ?? 'main';
        const localName = this.liveKit.participants().find((participant) => participant.isLocal)?.displayName;
        const displayName = session?.displayName?.trim() || localName?.trim();

        if (!displayName) {
            return `Комната · ${roomName}`;
        }

        return `Комната · ${roomName} · ${displayName}`;
    });
    protected readonly participants = this.liveKit.participants;
    protected readonly connected = this.liveKit.connected;
    protected readonly connecting = this.liveKit.connecting;
    protected readonly reconnecting = this.liveKit.reconnecting;
    protected readonly micEnabled = this.liveKit.micEnabled;
    protected readonly error = this.liveKit.error;
    protected readonly localPlayerColor = computed(() => {
        const local = this.participants().find((participant) => participant.isLocal);
        if (local) {
            return local.color;
        }

        return getPlayerColorHex(this.joinSession()?.colorIndex ?? 0);
    });
    protected readonly messages = this.liveKit.messages;
    protected readonly noiseSuppressionEnabled = this.liveKit.noiseSuppressionEnabled;
    protected readonly noiseSuppressionLoading = this.liveKit.noiseSuppressionLoading;
    protected readonly noiseSuppressionActive = this.liveKit.noiseSuppressionActive;
    protected readonly noiseSuppressionAttempted = this.liveKit.noiseSuppressionAttempted;
    protected messageText = '';
    protected readonly settingsOpen = signal(false);
    protected readonly disconnecting = signal(false);
    private readonly messagesContainer = viewChild<ElementRef<HTMLElement>>('messagesContainer');
    private leaveTimeout: ReturnType<typeof setTimeout> | null = null;
    private readonly visibilityListener = (): void => {
        if (document.visibilityState === 'visible') {
            void this.wakeLock.reacquireIfVisible();
            this.liveKit.onPageVisible();
        }
    };

    constructor() {
        const session = this.joinService.session();
        if (!session) {
            return;
        }

        this.liveKit.registerSessionRefreshHandler(() => this.refreshSession());
        this.liveKit.registerReconnectFailedHandler(() => this.handleReconnectFailed());

        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', this.visibilityListener);
        }

        void this.liveKit.connect(session).catch(() => {
            void this.authApi.releaseJoin(session.identity).catch(() => undefined);
        });

        effect(() => {
            this.messages();
            queueMicrotask(() => this.scrollChatToBottom());
        });

        effect(() => {
            if (this.connected()) {
                void this.wakeLock.acquire();
            }
        });
    }

    ngOnDestroy(): void {
        if (this.leaveTimeout) {
            clearTimeout(this.leaveTimeout);
        }

        this.liveKit.registerSessionRefreshHandler(null);
        this.liveKit.registerReconnectFailedHandler(null);

        if (typeof document !== 'undefined') {
            document.removeEventListener('visibilitychange', this.visibilityListener);
        }

        void this.wakeLock.release();

        if (!this.liveKit.isIntentionalLeave()) {
            this.liveKit.abandonConnection();
        }
    }

    protected toggleMic(): void {
        void this.liveKit.toggleMic();
    }

    protected openSettings(): void {
        this.settingsOpen.set(true);
    }

    protected closeSettings(): void {
        this.settingsOpen.set(false);
    }

    protected onNoiseSuppressionToggle(enabled: boolean): void {
        void this.liveKit.setNoiseSuppressionEnabled(enabled);
    }

    protected leaveRoom(): void {
        if (this.disconnecting()) {
            return;
        }

        this.disconnecting.set(true);

        this.leaveTimeout = setTimeout(() => {
            this.leaveTimeout = null;
            void this.wakeLock.release();
            const identity = this.joinService.session()?.identity;
            if (identity) {
                void this.authApi.releaseJoin(identity).catch(() => undefined);
            }
            this.liveKit.disconnect();
            this.joinService.clear();
            void this.router.navigateByUrl('/login');
        }, 500);
    }

    protected setVolume(participant: ParticipantView, value: number): void {
        if (participant.isLocal) {
            this.liveKit.setLocalMicVolume(value);
            return;
        }

        this.liveKit.setParticipantVolume(participant.identity, value);
    }

    protected initials(name: string): string {
        const parts = name.trim().split(/\s+/).filter(Boolean);
        if (parts.length === 0) {
            return '?';
        }

        if (parts.length === 1) {
            return parts[0].slice(0, 2).toUpperCase();
        }

        return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }

    protected sendMessage(): void {
        const text = this.messageText;
        this.messageText = '';
        void this.liveKit.sendMessage(text);
    }

    protected deleteMessage(messageId: string): void {
        void this.liveKit.deleteMessage(messageId);
    }

    private async refreshSession(): Promise<JoinSession | null> {
        const session = this.joinService.session();
        const password = this.joinService.getPassword();
        if (!session?.resumeSecret || !password) {
            return null;
        }

        try {
            const refreshed = await this.authApi.resumeJoin({
                password,
                identity: session.identity,
                resumeSecret: session.resumeSecret,
            });
            this.joinService.updateSession(refreshed);
            return refreshed;
        } catch {
            return null;
        }
    }

    private handleReconnectFailed(): void {
        const identity = this.joinService.session()?.identity;
        if (identity) {
            void this.authApi.releaseJoin(identity).catch(() => undefined);
        }
        this.joinService.clear();
        void this.router.navigateByUrl('/login');
    }

    private scrollChatToBottom(): void {
        const element = this.messagesContainer()?.nativeElement;
        if (!element) {
            return;
        }

        element.scrollTop = element.scrollHeight;
    }
}
