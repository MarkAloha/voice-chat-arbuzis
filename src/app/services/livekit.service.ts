import { Injectable, inject, signal } from '@angular/core';
import {
    ConnectionState,
    LocalAudioTrack,
    Participant,
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
import { getMicErrorMessage } from '../utils/mic-error-message';
import { getPlayerColorHex, readColorIndex } from '../../shared/participant-colors';

const CHAT_TOPIC = 'chat-message';
const CHAT_DELETE_TOPIC = 'chat-delete';
const MAX_RECONNECT_DELAY_MS = 10_000;
const MAX_RECONNECT_ATTEMPTS = 8;

export type SessionRefreshHandler = () => Promise<JoinSession | null>;
export type ReconnectFailedHandler = () => void;

@Injectable({ providedIn: 'root' })
export class LiveKitService {
    private readonly audioSettings = inject(AudioSettingsService);
    private room: Room | null = null;
    private activeSession: JoinSession | null = null;
    private sessionRefreshHandler: SessionRefreshHandler | null = null;
    private reconnectFailedHandler: ReconnectFailedHandler | null = null;
    private intentionalLeave = false;
    private reconnectAttempt = 0;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private reconnectInFlight: Promise<void> | null = null;
    private readonly volumeLevels = new Map<string, number>();
    private localMicVolume = 100;
    private micAudioProcessor: MicAudioProcessor | null = null;
    private localColorIndex = 0;
    private micWasEnabledBeforeDisconnect = true;
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
        void this.teardownRoomMedia();
    }

    /** Подключение к комнате; микрофон отдельно — отказ в mic не рвёт сессию. */
    async connect(session: JoinSession): Promise<void> {
        this.intentionalLeave = false;
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
            const message =
                err instanceof Error ? err.message : 'Не удалось подключиться к комнате.';
            this.error.set(message);
            this.participants.set([]);
            await this.teardownRoomMedia();
            throw err;
        } finally {
            this.connecting.set(false);
        }
    }

    /** Явный выход — не пытаться переподключаться. */
    disconnect(): void {
        this.intentionalLeave = true;
        this.clearReconnectTimer();
        this.reconnectInFlight = null;
        this.reconnectAttempt = 0;
        this.reconnecting.set(false);
        this.activeSession = null;

        void this.teardownRoomMedia();
        this.volumeLevels.clear();
        this.localMicVolume = 100;
        this.micAudioProcessor = null;
        this.noiseSuppressionLoading.set(false);
        this.noiseSuppressionActive.set(false);
        this.noiseSuppressionAttempted.set(false);
        this.messages.set([]);
        this.connected.set(false);
        this.connecting.set(false);
        this.micEnabled.set(true);
        this.localIdentity.set(null);
        this.localColorIndex = 0;
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
            try {
                await this.enableLocalMicrophone(room);
            } catch (err) {
                this.error.set(getMicErrorMessage(err));
                this.syncParticipants();
            }
            return;
        }

        await room.localParticipant.setMicrophoneEnabled(false);
        this.micEnabled.set(false);
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

    /** Громкость только локально у слушателя; на исходящий поток других не влияет. */
    setParticipantVolume(identity: string, volumePercent: number): void {
        const clamped = Math.max(0, Math.min(200, Math.round(volumePercent)));
        this.volumeLevels.set(identity, clamped);

        const remote = this.room?.remoteParticipants.get(identity);
        if (remote) {
            remote.setVolume(clamped / 100);
        }

        this.syncParticipants();
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
            this.applyRemoteVolume(participant);
            this.syncParticipants();
        })
            .on(RoomEvent.ParticipantDisconnected, (participant) => {
                this.volumeLevels.delete(participant.identity);
                this.syncParticipants();
            })
            .on(RoomEvent.TrackMuted, () => this.syncParticipants())
            .on(RoomEvent.TrackUnmuted, () => this.syncParticipants())
            .on(RoomEvent.TrackPublished, () => this.syncParticipants())
            .on(RoomEvent.TrackUnpublished, () => this.syncParticipants())
            .on(RoomEvent.ParticipantMetadataChanged, () => this.syncParticipants())
            .on(RoomEvent.ActiveSpeakersChanged, () => this.syncParticipants())
            .on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
                this.attachAudioTrack(track, participant);
                this.syncParticipants();
            })
            .on(RoomEvent.TrackUnsubscribed, (track) => {
                track.detach();
            })
            .on(RoomEvent.DataReceived, (payload, participant, _kind, topic) => {
                if (topic === CHAT_TOPIC) {
                    this.handleChatMessage(payload, participant);
                    return;
                }

                if (topic === CHAT_DELETE_TOPIC) {
                    this.handleChatDelete(payload, participant);
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
                this.micWasEnabledBeforeDisconnect = this.micEnabled();
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
            await this.enableLocalMicrophone(room);
        } catch {
            // Mic error message is already shown; user can still listen and chat.
        }

        for (const participant of room.remoteParticipants.values()) {
            this.applyRemoteVolume(participant);
        }

        this.syncParticipants();
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
                    const message =
                        err instanceof Error
                            ? err.message
                            : 'Не удалось переподключиться к комнате.';
                    this.error.set(message);
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
        if (this.micAudioProcessor) {
            await this.micAudioProcessor.destroy();
            this.micAudioProcessor = null;
        }

        this.noiseSuppressionLoading.set(false);
        this.noiseSuppressionActive.set(false);
        this.noiseSuppressionAttempted.set(false);

        const room = this.room;
        this.room = null;

        if (room) {
            try {
                await room.disconnect();
            } catch {
                // ignore
            }
        }

        this.connected.set(false);
        this.connecting.set(false);
        this.participants.set([]);
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

        if (this.micWasEnabledBeforeDisconnect || this.micEnabled()) {
            try {
                await this.enableLocalMicrophone(room);
            } catch {
                // Mic may stay blocked until user taps — error already set in enableLocalMicrophone.
            }
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
        const volumePercent = this.volumeLevels.get(participant.identity) ?? 100;
        remote.setVolume(volumePercent / 100);
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
        this.messages.update((messages) => {
            if (messages.some((item) => item.id === message.id)) {
                return messages;
            }

            return [...messages, message].slice(-100);
        });
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

        this.micEnabled.set(room.localParticipant.isMicrophoneEnabled);

        const views: ParticipantView[] = [
            this.toView(room.localParticipant, true, activeSpeakerIds),
            ...[...room.remoteParticipants.values()].map((participant) =>
                this.toView(participant, false, activeSpeakerIds),
            ),
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
            isSpeaking: activeSpeakerIds.has(participant.identity),
            volume: isLocal
                ? this.localMicVolume
                : (this.volumeLevels.get(participant.identity) ?? 100),
            colorIndex,
            color: getPlayerColorHex(colorIndex),
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

        const publication = participant.getTrackPublication(Track.Source.Microphone);
        if (!publication) {
            return false;
        }

        return !publication.isMuted;
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
                volume: this.localMicVolume,
                colorIndex: session.colorIndex,
                color: getPlayerColorHex(session.colorIndex),
            },
        ]);
    }
}
