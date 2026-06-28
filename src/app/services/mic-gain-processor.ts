import { Track } from 'livekit-client';

type MicGainProcessorOptions = {
  kind: Track.Kind.Audio;
  track: MediaStreamTrack;
  audioContext: AudioContext;
};

type MicGainTrackProcessor = {
  name: string;
  init: (opts: MicGainProcessorOptions) => Promise<void>;
  restart: (opts: MicGainProcessorOptions) => Promise<void>;
  destroy: () => Promise<void>;
  processedTrack?: MediaStreamTrack;
};

export class MicGainProcessor implements MicGainTrackProcessor {
  readonly name = 'mic-gain';

  processedTrack?: MediaStreamTrack;

  private gainNode?: GainNode;
  private source?: MediaStreamAudioSourceNode;
  private destination?: MediaStreamAudioDestinationNode;
  private audioContext?: AudioContext;

  async init(options: MicGainProcessorOptions): Promise<void> {
    this.audioContext = options.audioContext;
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
  }

  async restart(options: MicGainProcessorOptions): Promise<void> {
    await this.destroy();
    await this.init(options);
  }

  async destroy(): Promise<void> {
    this.source?.disconnect();
    this.gainNode?.disconnect();
    this.destination?.disconnect();
    this.processedTrack?.stop();

    this.source = undefined;
    this.gainNode = undefined;
    this.destination = undefined;
    this.processedTrack = undefined;
  }

  setVolume(percent: number): void {
    const gain = Math.max(0, Math.min(2, percent / 100));
    const context = this.audioContext;
    if (!this.gainNode || !context) {
      return;
    }

    this.gainNode.gain.setTargetAtTime(gain, context.currentTime, 0.05);
  }
}
