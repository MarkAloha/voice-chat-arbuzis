export interface ParticipantView {
    identity: string;
    displayName: string;
    isLocal: boolean;
    micEnabled: boolean;
    isSpeaking: boolean;
    volume: number;
}
