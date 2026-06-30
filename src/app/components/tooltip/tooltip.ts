import {
    Component,
    ElementRef,
    HostListener,
    OnDestroy,
    input,
    signal,
    viewChild,
} from '@angular/core';
import type { SignalTooltipView } from '../../../shared/connection-quality';

@Component({
    selector: 'app-tooltip',
    template: `
        <span
            class="tooltip-host"
            [class.tooltip-host--block]="block()"
            (mouseenter)="open()"
            (mouseleave)="close()"
            (focusin)="open()"
            (focusout)="onFocusOut($event)"
        >
            <ng-content />
            @if (visible()) {
                <span
                    #panel
                    class="app-tooltip"
                    [class.app-tooltip--above]="showAbove()"
                    [class.app-tooltip--positioned]="positioned()"
                    [class.app-tooltip--signal]="signal()"
                    role="tooltip"
                    [attr.aria-label]="ariaText()"
                >
                    @if (signal(); as data) {
                        <span class="app-tooltip__dot" [class]="'app-tooltip__dot--' + data.tone"></span>
                        <span class="app-tooltip__content">
                            @if (data.rttMs != null) {
                                @if (data.title) {
                                    <span class="app-tooltip__title">{{ data.title }}</span>
                                    <span class="app-tooltip__sep"> · </span>
                                }
                                <span>Задержка </span>
                                <strong>{{ data.rttMs }} ms</strong>
                                @if (data.packetLossPercent != null) {
                                    <span class="app-tooltip__sep"> · </span>
                                    <span>Потери </span>
                                    <strong>{{ data.packetLossPercent }}%</strong>
                                }
                            } @else {
                                <span class="app-tooltip__title">{{ data.title }}</span>
                                @if (data.qualityLabel) {
                                    <span class="app-tooltip__sep"> · </span>
                                    <span>{{ data.qualityLabel }}</span>
                                }
                            }
                        </span>
                    } @else if (text()) {
                        {{ text() }}
                    }
                </span>
            }
        </span>
    `,
    styles: `
        :host {
            display: inline-flex;
            max-width: 100%;
        }

        :host:has(.tooltip-host--block) {
            display: flex;
            width: 100%;
        }

        .tooltip-host {
            display: inline-flex;
            max-width: 100%;
            position: relative;
        }

        .tooltip-host--block {
            display: flex;
            width: 100%;
        }

        .app-tooltip {
            position: fixed;
            z-index: 200;
            opacity: 0;
            display: inline-flex;
            align-items: center;
            gap: 0.45rem;
            padding: 0.5rem 0.75rem;
            border-radius: 8px;
            background: #111827;
            border: 1px solid #374151;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
            color: #e2e8f0;
            font-size: 0.8125rem;
            line-height: 1.3;
            white-space: nowrap;
            pointer-events: none;
        }

        .app-tooltip--positioned {
            opacity: 1;
        }

        .app-tooltip::before,
        .app-tooltip::after {
            content: '';
            position: absolute;
            left: var(--tooltip-arrow-left, 50%);
            transform: translateX(-50%);
            border: 6px solid transparent;
        }

        .app-tooltip:not(.app-tooltip--above)::before {
            bottom: 100%;
            border-bottom-color: #374151;
        }

        .app-tooltip:not(.app-tooltip--above)::after {
            bottom: calc(100% - 1px);
            border-bottom-color: #111827;
        }

        .app-tooltip--above::before {
            top: 100%;
            border-top-color: #374151;
        }

        .app-tooltip--above::after {
            top: calc(100% - 1px);
            border-top-color: #111827;
        }

        .app-tooltip__dot {
            width: 0.5rem;
            height: 0.5rem;
            border-radius: 999px;
            flex-shrink: 0;
        }

        .app-tooltip__dot--good {
            background: #4ade80;
        }

        .app-tooltip__dot--medium {
            background: #eab308;
        }

        .app-tooltip__dot--poor {
            background: #ef4444;
        }

        .app-tooltip__dot--muted {
            background: #64748b;
        }

        .app-tooltip__content strong {
            color: #4ade80;
            font-weight: 600;
        }

        .app-tooltip__title {
            color: #f1f5f9;
        }

        .app-tooltip__sep {
            color: #64748b;
        }
    `,
})
export class TooltipComponent implements OnDestroy {
    readonly text = input<string | null>(null);
    readonly signal = input<SignalTooltipView | null>(null);
    readonly block = input(false);
    /** Если элемент у нижнего края экрана — показать над ним. */
    readonly preferBelow = input(true);

    protected readonly visible = signal(false);
    protected readonly positioned = signal(false);
    protected readonly showAbove = signal(false);

    private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
    private readonly scrollListener = (): void => {
        if (this.visible()) {
            this.close();
        }
    };

    constructor() {
        if (typeof document !== 'undefined') {
            document.addEventListener('scroll', this.scrollListener, true);
        }
    }

    ngOnDestroy(): void {
        if (typeof document !== 'undefined') {
            document.removeEventListener('scroll', this.scrollListener, true);
        }
    }

    protected ariaText(): string {
        const data = this.signal();
        if (data) {
            if (data.rttMs != null) {
                const prefix = data.title ? `${data.title} · ` : '';
                const loss =
                    data.packetLossPercent != null ? ` · Потери ${data.packetLossPercent}%` : '';
                return `${prefix}Задержка ${data.rttMs} ms${loss}`;
            }

            return data.qualityLabel ? `${data.title} · ${data.qualityLabel}` : data.title;
        }

        return this.text() ?? '';
    }

    @HostListener('window:resize')
    protected onViewportChange(): void {
        if (this.visible()) {
            this.reposition();
        }
    }

    protected open(): void {
        const hasContent = Boolean(this.text()?.trim()) || Boolean(this.signal());
        if (!hasContent) {
            return;
        }

        this.positioned.set(false);
        this.visible.set(true);
        requestAnimationFrame(() => {
            this.reposition();
            this.positioned.set(true);
        });
    }

    protected close(): void {
        this.visible.set(false);
        this.positioned.set(false);
        this.showAbove.set(false);
    }

    protected onFocusOut(event: FocusEvent): void {
        const host = event.currentTarget as HTMLElement | null;
        const next = event.relatedTarget as Node | null;
        if (host && next && host.contains(next)) {
            return;
        }

        this.close();
    }

    private reposition(): void {
        const panel = this.panel()?.nativeElement;
        const host = panel?.parentElement;
        const trigger = (host?.firstElementChild as HTMLElement | null) ?? host;
        if (!panel || !trigger) {
            return;
        }

        const rect = trigger.getBoundingClientRect();
        const gap = 8;
        const margin = 8;
        const centerX = rect.left + rect.width / 2;

        panel.style.visibility = 'hidden';
        panel.style.left = '0';
        panel.style.top = '0';
        const panelRect = panel.getBoundingClientRect();
        panel.style.visibility = '';

        const spaceBelow = window.innerHeight - rect.bottom - margin;
        const spaceAbove = rect.top - margin;
        const fitsBelow = spaceBelow >= panelRect.height + gap;
        const fitsAbove = spaceAbove >= panelRect.height + gap;

        const placeAbove = this.preferBelow()
            ? !fitsBelow && fitsAbove
            : fitsAbove || !fitsBelow;

        this.showAbove.set(placeAbove);

        let top = placeAbove ? rect.top - panelRect.height - gap : rect.bottom + gap;
        let left = centerX - panelRect.width / 2;
        left = Math.max(margin, Math.min(left, window.innerWidth - panelRect.width - margin));

        if (placeAbove) {
            top = Math.max(margin, top);
        } else {
            top = Math.min(top, window.innerHeight - panelRect.height - margin);
        }

        panel.style.left = `${left}px`;
        panel.style.top = `${top}px`;
        const arrowLeft = Math.max(12, Math.min(centerX - left, panelRect.width - 12));
        panel.style.setProperty('--tooltip-arrow-left', `${arrowLeft}px`);
    }
}
