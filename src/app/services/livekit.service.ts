import { Injectable, inject, signal } from '@angular/core';
import {
    ConnectionQuality,
    ConnectionState,
    LocalAudioTrack,
    Participant,
    ParticipantEvent,
    RemoteParticipant,
    RemoteTrack,
    Room,
    RoomEvent,
    Track,
} from 'livekit-client';
import { JoinSession } from '../models/join.model';
import { ChatMessage } from '../models/chat.model';
import { ParticipantView } from '../models/participant.model';
import { MicAudioProcessor } from './mic-audio-processor';
import { AudioSettingsService } from './audio-settings.service';
import { UiSoundService } from './ui-sound.service';
import { getMicErrorMessage } from '../utils/mic-error-message';
import { getLiveKitErrorMessage } from '../utils/user-error-message';
import { getPlayerColorHex, readColorIndex } from '../../shared/participant-colors';
import {
    buildSignalTooltipView,
    connectionQualityBars,
    connectionQualityTone,
    type LocalConnectionStats,
} from '../../shared/connection-quality';

const CHAT_TOPIC = 'chat-message';
const CHAT_DELETE_TOPIC = 'chat-delete';
const LEAVE_TOPIC = 'participant-leave';
const MAX_RECONNECT_DELAY_MS = 10_000;
const MAX_RECONNECT_ATTEMPTS = 8;
/** Ниже порога LiveKit activeSpeakers — подсветка включается раньше. */
const SPEAKING_AUDIO_LEVEL = 0.03;

export type SessionRefreshHandler = () => Promise<JoinSession | null>;
export type ReconnectFailedHandler = () => void;

@Injectable({ providedIn: 'root' })
export class LiveKitService {
    private readonly audioSettings = inject(AudioSettingsService);
    private readonly uiSound = inject(UiSoundService);
    private room: Room | null = null;
    private activeSession: JoinSession | null = null;
    private sessionRefreshHandler: SessionRefreshHandler | null = null;
    private reconnectFailedHandler: ReconnectFailedHandler | null = null;
    private intentionalLeave = false;
    private reconnectAttempt = 0;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private reconnectInFlight: Promise<void> | null = null;
    private readonly volumeLevels = new Map<string, number>();
    private readonly participantPreMute = new Map<string, number>();
    private masterIncomingVolume = 100;
    private masterPreMute: number | null = null;
    private localMicVolume = 100;
    private micAudioProcessor: MicAudioProcessor | null = null;
    private localColorIndex = 0;
    /** Явное желание пользователя: микрофон вкл/выкл (не перезаписывается событиями LiveKit). */
    private localMicDesired = true;
    private allowJoinSounds = false;
    private readonly speakingBound = new WeakSet<Participant>();
    /** Сразу убираем из UI — LiveKit может держать identity для reconnect. */
    private readonly hiddenParticipants = new Set<string>();
    private readonly pendingParticipantHideTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private pageUnloadHandlerRegistered = false;
    private pageUnloadFlushed = false;
    private teardownInProgress = false;
    private speakingPollTimer: ReturnType<typeof setInterval> | null = null;
    private connectionStatsTimer: ReturnType<typeof setInterval> | null = null;
    private localConnectionStats: LocalConnectionStats = { rttMs: null, packetLossPercent: null };
    private readonly textEncoder = new TextEncoder();
    private readonly textDecoder = new TextDecoder();

    readonly participants = signal<ParticipantView[]>([]);
    readonly messages = signal<ChatMessage[]>([]);
    readonly connected = signal(false);
    readonly connecting = signal(false);
    readonly reconnecting = signal(false);
    readonly micEnabled = signal(true);
    readonly error = signal<string | null>(null);
    readonly noiseSuppressionLoading = signal(false);
    readonly noiseSuppressionActive = signal(false);
    readonly noiseSuppressionAttempted = signal(false);
    readonly localIdentity = signal<string | null>(null);

    readonly noiseSuppressionEnabled = this.audioSettings.noiseSuppression;

    registerSessionRefreshHandler(handler: SessionRefreshHandler | null): void {
        this.sessionRefreshHandler = handler;
    }

    registerReconnectFailedHandler(handler: ReconnectFailedHandler | null): void {
        this.reconnectFailedHandler = handler;
    }

    isIntentionalLeave(): boolean {
        return this.intentionalLeave;
    }

    /** Уход со страницы комнаты без явного «Выйти» — рвём WebRTC, но не помечаем как logout. */
    abandonConnection(): void {
        if (this.intentionalLeave) {
            return;
        }

        this.clearReconnectTimer();
        this.reconnectInFlight = null;
        this.reconnectAttempt = 0;
        this.reconnecting.set(false);
        this.activeSession = null;
        void this.flushPageUnload();
        void this.teardownRoomMedia();
    }

    /** Подключение к комнате; микрофон отдельно — отказ в mic не рвёт сессию. */
    async connect(session: JoinSession): Promise<void> {
        this.intentionalLeave = false;
        this.pageUnloadFlushed = false;
        this.activeSession = session;
        this.localIdentity.set(session.identity);
        this.localColorIndex = session.colorIndex;
        this.setOptimisticLocalParticipant(session);

        if (!this.room) {
            this.room = this.createRoom();
        }

        if (this.room.state === ConnectionState.Connected) {
            if (this.room.localParticipant.identity === session.identity) {
                this.connected.set(true);
                return;
            }

            await this.teardownRoomMedia();
            this.room = this.createRoom();
        }

        this.connecting.set(true);
        this.error.set(null);

        try {
            await this.room.connect(session.livekitUrl, session.token);
            await this.finishConnectedSession(this.room);
        } catch (err) {
            this.error.set(getLiveKitErrorMessage(err));
            this.participants.set([]);
            await this.teardownRoomMedia();
            throw err;
        } finally {
            this.connecting.set(false);
        }
    }

    /** Сразу сообщаем остальным об уходе — до задержки UI и teardown. */
    announceLeave(): void {
        void this.publishLeaveNotice();
    }

    /** Явный выход — не пытаться переподключаться. */
    disconnect(): void {
        this.stopSpeakingPoll();
        this.stopConnectionStatsPoll();
        this.allowJoinSounds = false;
        this.intentionalLeave = true;
        this.clearReconnectTimer();
        this.reconnectInFlight = null;
        this.reconnectAttempt = 0;
        this.reconnecting.set(false);
        this.activeSession = null;

        void this.teardownRoomMedia();
        this.volumeLevels.clear();
        this.participantPreMute.clear();
        this.masterIncomingVolume = 100;
        this.masterPreMute = null;
        this.localMicVolume = 100;
        this.micAudioProcessor = null;
        this.noiseSuppressionLoading.set(false);
        this.noiseSuppressionActive.set(false);
        this.noiseSuppressionAttempted.set(false);
        this.messages.set([]);
        this.connected.set(false);
        this.connecting.set(false);
        this.micEnabled.set(true);
        this.localMicDesired = true;
        this.localIdentity.set(null);
        this.localColorIndex = 0;
        this.hiddenParticipants.clear();
        this.clearPendingParticipantHideTimers();
        this.unregisterPageUnloadHandler();
        this.pageUnloadFlushed = false;
        this.participants.set([]);
    }

    /** Вкладка снова видима — пробуем восстановить соединение и звук. */
    onPageVisible(): void {
        if (this.intentionalLeave || !this.activeSession) {
            return;
        }

        if (this.room?.state === ConnectionState.Connected) {
            void this.resumeMediaAfterBackground();
            return;
        }

        void this.tryReconnect();
    }

    async toggleMic(): Promise<void> {
        const room = this.room;
        if (!room) {
            return;
        }

        const next = !this.micEnabled();
        if (next) {
            this.localMicDesired = true;
            try {
                await this.enableLocalMicrophone(room);
                this.uiSound.playMicOn();
            } catch (err) {
                this.localMicDesired = false;
                this.error.set(getMicErrorMessage(err));
                this.syncParticipants();
            }
            return;
        }

        this.localMicDesired = false;
        await room.localParticipant.setMicrophoneEnabled(false);
        this.micEnabled.set(false);
        this.uiSound.playMicOff();
        this.syncParticipants();
    }

    setLocalMicVolume(volumePercent: number): void {
        const clamped = Math.max(0, Math.min(200, Math.round(volumePercent)));
        this.localMicVolume = clamped;
        this.micAudioProcessor?.setVolume(clamped);
        this.syncParticipants();
    }

    /** Чат через data channel — отдельного бэкенда для сообщений нет. */
    async sendMessage(text: string): Promise<void> {
        const room = this.room;
        const message = text.trim();
        if (!room || !message) {
            return;
        }

        const chatMessage: ChatMessage = {
            id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            author: room.localParticipant.name || room.localParticipant.identity,
            authorIdentity: room.localParticipant.identity,
            text: message.slice(0, 500),
            sentAt: new Date(),
            isLocal: true,
        };

        this.addMessage(chatMessage);

        await room.localParticipant.publishData(
            this.textEncoder.encode(
                JSON.stringify({
                    id: chatMessage.id,
                    text: chatMessage.text,
                    sentAt: chatMessage.sentAt.toISOString(),
                }),
            ),
            {
                reliable: true,
                topic: CHAT_TOPIC,
            },
        );
    }

    async deleteMessage(messageId: string): Promise<void> {
        const room = this.room;
        if (!room) {
            return;
        }

        const message = this.messages().find((item) => item.id === messageId);
        const localId = room.localParticipant.identity;
        if (!message || (message.authorIdentity !== localId && !message.isLocal)) {
            return;
        }

        this.removeMessage(messageId);

        await room.localParticipant.publishData(
            this.textEncoder.encode(JSON.stringify({ id: messageId })),
            {
                reliable: true,
                topic: CHAT_DELETE_TOPIC,
            },
        );
    }

    /** Общая громкость входящего звука (только локально у слушателя). */
    setMasterIncomingVolume(volumePercent: number): void {
        const clamped = Math.max(0, Math.min(200, Math.round(volumePercent)));
        this.masterIncomingVolume = clamped;
        if (clamped > 0) {
            this.masterPreMute = null;
        }

        const room = this.room;
        if (room) {
            for (const participant of room.remoteParticipants.values()) {
                this.applyRemoteVolume(participant);
            }
        }

        this.syncParticipants();
    }

    /** Громкость участника локально у слушателя; на исходящий поток не влияет. */
    setParticipantVolume(identity: string, volumePercent: number): void {
        const clamped = Math.max(0, Math.min(200, Math.round(volumePercent)));
        this.volumeLevels.set(identity, clamped);
        if (clamped > 0) {
            this.participantPreMute.delete(identity);
        }

        const remote = this.room?.remoteParticipants.get(identity);
        if (remote) {
            this.applyRemoteVolume(remote);
        }

        this.syncParticipants();
    }

    toggleListenMute(identity: string, isLocal: boolean): void {
        if (isLocal) {
            if (this.masterIncomingVolume === 0) {
                this.setMasterIncomingVolume(this.masterPreMute ?? 100);
                this.masterPreMute = null;
            } else {
                this.masterPreMute = this.masterIncomingVolume;
                this.setMasterIncomingVolume(0);
            }
            return;
        }

        const current = this.volumeLevels.get(identity) ?? 100;
        if (current === 0) {
            this.setParticipantVolume(identity, this.participantPreMute.get(identity) ?? 100);
            this.participantPreMute.delete(identity);
            return;
        }

        this.participantPreMute.set(identity, current);
        this.setParticipantVolume(identity, 0);
    }

    /** Переключение DTLN на лету — пересобираем audio pipeline без disconnect. */
    async setNoiseSuppressionEnabled(enabled: boolean): Promise<void> {
        if (this.noiseSuppressionEnabled() === enabled) {
            return;
        }

        this.audioSettings.setNoiseSuppression(enabled);
        await this.rebuildMicProcessor();
    }

    private createRoom(): Room {
        const room = new Room({
            adaptiveStream: false,
            dynacast: false,
            webAudioMix: true,
            disconnectOnPageLeave: false,
        });

        room.on(RoomEvent.ParticipantConnected, (participant) => {
            this.hiddenParticipants.delete(participant.identity);
            this.cancelPendingParticipantHide(participant.identity);

            if (this.allowJoinSounds && !participant.isLocal) {
                this.uiSound.playParticipantJoined();
            }

            this.bindSpeakingListener(participant);
            this.applyRemoteVolume(participant);
            this.syncParticipants();
        })
            .on(RoomEvent.ParticipantDisconnected, (participant) => {
                this.cancelPendingParticipantHide(participant.identity);
                this.hiddenParticipants.add(participant.identity);
                this.volumeLevels.delete(participant.identity);
                this.participantPreMute.delete(participant.identity);
                this.syncParticipants();
            })
            .on(RoomEvent.TrackMuted, (publication, participant) => {
                this.updateLocalMicFromPublication(publication, participant, false);
                this.syncParticipants();
            })
            .on(RoomEvent.TrackUnmuted, (publication, participant) => {
                void this.handleLocalTrackUnmuted(publication, participant);
            })
            .on(RoomEvent.TrackPublished, () => this.syncParticipants())
            .on(RoomEvent.TrackUnpublished, (publication, participant) => {
                if (participant.isLocal) {
                    this.updateLocalMicFromPublication(publication, participant, false);
                }
                this.syncParticipants();
            })
            .on(RoomEvent.ConnectionQualityChanged, () => this.syncParticipants())
            .on(RoomEvent.ParticipantMetadataChanged, () => this.syncParticipants())
            .on(RoomEvent.ActiveSpeakersChanged, () => this.syncParticipants())
            .on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
                if (!participant.isLocal && publication.source === Track.Source.Microphone) {
                    this.cancelPendingParticipantHide(participant.identity);
                }

                this.attachAudioTrack(track, participant);
                this.syncParticipants();
            })
            .on(RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
                track.detach();
                if (!participant.isLocal && publication.source === Track.Source.Microphone) {
                    this.schedulePendingParticipantHide(participant.identity);
                    this.syncParticipants();
                }
            })
            .on(RoomEvent.DataReceived, (payload, participant, _kind, topic) => {
                if (topic === CHAT_TOPIC) {
                    this.handleChatMessage(payload, participant);
                    return;
                }

                if (topic === CHAT_DELETE_TOPIC) {
                    this.handleChatDelete(payload, participant);
                    return;
                }

                if (topic === LEAVE_TOPIC) {
                    this.handleParticipantLeave(payload, participant);
                }
            })
            .on(RoomEvent.Reconnecting, () => {
                this.reconnecting.set(true);
                this.connected.set(false);
            })
            .on(RoomEvent.Reconnected, () => {
                this.reconnecting.set(false);
                this.connected.set(true);
                this.reconnectAttempt = 0;
                void this.resumeMediaAfterBackground();
            })
            .on(RoomEvent.Disconnected, () => {
                this.connected.set(false);
                this.syncParticipants();

                if (!this.intentionalLeave) {
                    this.scheduleReconnect();
                }
            });

        return room;
    }

    private async finishConnectedSession(room: Room): Promise<void> {
        await room.startAudio();
        this.connected.set(true);
        this.reconnecting.set(false);
        this.reconnectAttempt = 0;
        this.localIdentity.set(room.localParticipant.identity);

        try {
            if (this.localMicDesired) {
                await this.enableLocalMicrophone(room);
            } else {
                await room.localParticipant.setMicrophoneEnabled(false);
                this.micEnabled.set(false);
            }
        } catch {
            // Mic error message is already shown; user can still listen and chat.
        }

        for (const participant of room.remoteParticipants.values()) {
            this.bindSpeakingListener(participant);
            this.applyRemoteVolume(participant);
        }

        this.bindSpeakingListener(room.localParticipant);
        this.startSpeakingPoll();
        this.startConnectionStatsPoll();
        this.syncParticipants();
        this.allowJoinSounds = true;
        this.registerPageUnloadHandler();
    }

    private scheduleReconnect(): void {
        this.clearReconnectTimer();

        if (this.intentionalLeave || !this.activeSession) {
            return;
        }

        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
            return;
        }

        const delay = Math.min(1000 * 2 ** this.reconnectAttempt, MAX_RECONNECT_DELAY_MS);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            void this.tryReconnect();
        }, delay);
    }

    private clearReconnectTimer(): void {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }

    private async tryReconnect(): Promise<void> {
        if (this.intentionalLeave || !this.activeSession) {
            return;
        }

        if (this.reconnectInFlight) {
            await this.reconnectInFlight;
            return;
        }

        this.reconnectInFlight = this.performReconnect();
        try {
            await this.reconnectInFlight;
        } finally {
            this.reconnectInFlight = null;
        }
    }

    private async performReconnect(): Promise<void> {
        let session = this.activeSession;
        if (!session || this.intentionalLeave) {
            return;
        }

        this.reconnecting.set(true);
        this.reconnectAttempt += 1;
        this.error.set(null);

        if (!this.room) {
            this.room = this.createRoom();
        }

        try {
            if (this.room.state !== ConnectionState.Connected) {
                await this.room.connect(session.livekitUrl, session.token);
            }

            await this.finishConnectedSession(this.room);
            return;
        } catch {
            // Пробуем обновить JWT и подключиться снова.
        }

        if (this.sessionRefreshHandler) {
            const refreshed = await this.sessionRefreshHandler();
            if (refreshed) {
                session = refreshed;
                this.activeSession = refreshed;
                this.localIdentity.set(refreshed.identity);
                this.localColorIndex = refreshed.colorIndex;

                try {
                    if (this.room.state !== ConnectionState.Disconnected) {
                        await this.room.disconnect(false);
                    }
                    await this.room.connect(refreshed.livekitUrl, refreshed.token);
                    await this.finishConnectedSession(this.room);
                    return;
                } catch (err) {
                    this.error.set(getLiveKitErrorMessage(err));
                }
            } else if (this.reconnectAttempt >= 2) {
                this.handleReconnectGiveUp();
                return;
            }
        } else if (this.reconnectAttempt >= 2) {
            this.handleReconnectGiveUp();
            return;
        }

        if (this.reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
            this.handleReconnectGiveUp();
            return;
        }

        this.reconnecting.set(false);
        this.scheduleReconnect();
    }

    private handleReconnectGiveUp(): void {
        this.clearReconnectTimer();
        this.reconnecting.set(false);
        this.error.set('Не удалось переподключиться. Войдите заново.');
        this.activeSession = null;
        void this.teardownRoomMedia();
        this.reconnectFailedHandler?.();
    }

    private async teardownRoomMedia(): Promise<void> {
        if (this.teardownInProgress) {
            return;
        }

        this.teardownInProgress = true;
        this.stopSpeakingPoll();
        this.stopConnectionStatsPoll();
        this.allowJoinSounds = false;
        this.unregisterPageUnloadHandler();

        const room = this.room;
        this.room = null;

        void this.publishLeaveNotice(room);
        if (room) {
            void room.disconnect().catch(() => undefined);
        }

        if (this.micAudioProcessor) {
            try {
                await this.micAudioProcessor.destroy();
            } catch {
                // ignore
            }
            this.micAudioProcessor = null;
        }

        this.noiseSuppressionLoading.set(false);
        this.noiseSuppressionActive.set(false);
        this.noiseSuppressionAttempted.set(false);
        this.connected.set(false);
        this.connecting.set(false);
        this.participants.set([]);
        this.teardownInProgress = false;
    }

    private async resumeMediaAfterBackground(): Promise<void> {
        const room = this.room;
        if (!room || room.state !== ConnectionState.Connected) {
            return;
        }

        try {
            await room.startAudio();
        } catch {
            // ignore
        }

        if (this.localMicDesired) {
            try {
                await this.enableLocalMicrophone(room);
            } catch {
                // Mic may stay blocked until user taps — error already set in enableLocalMicrophone.
            }
        } else if (room.localParticipant.isMicrophoneEnabled) {
            await room.localParticipant.setMicrophoneEnabled(false);
            this.micEnabled.set(false);
        }

        for (const participant of room.remoteParticipants.values()) {
            this.applyRemoteVolume(participant);
        }

        this.syncParticipants();
    }

    private attachAudioTrack(track: RemoteTrack, participant: Participant): void {
        if (track.kind !== Track.Kind.Audio || participant.isLocal) {
            return;
        }

        track.attach();
        this.applyRemoteVolume(participant);
    }

    private applyRemoteVolume(participant: Participant): void {
        if (participant.isLocal) {
            return;
        }

        const remote = participant as RemoteParticipant;
        const individual = this.volumeLevels.get(participant.identity) ?? 100;
        const effective = (individual * this.masterIncomingVolume) / 100;
        remote.setVolume(effective / 100);
    }

    private handleParticipantLeave(payload: Uint8Array, participant: Participant | undefined): void {
        if (!participant) {
            return;
        }

        try {
            const parsed = JSON.parse(this.textDecoder.decode(payload)) as {
                identity?: string;
            };
            const identity = parsed.identity?.trim() || participant.identity;
            this.cancelPendingParticipantHide(identity);
            this.hiddenParticipants.add(identity);
            this.volumeLevels.delete(identity);
            this.participantPreMute.delete(identity);
            this.syncParticipants();
        } catch {
            this.cancelPendingParticipantHide(participant.identity);
            this.hiddenParticipants.add(participant.identity);
            this.volumeLevels.delete(participant.identity);
            this.participantPreMute.delete(participant.identity);
            this.syncParticipants();
        }
    }

    private async publishLeaveNotice(room: Room | null = this.room): Promise<void> {
        if (!room || room.state !== ConnectionState.Connected) {
            return;
        }

        try {
            await room.localParticipant.publishData(
                this.textEncoder.encode(
                    JSON.stringify({ identity: room.localParticipant.identity }),
                ),
                {
                    reliable: true,
                    topic: LEAVE_TOPIC,
                },
            );
        } catch {
            // Уходим — канал мог уже закрыться.
        }
    }

    private async flushPageUnload(): Promise<void> {
        if (this.pageUnloadFlushed) {
            return;
        }

        this.pageUnloadFlushed = true;
        this.clearReconnectTimer();
        this.reconnectInFlight = null;
        this.reconnectAttempt = 0;
        this.reconnecting.set(false);

        const room = this.room;
        if (!room || room.state !== ConnectionState.Connected) {
            return;
        }

        void this.publishLeaveNotice(room);

        try {
            await Promise.race([
                room.disconnect(),
                new Promise<void>((resolve) => {
                    setTimeout(resolve, 250);
                }),
            ]);
        } catch {
            // ignore
        }
    }

    private registerPageUnloadHandler(): void {
        if (this.pageUnloadHandlerRegistered || typeof window === 'undefined') {
            return;
        }

        window.addEventListener('pagehide', this.onPageHide);
        this.pageUnloadHandlerRegistered = true;
    }

    private unregisterPageUnloadHandler(): void {
        if (!this.pageUnloadHandlerRegistered || typeof window === 'undefined') {
            return;
        }

        window.removeEventListener('pagehide', this.onPageHide);
        this.pageUnloadHandlerRegistered = false;
    }

    private readonly onPageHide = (event: PageTransitionEvent): void => {
        if (event.persisted) {
            return;
        }

        void this.flushPageUnload();
    };

    private schedulePendingParticipantHide(identity: string): void {
        this.cancelPendingParticipantHide(identity);

        const timer = setTimeout(() => {
            this.pendingParticipantHideTimers.delete(identity);

            const room = this.room;
            if (!room?.remoteParticipants.has(identity)) {
                return;
            }

            this.hiddenParticipants.add(identity);
            this.syncParticipants();
        }, 750);

        this.pendingParticipantHideTimers.set(identity, timer);
    }

    private cancelPendingParticipantHide(identity: string): void {
        const timer = this.pendingParticipantHideTimers.get(identity);
        if (!timer) {
            return;
        }

        clearTimeout(timer);
        this.pendingParticipantHideTimers.delete(identity);
    }

    private clearPendingParticipantHideTimers(): void {
        for (const timer of this.pendingParticipantHideTimers.values()) {
            clearTimeout(timer);
        }

        this.pendingParticipantHideTimers.clear();
    }

    private handleChatMessage(payload: Uint8Array, participant: Participant | undefined): void {
        const room = this.room;
        if (!participant || !room) {
            return;
        }

        if (participant.identity === room.localParticipant.identity) {
            return;
        }

        try {
            const parsed = JSON.parse(this.textDecoder.decode(payload)) as {
                id?: string;
                text?: string;
                sentAt?: string;
            };
            const messageId = parsed.id || `${Date.now()}-${participant.identity}`;
            if (this.messages().some((item) => item.id === messageId)) {
                return;
            }

            const text = parsed.text?.trim();
            if (!text) {
                return;
            }

            this.addMessage({
                id: messageId,
                author: participant.name || participant.identity,
                authorIdentity: participant.identity,
                text: text.slice(0, 500),
                sentAt: parsed.sentAt ? new Date(parsed.sentAt) : new Date(),
                isLocal: false,
            });
        } catch {
            // Ignore malformed data messages from other clients.
        }
    }

    private handleChatDelete(payload: Uint8Array, participant: Participant | undefined): void {
        if (!participant) {
            return;
        }

        try {
            const parsed = JSON.parse(this.textDecoder.decode(payload)) as {
                id?: string;
            };
            if (!parsed.id) {
                return;
            }

            const message = this.messages().find((item) => item.id === parsed.id);
            if (!message || message.authorIdentity !== participant.identity) {
                return;
            }

            this.removeMessage(parsed.id);
        } catch {
            // Ignore malformed delete messages.
        }
    }

    private addMessage(message: ChatMessage): void {
        let added = false;

        this.messages.update((messages) => {
            if (messages.some((item) => item.id === message.id)) {
                return messages;
            }

            added = true;
            return [...messages, message].slice(-100);
        });

        if (added && !message.isLocal) {
            this.uiSound.playChatMessage();
        }
    }

    private removeMessage(messageId: string): void {
        this.messages.update((messages) => messages.filter((message) => message.id !== messageId));
    }

    /** Единый снимок для UI; LiveKit события приходят по одному полю. */
    private syncParticipants(): void {
        const room = this.room;
        if (!room) {
            return;
        }

        const activeSpeakerIds = new Set(room.activeSpeakers.map((speaker) => speaker.identity));

        const views: ParticipantView[] = [
            this.toView(room.localParticipant, true, activeSpeakerIds),
            ...[...room.remoteParticipants.values()]
                .filter((participant) => this.isParticipantVisible(participant))
                .map((participant) => this.toView(participant, false, activeSpeakerIds)),
        ];

        views.sort((a, b) => {
            if (a.isLocal) {
                return -1;
            }
            if (b.isLocal) {
                return 1;
            }
            return a.displayName.localeCompare(b.displayName, 'ru');
        });

        this.participants.set(views);
    }

    private isParticipantVisible(participant: Participant): boolean {
        if (this.hiddenParticipants.has(participant.identity)) {
            return false;
        }

        return participant.connectionQuality !== ConnectionQuality.Lost;
    }

    private toView(
        participant: Participant,
        isLocal: boolean,
        activeSpeakerIds: Set<string>,
    ): ParticipantView {
        const colorIndex = this.resolveColorIndex(participant, isLocal);

        return {
            identity: participant.identity,
            displayName: participant.name || participant.identity,
            isLocal,
            micEnabled: this.resolveMicEnabled(participant, isLocal),
            isSpeaking: this.isParticipantSpeaking(participant, activeSpeakerIds, isLocal),
            listenVolume: isLocal
                ? this.masterIncomingVolume
                : (this.volumeLevels.get(participant.identity) ?? 100),
            colorIndex,
            color: getPlayerColorHex(colorIndex),
            ...this.buildSignalView(participant, isLocal),
        };
    }

    private buildSignalView(participant: Participant, isLocal: boolean) {
        const quality = participant.connectionQuality;
        const bars = connectionQualityBars(quality);
        const stats = isLocal ? this.localConnectionStats : null;

        return {
            signalBars: bars,
            signalTone: connectionQualityTone(bars),
            signalTooltip: buildSignalTooltipView(
                isLocal ? 'Ваш сигнал' : participant.name || participant.identity,
                quality,
                isLocal,
                stats,
            ),
        };
    }

    private resolveColorIndex(participant: Participant, isLocal: boolean): number {
        if (isLocal) {
            return this.localColorIndex;
        }

        const metadataColor = readColorIndex(participant.metadata);
        if (metadataColor !== null) {
            return metadataColor;
        }

        let hash = 0;
        for (const char of participant.identity) {
            hash = (hash + char.charCodeAt(0)) % 5;
        }

        return hash;
    }

    private resolveMicEnabled(participant: Participant, isLocal: boolean): boolean {
        if (isLocal) {
            return this.micEnabled();
        }

        if (!participant.isMicrophoneEnabled) {
            return false;
        }

        const publication = participant.getTrackPublication(Track.Source.Microphone);
        if (!publication || publication.isMuted) {
            return false;
        }

        const audioTrack = publication.audioTrack;
        return Boolean(audioTrack && !audioTrack.isMuted);
    }

    private updateLocalMicFromPublication(
        publication: { source: Track.Source },
        participant: Participant,
        enabled: boolean,
    ): void {
        if (!participant.isLocal || publication.source !== Track.Source.Microphone) {
            return;
        }

        if (enabled && !this.localMicDesired) {
            return;
        }

        this.micEnabled.set(enabled);
    }

    /** LiveKit иногда шлёт unmute локального трека — не включаем мик без явного действия пользователя. */
    private async handleLocalTrackUnmuted(
        publication: { source: Track.Source },
        participant: Participant,
    ): Promise<void> {
        const room = this.room;
        if (!room || !participant.isLocal || publication.source !== Track.Source.Microphone) {
            this.syncParticipants();
            return;
        }

        if (!this.localMicDesired) {
            try {
                await room.localParticipant.setMicrophoneEnabled(false);
            } catch {
                // ignore
            }
            this.micEnabled.set(false);
        } else {
            this.micEnabled.set(true);
        }

        this.syncParticipants();
    }

    private bindSpeakingListener(participant: Participant): void {
        if (this.speakingBound.has(participant)) {
            return;
        }

        this.speakingBound.add(participant);
        participant.on(ParticipantEvent.IsSpeakingChanged, () => this.syncParticipants());
    }

    private isParticipantSpeaking(
        participant: Participant,
        activeSpeakerIds: Set<string>,
        isLocal: boolean,
    ): boolean {
        if (!this.resolveMicEnabled(participant, isLocal)) {
            return false;
        }

        if (activeSpeakerIds.has(participant.identity)) {
            return true;
        }

        if (participant.isSpeaking) {
            return true;
        }

        return participant.audioLevel >= SPEAKING_AUDIO_LEVEL;
    }

    private startSpeakingPoll(): void {
        this.stopSpeakingPoll();
        this.speakingPollTimer = setInterval(() => {
            if (!this.room) {
                return;
            }

            this.syncParticipants();
        }, 80);
    }

    private stopSpeakingPoll(): void {
        if (this.speakingPollTimer) {
            clearInterval(this.speakingPollTimer);
            this.speakingPollTimer = null;
        }
    }

    private startConnectionStatsPoll(): void {
        this.stopConnectionStatsPoll();
        void this.refreshLocalConnectionStats();
        this.connectionStatsTimer = setInterval(() => {
            void this.refreshLocalConnectionStats();
        }, 2000);
    }

    private stopConnectionStatsPoll(): void {
        if (this.connectionStatsTimer) {
            clearInterval(this.connectionStatsTimer);
            this.connectionStatsTimer = null;
        }
        this.localConnectionStats = { rttMs: null, packetLossPercent: null };
    }

    private async refreshLocalConnectionStats(): Promise<void> {
        const room = this.room;
        if (!room || room.state !== ConnectionState.Connected) {
            return;
        }

        const publication = room.localParticipant.getTrackPublication(Track.Source.Microphone);
        const track = publication?.audioTrack as LocalAudioTrack | undefined;
        if (!track) {
            return;
        }

        try {
            const report = await track.getRTCStatsReport();
            if (!report) {
                return;
            }

            let rttMs: number | null = null;
            let packetLossPercent: number | null = null;

            report.forEach((stat) => {
                if (stat.type === 'candidate-pair' && 'currentRoundTripTime' in stat) {
                    const rtt = (stat as RTCStats & { currentRoundTripTime?: number })
                        .currentRoundTripTime;
                    if (typeof rtt === 'number' && rtt > 0) {
                        rttMs = Math.round(rtt * 1000);
                    }
                }

                if (stat.type === 'outbound-rtp' && 'kind' in stat && stat.kind === 'audio') {
                    const packetsSent = (stat as RTCStats & { packetsSent?: number }).packetsSent;
                    const packetsLost = (stat as RTCStats & { packetsLost?: number }).packetsLost;
                    if (
                        typeof packetsSent === 'number' &&
                        typeof packetsLost === 'number' &&
                        packetsSent + packetsLost > 0
                    ) {
                        packetLossPercent = Math.round(
                            (packetsLost / (packetsSent + packetsLost)) * 100,
                        );
                    }
                }
            });

            const changed =
                this.localConnectionStats.rttMs !== rttMs ||
                this.localConnectionStats.packetLossPercent !== packetLossPercent;

            if (changed) {
                this.localConnectionStats = { rttMs, packetLossPercent };
                this.syncParticipants();
            }
        } catch {
            // Stats unavailable in some browsers or while reconnecting.
        }
    }

    private async enableLocalMicrophone(room: Room): Promise<void> {
        try {
            this.noiseSuppressionLoading.set(this.noiseSuppressionEnabled());
            await room.localParticipant.setMicrophoneEnabled(true, this.buildCaptureOptions());
            await this.setupLocalMicProcessor(room);
            this.micEnabled.set(true);
            this.error.set(null);
        } catch (err) {
            this.micEnabled.set(false);
            this.error.set(getMicErrorMessage(err));
            throw err;
        } finally {
            this.noiseSuppressionLoading.set(false);
        }
    }

    private buildCaptureOptions() {
        const useBrowserNs =
            !this.noiseSuppressionEnabled() ||
            (this.micAudioProcessor !== null && !this.micAudioProcessor.isNoiseSuppressionActive());

        return {
            echoCancellation: true,
            autoGainControl: true,
            noiseSuppression: useBrowserNs,
        };
    }

    private async rebuildMicProcessor(): Promise<void> {
        const room = this.room;
        if (!room || !room.localParticipant.isMicrophoneEnabled) {
            return;
        }

        this.noiseSuppressionLoading.set(this.noiseSuppressionEnabled());
        try {
            await this.clearMicProcessor(room);
            await room.localParticipant.setMicrophoneEnabled(true, this.buildCaptureOptions());
            await this.setupLocalMicProcessor(room);
            await room.startAudio();
        } finally {
            this.noiseSuppressionLoading.set(false);
        }
    }

    private async clearMicProcessor(room: Room): Promise<void> {
        const publication = room.localParticipant.getTrackPublication(Track.Source.Microphone);
        const track = publication?.audioTrack as LocalAudioTrack | undefined;
        if (track) {
            await track.stopProcessor();
        }

        if (this.micAudioProcessor) {
            await this.micAudioProcessor.destroy();
            this.micAudioProcessor = null;
        }

        this.noiseSuppressionActive.set(false);
        this.noiseSuppressionAttempted.set(false);
    }

    private async setupLocalMicProcessor(room: Room): Promise<void> {
        const publication = room.localParticipant.getTrackPublication(Track.Source.Microphone);
        const track = publication?.audioTrack as LocalAudioTrack | undefined;
        if (!track || track.isMuted) {
            this.noiseSuppressionAttempted.set(false);
            return;
        }

        if (!this.micAudioProcessor) {
            this.micAudioProcessor = new MicAudioProcessor();
        }

        this.micAudioProcessor.setNoiseSuppressionEnabled(this.noiseSuppressionEnabled());
        if (this.noiseSuppressionEnabled()) {
            this.noiseSuppressionAttempted.set(true);
        }

        await track.setProcessor(this.micAudioProcessor as never);
        this.micAudioProcessor.setVolume(this.localMicVolume);
        this.noiseSuppressionActive.set(this.micAudioProcessor.isNoiseSuppressionActive());
    }

    private setOptimisticLocalParticipant(session: JoinSession): void {
        this.participants.set([
            {
                identity: session.identity,
                displayName: session.displayName,
                isLocal: true,
                micEnabled: this.micEnabled(),
                isSpeaking: false,
                listenVolume: this.masterIncomingVolume,
                colorIndex: session.colorIndex,
                color: getPlayerColorHex(session.colorIndex),
                signalBars: 0,
                signalTone: 'muted',
                signalTooltip: {
                    title: 'Ваш сигнал',
                    qualityLabel: 'Подключение…',
                    tone: 'muted',
                },
            },
        ]);
    }
}
