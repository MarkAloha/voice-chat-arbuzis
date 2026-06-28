import { MicGainProcessorOptions, MicGainTrackProcessor } from '../types/mic-gain.types';

type NoiseWorkletModule = typeof import('@workadventure/noise-suppression/audio-worklet');
type NoiseWorkletHandle = Awaited<
    ReturnType<NoiseWorkletModule['createNoiseSuppressionAudioWorklet']>
>;

/** DTLN (lazy) + gain; один processor на трек LiveKit. */
export class MicAudioProcessor implements MicGainTrackProcessor {
    readonly name = 'mic-audio';

    processedTrack?: MediaStreamTrack;

    private gainNode?: GainNode;
    private source?: MediaStreamAudioSourceNode;
    private destination?: MediaStreamAudioDestinationNode;
    private audioContext?: AudioContext;
    private workletHandle?: NoiseWorkletHandle;
    private noiseSuppressionEnabled = true;

    setNoiseSuppressionEnabled(enabled: boolean): void {
        this.noiseSuppressionEnabled = enabled;
    }

    async init(options: MicGainProcessorOptions): Promise<void> {
        await this.destroy();

        this.audioContext = new AudioContext({ sampleRate: 16000 });
        await this.audioContext.resume();

        const source = this.audioContext.createMediaStreamSource(
            new MediaStream([options.track]),
        );
        const gainNode = this.audioContext.createGain();
        const destination = this.audioContext.createMediaStreamDestination();

        if (this.noiseSuppressionEnabled) {
            const { createNoiseSuppressionAudioWorklet } = await this.loadNoiseSuppression();
            this.workletHandle = await createNoiseSuppressionAudioWorklet(this.audioContext, {
                bypassUntilReady: true,
            });
            source.connect(this.workletHandle.node);
            this.workletHandle.node.connect(gainNode);
            await this.workletHandle.ready;
        } else {
            source.connect(gainNode);
        }

        gainNode.connect(destination);

        this.source = source;
        this.gainNode = gainNode;
        this.destination = destination;
        this.processedTrack = destination.stream.getAudioTracks()[0] ?? undefined;
    }

    async restart(options: MicGainProcessorOptions): Promise<void> {
        await this.init(options);
    }

    async destroy(): Promise<void> {
        this.workletHandle?.dispose();
        this.workletHandle = undefined;

        this.source?.disconnect();
        this.gainNode?.disconnect();
        this.destination?.disconnect();
        this.processedTrack?.stop();

        this.source = undefined;
        this.gainNode = undefined;
        this.destination = undefined;
        this.processedTrack = undefined;

        if (this.audioContext && this.audioContext.state !== 'closed') {
            await this.audioContext.close();
        }
        this.audioContext = undefined;
    }

    setVolume(percent: number): void {
        const gain = Math.max(0, Math.min(2, percent / 100));
        const context = this.audioContext;
        if (!this.gainNode || !context) {
            return;
        }

        this.gainNode.gain.setTargetAtTime(gain, context.currentTime, 0.05);
    }

    /** ~17 MB подгружаются только при первом включении DTLN. */
    private loadNoiseSuppression(): Promise<NoiseWorkletModule> {
        return import('@workadventure/noise-suppression/audio-worklet');
    }
}
