import {
    Component,
    HostListener,
    OnDestroy,
    computed,
    effect,
    inject,
    signal,
    viewChild,
    ElementRef,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MicIconComponent } from '../../components/mic-icon/mic-icon';
import { SignalBarsComponent } from '../../components/signal-bars/signal-bars';
import { TooltipComponent } from '../../components/tooltip/tooltip';
import { CHAT_EMOJIS } from '../../data/chat-emojis';
import { JoinService } from '../../services/join.service';
import { AuthApiService } from '../../services/auth-api.service';
import { LiveKitService } from '../../services/livekit.service';
import { WakeLockService } from '../../services/wake-lock.service';
import { AudioSettingsService } from '../../services/audio-settings.service';
import { JoinSession } from '../../models/join.model';
import { ParticipantView } from '../../models/participant.model';
import { getPlayerColorHex } from '../../../shared/participant-colors';

@Component({
    selector: 'app-room',
    imports: [DatePipe, FormsModule, MicIconComponent, SignalBarsComponent, TooltipComponent],
    templateUrl: './room.html',
    styleUrl: './room.scss',
})
export class RoomComponent implements OnDestroy {
    private readonly joinService = inject(JoinService);
    private readonly authApi = inject(AuthApiService);
    private readonly liveKit = inject(LiveKitService);
    private readonly wakeLock = inject(WakeLockService);
    private readonly audioSettings = inject(AudioSettingsService);
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
    protected readonly uiSoundsEnabled = this.audioSettings.uiSounds;
    protected readonly chatEmojis = CHAT_EMOJIS;
    protected messageText = '';
    protected readonly settingsOpen = signal(false);
    protected readonly disconnecting = signal(false);
    protected readonly emojiPickerOpen = signal(false);
    protected readonly inviteCopied = signal(false);
    protected readonly volumePopoverIdentity = signal<string | null>(null);
    protected readonly volumePopoverLeft = signal(0);
    protected readonly volumePopoverTop = signal(0);
    protected readonly volumePopoverPositioned = signal(false);
    protected readonly volumePopoverParticipant = computed(() => {
        const identity = this.volumePopoverIdentity();
        if (!identity) {
            return null;
        }

        return this.participants().find((participant) => participant.identity === identity) ?? null;
    });
    private inviteCopiedTimeout: ReturnType<typeof setTimeout> | null = null;
    private readonly messagesContainer = viewChild<ElementRef<HTMLElement>>('messagesContainer');
    private readonly volumePopoverPanel = viewChild<ElementRef<HTMLElement>>('volumePopoverPanel');
    private hideVolumePopoverTimer: ReturnType<typeof setTimeout> | null = null;
    private showVolumePopoverTimer: ReturnType<typeof setTimeout> | null = null;
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
            document.addEventListener('scroll', this.onScrollCloseVolumePopover, true);
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

        effect(() => {
            const identity = this.volumePopoverIdentity();
            const panel = this.volumePopoverPanel();
            if (!identity || !panel) {
                return;
            }

            queueMicrotask(() => {
                requestAnimationFrame(() => this.repositionVolumePopover());
            });
        });
    }

    ngOnDestroy(): void {
        if (this.leaveTimeout) {
            clearTimeout(this.leaveTimeout);
        }

        if (this.inviteCopiedTimeout) {
            clearTimeout(this.inviteCopiedTimeout);
        }

        this.cancelHideVolumePopover();
        this.cancelShowVolumePopover();
        if (typeof document !== 'undefined') {
            document.removeEventListener('scroll', this.onScrollCloseVolumePopover, true);
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

    protected micTooltip(enabled: boolean): string {
        return enabled ? 'Микрофон включён' : 'Микрофон выключен';
    }

    protected listenTooltip(participant: ParticipantView): string {
        if (participant.listenVolume === 0) {
            return participant.isLocal
                ? 'Входящий звук выключен · нажмите, чтобы включить'
                : 'Без звука · нажмите, чтобы включить';
        }

        return participant.isLocal
            ? 'Общая громкость входящего звука · нажмите, чтобы выключить'
            : 'Нажмите, чтобы выключить звук';
    }

    protected toggleMic(): void {
        void this.liveKit.toggleMic();
    }

    protected toggleParticipantMic(participant: ParticipantView, event: MouseEvent): void {
        event.stopPropagation();
        if (!participant.isLocal) {
            return;
        }

        this.toggleMic();
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

    protected onUiSoundsToggle(enabled: boolean): void {
        this.audioSettings.setUiSounds(enabled);
    }

    protected leaveRoom(): void {
        if (this.disconnecting()) {
            return;
        }

        this.disconnecting.set(true);
        this.liveKit.announceLeave();

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

    protected setListenVolume(participant: ParticipantView, value: number): void {
        const clamped = Math.max(0, Math.min(200, Math.round(value)));

        if (participant.isLocal) {
            this.liveKit.setMasterIncomingVolume(clamped);
        } else {
            this.liveKit.setParticipantVolume(participant.identity, clamped);
        }

        if (this.volumePopoverIdentity() === participant.identity) {
            requestAnimationFrame(() => this.repositionVolumePopover());
        }
    }

    protected onListenButtonPointerDown(participant: ParticipantView, event: PointerEvent): void {
        if (event.button !== 0) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        this.cancelShowVolumePopover();
        this.closeVolumePopover();
        this.liveKit.toggleListenMute(participant.identity, participant.isLocal);
    }

    protected onListenControlEnter(participant: ParticipantView): void {
        this.cancelHideVolumePopover();
        this.cancelShowVolumePopover();

        if (this.volumePopoverIdentity() === participant.identity) {
            requestAnimationFrame(() => this.repositionVolumePopover());
            return;
        }

        this.showVolumePopoverTimer = setTimeout(() => {
            this.showVolumePopoverTimer = null;
            this.openVolumePopover(participant.identity);
        }, 250);
    }

    protected scheduleHideVolumePopover(): void {
        this.cancelHideVolumePopover();
        this.cancelShowVolumePopover();
        this.hideVolumePopoverTimer = setTimeout(() => this.closeVolumePopover(), 220);
    }

    protected cancelHideVolumePopover(): void {
        if (this.hideVolumePopoverTimer) {
            clearTimeout(this.hideVolumePopoverTimer);
            this.hideVolumePopoverTimer = null;
        }
    }

    protected onVolumePopoverEnter(): void {
        this.cancelHideVolumePopover();
        requestAnimationFrame(() => this.repositionVolumePopover());
    }

    private cancelShowVolumePopover(): void {
        if (this.showVolumePopoverTimer) {
            clearTimeout(this.showVolumePopoverTimer);
            this.showVolumePopoverTimer = null;
        }
    }

    @HostListener('window:resize')
    protected onWindowResize(): void {
        if (this.volumePopoverIdentity()) {
            this.repositionVolumePopover();
        }
    }

    private readonly onScrollCloseVolumePopover = (): void => {
        if (this.volumePopoverIdentity()) {
            this.closeVolumePopover();
        }
    };

    private closeVolumePopover(): void {
        this.volumePopoverIdentity.set(null);
        this.volumePopoverPositioned.set(false);
    }

    private openVolumePopover(identity: string): void {
        this.volumePopoverPositioned.set(false);
        this.seedVolumePopoverPosition(identity);
        this.volumePopoverIdentity.set(identity);
    }

    private estimatedVolumePopoverSize(): { width: number; height: number } {
        const root =
            typeof document !== 'undefined'
                ? parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
                : 16;

        return {
            width: Math.round(root * 2.15),
            height: Math.round(root * 6.9),
        };
    }

    private seedVolumePopoverPosition(identity: string): void {
        const { width, height } = this.estimatedVolumePopoverSize();
        this.applyVolumePopoverPosition(identity, width, height);
    }

    private applyVolumePopoverPosition(
        identity: string,
        panelWidth: number,
        panelHeight: number,
    ): boolean {
        const anchor = this.resolveVolumePopoverAnchor(identity);
        if (!anchor) {
            return false;
        }

        const rect = anchor.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) {
            return false;
        }

        const gap = 0;
        const margin = 8;
        const centerX = rect.left + rect.width / 2;

        let top = rect.top - panelHeight - gap;
        let left = centerX;

        top = Math.max(margin, top);
        left = Math.max(
            margin + panelWidth / 2,
            Math.min(left, window.innerWidth - margin - panelWidth / 2),
        );

        this.volumePopoverLeft.set(left);
        this.volumePopoverTop.set(top);
        return true;
    }

    private resolveVolumePopoverAnchor(identity: string): HTMLElement | null {
        if (typeof document === 'undefined') {
            return null;
        }

        return document.querySelector(`[data-volume-anchor="${CSS.escape(identity)}"]`);
    }

    private repositionVolumePopover(): void {
        const identity = this.volumePopoverIdentity();
        const panel = this.volumePopoverPanel()?.nativeElement;
        if (!identity || !panel) {
            return;
        }

        const panelWidth = panel.offsetWidth;
        const panelHeight = panel.offsetHeight;
        if (panelWidth === 0 && panelHeight === 0) {
            requestAnimationFrame(() => this.repositionVolumePopover());
            return;
        }

        if (!this.applyVolumePopoverPosition(identity, panelWidth, panelHeight)) {
            return;
        }

        this.volumePopoverPositioned.set(true);
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
        this.emojiPickerOpen.set(false);
        void this.liveKit.sendMessage(text);
    }

    protected toggleEmojiPicker(): void {
        this.emojiPickerOpen.update((open) => !open);
    }

    protected insertEmoji(emoji: string): void {
        const next = `${this.messageText}${emoji}`;
        this.messageText = next.slice(0, 500);
    }

    protected async copyInviteLink(): Promise<void> {
        const url = `${window.location.origin}/login`;

        try {
            await navigator.clipboard.writeText(url);
        } catch {
            return;
        }

        this.inviteCopied.set(true);

        if (this.inviteCopiedTimeout) {
            clearTimeout(this.inviteCopiedTimeout);
        }

        this.inviteCopiedTimeout = setTimeout(() => {
            this.inviteCopied.set(false);
            this.inviteCopiedTimeout = null;
        }, 2000);
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
