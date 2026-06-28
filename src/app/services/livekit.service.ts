import { Injectable, signal } from '@angular/core';
import {
    LocalAudioTrack,
    Participant,
    RemoteParticipant,
    RemoteTrack,
    Room,
    RoomEvent,
    Track,
} from 'livekit-client';
import { JoinSession } from '../models/join.model';
import { MicGainProcessor } from './mic-gain-processor';

const CHAT_TOPIC = 'chat-message';
const CHAT_DELETE_TOPIC = 'chat-delete';

export interface ParticipantView {
    identity: string;
    displayName: string;
    isLocal: boolean;
    micEnabled: boolean;
    isSpeaking: boolean;
    volume: number;
}

export interface ChatMessage {
    id: string;
    author: string;
    authorIdentity: string;
    text: string;
    sentAt: Date;
    isLocal: boolean;
}

@Injectable({ providedIn: 'root' })
export class LiveKitService {
    private room: Room | null = null;
    private readonly volumeLevels = new Map<string, number>();
    private localMicVolume = 100;
    private micGainProcessor: MicGainProcessor | null = null;
    private readonly textEncoder = new TextEncoder();
    private readonly textDecoder = new TextDecoder();

    readonly participants = signal<ParticipantView[]>([]);
    readonly messages = signal<ChatMessage[]>([]);
    readonly connected = signal(false);
    readonly connecting = signal(false);
    readonly micEnabled = signal(true);
    readonly error = signal<string | null>(null);
    readonly localIdentity = signal<string | null>(null);

    async connect(session: JoinSession): Promise<void> {
        if (this.room) {
            return;
        }

        this.connecting.set(true);
        this.error.set(null);
        this.setOptimisticLocalParticipant(session);

        const room = new Room({
            adaptiveStream: false,
            dynacast: false,
            webAudioMix: true,
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
            .on(RoomEvent.ActiveSpeakersChanged, () => this.syncParticipants())
            .on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
                this.attachAudioTrack(track, participant);
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
            .on(RoomEvent.Disconnected, () => {
                this.connected.set(false);
                this.syncParticipants();
            });

        try {
            await room.connect(session.livekitUrl, session.token);
            await room.startAudio();
            await room.localParticipant.setMicrophoneEnabled(true);
            await this.setupLocalMicGain(room);

            this.room = room;
            this.connected.set(true);
            this.micEnabled.set(true);
            this.localIdentity.set(room.localParticipant.identity);

            for (const participant of room.remoteParticipants.values()) {
                this.applyRemoteVolume(participant);
            }

            this.syncParticipants();
        } catch (err) {
            const message =
                err instanceof Error ? err.message : 'Не удалось подключиться к комнате.';
            this.error.set(message);
            this.participants.set([]);
            room.disconnect();
            throw err;
        } finally {
            this.connecting.set(false);
        }
    }

    async toggleMic(): Promise<void> {
        const room = this.room;
        if (!room) {
            return;
        }

        const next = !this.micEnabled();
        await room.localParticipant.setMicrophoneEnabled(next);
        if (next) {
            await this.setupLocalMicGain(room);
        }
        this.micEnabled.set(next);
        this.syncParticipants();
    }

    setLocalMicVolume(volumePercent: number): void {
        const clamped = Math.max(0, Math.min(200, Math.round(volumePercent)));
        this.localMicVolume = clamped;
        this.micGainProcessor?.setVolume(clamped);
        this.syncParticipants();
    }

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
        if (message?.authorIdentity !== room.localParticipant.identity) {
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

    setParticipantVolume(identity: string, volumePercent: number): void {
        const clamped = Math.max(0, Math.min(200, Math.round(volumePercent)));
        this.volumeLevels.set(identity, clamped);

        const remote = this.room?.remoteParticipants.get(identity);
        if (remote) {
            remote.setVolume(clamped / 100);
        }

        this.syncParticipants();
    }

    disconnect(): void {
        this.room?.disconnect();
        this.room = null;
        this.volumeLevels.clear();
        this.localMicVolume = 100;
        this.micGainProcessor = null;
        this.messages.set([]);
        this.connected.set(false);
        this.connecting.set(false);
        this.micEnabled.set(true);
        this.localIdentity.set(null);
        this.participants.set([]);
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
            const text = parsed.text?.trim();
            if (!text) {
                return;
            }

            this.addMessage({
                id: parsed.id || `${Date.now()}-${participant.identity}`,
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
        return {
            identity: participant.identity,
            displayName: participant.name || participant.identity,
            isLocal,
            micEnabled: isLocal ? this.micEnabled() : participant.isMicrophoneEnabled,
            isSpeaking: activeSpeakerIds.has(participant.identity),
            volume: isLocal
                ? this.localMicVolume
                : (this.volumeLevels.get(participant.identity) ?? 100),
        };
    }

    private async setupLocalMicGain(room: Room): Promise<void> {
        const publication = room.localParticipant.getTrackPublication(Track.Source.Microphone);
        const track = publication?.audioTrack as LocalAudioTrack | undefined;
        if (!track || track.isMuted) {
            return;
        }

        if (!this.micGainProcessor) {
            this.micGainProcessor = new MicGainProcessor();
            await track.setProcessor(this.micGainProcessor as never);
        }

        this.micGainProcessor.setVolume(this.localMicVolume);
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
            },
        ]);
    }
}
