import { SignalTooltipView } from '../../shared/connection-quality';

export interface ParticipantView {
    identity: string;
    displayName: string;
    isLocal: boolean;
    micEnabled: boolean;
    isSpeaking: boolean;
    /** Громкость прослушивания: у себя — общая входящая, у других — локальная для участника. */
    listenVolume: number;
    colorIndex: number;
    color: string;
    signalBars: number;
    signalTone: 'good' | 'medium' | 'poor' | 'muted';
    signalTooltip: SignalTooltipView;
}
