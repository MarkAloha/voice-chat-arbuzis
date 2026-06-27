import { Component, OnDestroy, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { JoinService } from '../../services/join.service';
import { LiveKitService } from '../../services/livekit.service';

@Component({
  selector: 'app-room',
  imports: [DatePipe, FormsModule],
  templateUrl: './room.html',
  styleUrl: './room.scss',
})
export class RoomComponent implements OnDestroy {
  private readonly joinService = inject(JoinService);
  private readonly liveKit = inject(LiveKitService);

  protected readonly participants = this.liveKit.participants;
  protected readonly connected = this.liveKit.connected;
  protected readonly connecting = this.liveKit.connecting;
  protected readonly micEnabled = this.liveKit.micEnabled;
  protected readonly error = this.liveKit.error;
  protected readonly messages = this.liveKit.messages;
  protected readonly displayName = signal('');
  protected messageText = '';

  constructor() {
    const session = this.joinService.session();
    if (!session) {
      return;
    }

    this.displayName.set(session.displayName);
    void this.liveKit.connect(session).catch(() => undefined);
  }

  ngOnDestroy(): void {
    this.liveKit.disconnect();
    this.joinService.clear();
  }

  protected toggleMic(): void {
    void this.liveKit.toggleMic();
  }

  protected setVolume(identity: string, value: number): void {
    this.liveKit.setParticipantVolume(identity, value);
  }

  protected sendMessage(): void {
    const text = this.messageText;
    this.messageText = '';
    void this.liveKit.sendMessage(text);
  }
}
