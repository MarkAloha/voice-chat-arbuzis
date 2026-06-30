import { ConnectionQuality } from 'livekit-client';

export type LocalConnectionStats = {
    rttMs: number | null;
    packetLossPercent: number | null;
};

export function connectionQualityBars(quality: ConnectionQuality): number {
    switch (quality) {
        case ConnectionQuality.Excellent:
            return 4;
        case ConnectionQuality.Good:
            return 3;
        case ConnectionQuality.Poor:
            return 2;
        case ConnectionQuality.Lost:
            return 1;
        default:
            return 0;
    }
}

export function connectionQualityLabel(quality: ConnectionQuality): string {
    switch (quality) {
        case ConnectionQuality.Excellent:
            return 'Отлично';
        case ConnectionQuality.Good:
            return 'Хорошо';
        case ConnectionQuality.Poor:
            return 'Слабо';
        case ConnectionQuality.Lost:
            return 'Потеряно';
        default:
            return 'Неизвестно';
    }
}

export function connectionQualityTone(
    bars: number,
): 'good' | 'medium' | 'poor' | 'muted' {
    if (bars >= 4) {
        return 'good';
    }
    if (bars === 3) {
        return 'good';
    }
    if (bars === 2) {
        return 'medium';
    }
    if (bars === 1) {
        return 'poor';
    }
    return 'muted';
}

export type SignalTooltipView = {
    title: string;
    qualityLabel?: string;
    rttMs?: number | null;
    packetLossPercent?: number | null;
    tone: 'good' | 'medium' | 'poor' | 'muted';
};

export function buildSignalTooltipView(
    displayName: string,
    quality: ConnectionQuality,
    isLocal: boolean,
    stats: LocalConnectionStats | null,
): SignalTooltipView {
    const bars = connectionQualityBars(quality);
    const tone = connectionQualityTone(bars);
    const title = isLocal ? 'Ваш сигнал' : displayName;
    const qualityLabel = connectionQualityLabel(quality);

    if (isLocal && stats?.rttMs != null) {
        return {
            title,
            rttMs: Math.round(stats.rttMs),
            packetLossPercent: stats.packetLossPercent ?? 0,
            tone,
        };
    }

    return { title, qualityLabel, tone };
}
