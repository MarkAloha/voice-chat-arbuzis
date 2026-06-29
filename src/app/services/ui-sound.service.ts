import { Injectable, inject } from '@angular/core';
import { AudioSettingsService } from './audio-settings.service';

/** Короткие звуки интерфейса — Web Audio, без отдельных файлов. */
@Injectable({ providedIn: 'root' })
export class UiSoundService {
    private readonly audioSettings = inject(AudioSettingsService);
    private context: AudioContext | null = null;

    playMicOn(): void {
        this.playToneSequence([
            { frequency: 520, duration: 0.06, delay: 0 },
            { frequency: 780, duration: 0.09, delay: 0.05 },
        ]);
    }

    playMicOff(): void {
        this.playToneSequence([
            { frequency: 620, duration: 0.07, delay: 0 },
            { frequency: 360, duration: 0.11, delay: 0.04 },
        ]);
    }

    playParticipantJoined(): void {
        this.playToneSequence([
            { frequency: 660, duration: 0.07, delay: 0 },
            { frequency: 880, duration: 0.09, delay: 0.06 },
            { frequency: 990, duration: 0.12, delay: 0.12 },
        ]);
    }

    private playToneSequence(
        tones: Array<{ frequency: number; duration: number; delay: number }>,
    ): void {
        if (!this.audioSettings.uiSounds()) {
            return;
        }

        const context = this.getContext();
        if (!context) {
            return;
        }

        const startAt = context.currentTime;
        for (const tone of tones) {
            this.scheduleTone(context, startAt + tone.delay, tone.frequency, tone.duration);
        }
    }

    private scheduleTone(
        context: AudioContext,
        when: number,
        frequency: number,
        duration: number,
    ): void {
        const oscillator = context.createOscillator();
        const gain = context.createGain();

        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(frequency, when);

        gain.gain.setValueAtTime(0.0001, when);
        gain.gain.exponentialRampToValueAtTime(0.12, when + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);

        oscillator.connect(gain);
        gain.connect(context.destination);

        oscillator.start(when);
        oscillator.stop(when + duration + 0.02);
    }

    private getContext(): AudioContext | null {
        if (typeof AudioContext === 'undefined') {
            return null;
        }

        if (!this.context || this.context.state === 'closed') {
            this.context = new AudioContext();
        }

        if (this.context.state === 'suspended') {
            void this.context.resume();
        }

        return this.context;
    }
}
