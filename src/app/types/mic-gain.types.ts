import { Track } from 'livekit-client';

export type MicGainProcessorOptions = {
    kind: Track.Kind.Audio;
    track: MediaStreamTrack;
    audioContext: AudioContext;
};

export type MicGainTrackProcessor = {
    name: string;
    init: (opts: MicGainProcessorOptions) => Promise<void>;
    restart: (opts: MicGainProcessorOptions) => Promise<void>;
    destroy: () => Promise<void>;
    processedTrack?: MediaStreamTrack;
};
