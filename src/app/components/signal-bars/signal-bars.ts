import { Component, computed, input } from '@angular/core';
import type { SignalTooltipView } from '../../../shared/connection-quality';
import { TooltipComponent } from '../tooltip/tooltip';

@Component({
    selector: 'app-signal-bars',
    imports: [TooltipComponent],
    template: `
        <app-tooltip [signal]="signalTooltip()" [preferBelow]="preferBelow()">
            <span
                class="signal-bars"
                [class]="toneClass()"
                [attr.aria-label]="ariaLabel()"
            >
                @for (bar of barIndexes; track bar) {
                    <span class="signal-bars__bar" [class.active]="$index < filled()"></span>
                }
            </span>
        </app-tooltip>
    `,
    styles: `
        :host {
            display: inline-flex;
        }

        .signal-bars {
            display: inline-flex;
            align-items: flex-end;
            gap: 4px;
            height: 1.25rem;
            cursor: default;
        }

        .signal-bars__bar {
            width: 5px;
            border-radius: 2px;
            background: rgba(100, 116, 139, 0.45);
        }

        .signal-bars__bar:nth-child(1) {
            height: 35%;
        }

        .signal-bars__bar:nth-child(2) {
            height: 55%;
        }

        .signal-bars__bar:nth-child(3) {
            height: 75%;
        }

        .signal-bars__bar:nth-child(4) {
            height: 100%;
        }

        .signal-bars--good .signal-bars__bar.active {
            background: #22c55e;
        }

        .signal-bars--medium .signal-bars__bar.active {
            background: #eab308;
        }

        .signal-bars--poor .signal-bars__bar.active {
            background: #ef4444;
        }

        .signal-bars--muted .signal-bars__bar.active {
            background: #64748b;
        }
    `,
})
export class SignalBarsComponent {
    readonly filled = input(0);
    readonly tone = input<'good' | 'medium' | 'poor' | 'muted'>('muted');
    readonly signalTooltip = input<SignalTooltipView | null>(null);
    readonly preferBelow = input(true);

    protected readonly barIndexes = [0, 1, 2, 3];

    protected readonly toneClass = computed(() => `signal-bars--${this.tone()}`);

    protected ariaLabel(): string {
        const data = this.signalTooltip();
        if (!data) {
            return 'Уровень сигнала';
        }

        if (data.rttMs != null) {
            return `${data.title} · Задержка ${data.rttMs} ms · Потери ${data.packetLossPercent ?? 0}%`;
        }

        return data.qualityLabel ? `${data.title} · ${data.qualityLabel}` : data.title;
    }
}
