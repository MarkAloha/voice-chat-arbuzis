import { Component, OnDestroy, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MicIconComponent } from '../../components/mic-icon/mic-icon';
import { JoinService } from '../../services/join.service';
import { LiveKitService, ParticipantView } from '../../services/livekit.service';

@Component({
  selector: 'app-room',
  imports: [DatePipe, FormsModule, MicIconComponent],
  templateUrl: './room.html',
  styleUrl: './room.scss',
})
export class RoomComponent implements OnDestroy {
  private readonly joinService = inject(JoinService);
  private readonly liveKit = inject(LiveKitService);
  private readonly router = inject(Router);

  protected readonly participants = this.liveKit.participants;
  protected readonly connected = this.liveKit.connected;
  protected readonly connecting = this.liveKit.connecting;
  protected readonly micEnabled = this.liveKit.micEnabled;
  protected readonly error = this.liveKit.error;
  protected readonly messages = this.liveKit.messages;
  protected messageText = '';

  constructor() {
    const session = this.joinService.session();
    if (!session) {
      return;
    }

    void this.liveKit.connect(session).catch(() => undefined);
  }

  ngOnDestroy(): void {
    this.liveKit.disconnect();
    this.joinService.clear();
  }

  protected toggleMic(): void {
    void this.liveKit.toggleMic();
  }

  protected leaveRoom(): void {
    this.liveKit.disconnect();
    this.joinService.clear();
    void this.router.navigateByUrl('/login');
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
}
