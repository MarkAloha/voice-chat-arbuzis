import { Component, input } from '@angular/core';

@Component({
    selector: 'app-mic-icon',
    template: `
        <svg
            class="mic-icon"
            [class.large]="large()"
            [class.compact]="compact()"
            [class.enabled]="enabled()"
            viewBox="0 0 24 24"
            aria-hidden="true"
        >
            <path
                fill="currentColor"
                d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5-3c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"
            />
            @if (!enabled()) {
                <line
                    class="slash"
                    x1="5"
                    y1="19"
                    x2="19"
                    y2="5"
                    stroke="#ef4444"
                    stroke-width="2.5"
                    stroke-linecap="round"
                />
            }
        </svg>
    `,
    styles: `
        :host {
            display: inline-flex;
        }

        .mic-icon {
            width: 1.15rem;
            height: 1.15rem;
            color: #64748b;
        }

        .mic-icon.enabled {
            color: #4ade80;
        }

        .mic-icon.compact {
            width: 1rem;
            height: 1rem;
        }

        .mic-icon.large {
            width: 1.65rem;
            height: 1.65rem;
        }

        .mic-icon.large.enabled {
            color: #dcfce7;
        }
    `,
})
export class MicIconComponent {
    readonly enabled = input(true);
    readonly large = input(false);
    readonly compact = input(false);
}
