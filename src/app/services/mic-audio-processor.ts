import { MicGainProcessorOptions, MicGainTrackProcessor } from '../types/mic-gain.types';
import { createNoiseSuppressionWorklet } from './noise-suppression-loader';

const NOISE_SUPPRESSION_WORKLET_URL = '/assets/audio-worklet-processor.js';

/** DTLN (lazy) + gain; при сбое DTLN — fallback на gain через AudioContext LiveKit. */
export class MicAudioProcessor implements MicGainTrackProcessor {
    readonly name = 'mic-audio';

    processedTrack?: MediaStreamTrack;

    private gainNode?: GainNode;
    private source?: MediaStreamAudioSourceNode;
    private destination?: MediaStreamAudioDestinationNode;
    private audioContext?: AudioContext;
    /** DTLN создаёт свой контекст; gain-only использует AudioContext LiveKit — его нельзя закрывать. */
    private ownsAudioContext = false;
    private workletHandle?: Awaited<ReturnType<typeof createNoiseSuppressionWorklet>>;
    private noiseSuppressionEnabled = true;
    private noiseSuppressionActive = false;

    isNoiseSuppressionActive(): boolean {
        return this.noiseSuppressionActive;
    }

    setNoiseSuppressionEnabled(enabled: boolean): void {
        this.noiseSuppressionEnabled = enabled;
    }

    async init(options: MicGainProcessorOptions): Promise<void> {
        await this.destroy();

        if (this.noiseSuppressionEnabled) {
            try {
                await this.initWithNoiseSuppression(options);
                return;
            } catch (error) {
                console.warn('[MicAudioProcessor] DTLN unavailable, using gain-only fallback.', error);
                await this.destroy();
            }
        }

        await this.initGainOnly(options);
    }

    async restart(options: MicGainProcessorOptions): Promise<void> {
        await this.init(options);
    }

    async destroy(): Promise<void> {
        this.workletHandle?.dispose();
        this.workletHandle = undefined;
        this.noiseSuppressionActive = false;

        this.source?.disconnect();
        this.gainNode?.disconnect();
        this.destination?.disconnect();
        this.processedTrack?.stop();

        this.source = undefined;
        this.gainNode = undefined;
        this.destination = undefined;
        this.processedTrack = undefined;

        if (this.ownsAudioContext && this.audioContext && this.audioContext.state !== 'closed') {
            await this.audioContext.close();
        }
        this.audioContext = undefined;
        this.ownsAudioContext = false;
    }

    setVolume(percent: number): void {
        const gain = Math.max(0, Math.min(2, percent / 100));
        const context = this.audioContext;
        if (!this.gainNode || !context) {
            return;
        }

        this.gainNode.gain.setTargetAtTime(gain, context.currentTime, 0.05);
    }

    private async initGainOnly(options: MicGainProcessorOptions): Promise<void> {
        this.audioContext = options.audioContext;
        this.ownsAudioContext = false;
        const source = options.audioContext.createMediaStreamSource(
            new MediaStream([options.track]),
        );
        const gainNode = options.audioContext.createGain();
        const destination = options.audioContext.createMediaStreamDestination();

        source.connect(gainNode);
        gainNode.connect(destination);

        this.source = source;
        this.gainNode = gainNode;
        this.destination = destination;
        this.processedTrack = destination.stream.getAudioTracks()[0] ?? undefined;
        this.noiseSuppressionActive = false;
    }

    private async initWithNoiseSuppression(options: MicGainProcessorOptions): Promise<void> {
        this.audioContext = new AudioContext({ sampleRate: 16000 });
        this.ownsAudioContext = true;
        await this.audioContext.resume();

        const source = this.audioContext.createMediaStreamSource(
            new MediaStream([options.track]),
        );
        const gainNode = this.audioContext.createGain();
        const destination = this.audioContext.createMediaStreamDestination();

        this.workletHandle = await createNoiseSuppressionWorklet(this.audioContext, {
            moduleUrl: NOISE_SUPPRESSION_WORKLET_URL,
            bypassUntilReady: true,
            readyTimeoutMs: 90_000,
        });
        source.connect(this.workletHandle.node);
        this.workletHandle.node.connect(gainNode);
        gainNode.connect(destination);
        await this.workletHandle.ready;

        this.source = source;
        this.gainNode = gainNode;
        this.destination = destination;
        this.processedTrack = destination.stream.getAudioTracks()[0] ?? undefined;
        this.noiseSuppressionActive = true;
    }
}
