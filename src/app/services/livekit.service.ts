import { Injectable, signal } from '@angular/core';
import {
  Participant,
  RemoteTrack,
  Room,
  RoomEvent,
  Track,
} from 'livekit-client';
import { JoinSession } from '../models/join.model';
export interface ParticipantView {
  identity: string;
  displayName: string;
  isLocal: boolean;
  micEnabled: boolean;
  isSpeaking: boolean;
}

@Injectable({ providedIn: 'root' })
export class LiveKitService {
  private room: Room | null = null;

  readonly participants = signal<ParticipantView[]>([]);
  readonly connected = signal(false);
  readonly connecting = signal(false);
  readonly micEnabled = signal(true);
  readonly error = signal<string | null>(null);

  async connect(session: JoinSession): Promise<void> {
    if (this.room) {
      return;
    }

    this.connecting.set(true);
    this.error.set(null);

    const room = new Room({
      adaptiveStream: false,
      dynacast: false,
    });

    room
      .on(RoomEvent.ParticipantConnected, () => this.syncParticipants())
      .on(RoomEvent.ParticipantDisconnected, () => this.syncParticipants())
      .on(RoomEvent.TrackMuted, () => this.syncParticipants())
      .on(RoomEvent.TrackUnmuted, () => this.syncParticipants())
      .on(RoomEvent.ActiveSpeakersChanged, () => this.syncParticipants())
      .on(RoomEvent.TrackSubscribed, (track) => {
        this.attachAudioTrack(track);
      })
      .on(RoomEvent.TrackUnsubscribed, (track) => {
        track.detach();
      })
      .on(RoomEvent.Disconnected, () => {
        this.connected.set(false);
        this.syncParticipants();
      });

    try {
      await room.connect(session.livekitUrl, session.token);
      await room.startAudio();
      await room.localParticipant.setMicrophoneEnabled(true);
      this.room = room;
      this.connected.set(true);
      this.micEnabled.set(true);
      this.syncParticipants();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Не удалось подключиться к комнате.';
      this.error.set(message);
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
    this.micEnabled.set(next);
    this.syncParticipants();
  }

  disconnect(): void {
    this.room?.disconnect();
    this.room = null;
    this.connected.set(false);
    this.connecting.set(false);
    this.micEnabled.set(true);
    this.participants.set([]);
  }

  private attachAudioTrack(track: RemoteTrack): void {
    if (track.kind === Track.Kind.Audio) {
      track.attach();
    }
  }

  private syncParticipants(): void {    const room = this.room;
    if (!room) {
      this.participants.set([]);
      return;
    }

    const activeSpeakerIds = new Set(
      room.activeSpeakers.map((speaker) => speaker.identity),
    );

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
    const micPublication = participant.getTrackPublication(Track.Source.Microphone);

    return {
      identity: participant.identity,
      displayName: participant.name || participant.identity,
      isLocal,
      micEnabled: micPublication ? !micPublication.isMuted : false,
      isSpeaking: activeSpeakerIds.has(participant.identity),
    };
  }
}
