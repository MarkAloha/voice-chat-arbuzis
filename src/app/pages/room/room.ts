import { Component, OnDestroy, effect, inject, signal, viewChild, ElementRef } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MicIconComponent } from '../../components/mic-icon/mic-icon';
import { JoinService } from '../../services/join.service';
import { LiveKitService } from '../../services/livekit.service';
import { ChatMessage } from '../../models/chat.model';
import { ParticipantView } from '../../models/participant.model';

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
    protected readonly localIdentity = this.liveKit.localIdentity;
    protected messageText = '';
    protected readonly disconnecting = signal(false);
    private readonly messagesContainer = viewChild<ElementRef<HTMLElement>>('messagesContainer');
    private leaveTimeout: ReturnType<typeof setTimeout> | null = null;

    constructor() {
        const session = this.joinService.session();
        if (!session) {
            return;
        }

        void this.liveKit.connect(session).catch(() => undefined);

        effect(() => {
            this.messages();
            queueMicrotask(() => this.scrollChatToBottom());
        });
    }

    ngOnDestroy(): void {
        if (this.leaveTimeout) {
            clearTimeout(this.leaveTimeout);
        }

        this.liveKit.disconnect();
        this.joinService.clear();
    }

    protected toggleMic(): void {
        void this.liveKit.toggleMic();
    }

    protected leaveRoom(): void {
        if (this.disconnecting()) {
            return;
        }

        this.disconnecting.set(true);

        this.leaveTimeout = setTimeout(() => {
            this.leaveTimeout = null;
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

    protected canDeleteMessage(message: ChatMessage): boolean {
        const identity = this.localIdentity();
        return identity !== null && message.authorIdentity === identity;
    }

    private scrollChatToBottom(): void {
        const element = this.messagesContainer()?.nativeElement;
        if (!element) {
            return;
        }

        element.scrollTop = element.scrollHeight;
    }
}
