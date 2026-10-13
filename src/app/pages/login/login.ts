import { Component, ElementRef, OnDestroy, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { JoinError } from '../../models/join.model';
import { getUserErrorMessage } from '../../utils/user-error-message';
import { AuthApiService } from '../../services/auth-api.service';
import { JoinService } from '../../services/join.service';

const ROOM_FULL_COOLDOWN_MS = 30_000;
const JOIN_MIN_DELAY_MS = 300; // минимум «Вход…», чтобы кнопка не мигала на быстром API

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

@Component({
    selector: 'app-login',
    imports: [FormsModule],
    templateUrl: './login.html',
    styleUrl: './login.scss',
})
export class LoginComponent implements OnDestroy {
    private readonly authApi = inject(AuthApiService);
    private readonly joinService = inject(JoinService);
    private readonly router = inject(Router);
    private readonly passwordInput = viewChild<ElementRef<HTMLInputElement>>('passwordInput');

    private roomFullTimeout: ReturnType<typeof setTimeout> | null = null;

    protected password = '';
    protected nickname = '';
    protected readonly step = signal<'name' | 'password'>('name');
    protected readonly loading = signal(false);
    protected readonly error = signal<string | null>(null);
    protected readonly roomFull = signal(false);

    ngOnDestroy(): void {
        if (this.roomFullTimeout) {
            clearTimeout(this.roomFullTimeout);
        }
    }

    protected continueWithName(): void {
        const name = this.nickname.trim();
        if (!name) {
            this.error.set('Введите имя.');
            return;
        }

        this.nickname = name;
        this.error.set(null);
        this.step.set('password');
        setTimeout(() => this.passwordInput()?.nativeElement.focus());
    }

    protected async submit(): Promise<void> {
        if (this.loading() || this.roomFull() || this.step() !== 'password') {
            return;
        }

        this.loading.set(true);
        this.error.set(null);
        const startedAt = Date.now();

        try {
            const session = await this.authApi.join({
                password: this.password,
                nickname: this.nickname.trim(),
            });
            this.joinService.setSession(session, this.password);
            await this.router.navigateByUrl('/room');
        } catch (err) {
            if (err instanceof JoinError && err.code === 'room_full') {
                this.activateRoomFullCooldown();
                return; // finally всё равно сбросит loading после JOIN_MIN_DELAY_MS
            }

            const message = getUserErrorMessage(err, 'Не удалось войти в комнату.');
            this.error.set(message);
        } finally {
            const remaining = JOIN_MIN_DELAY_MS - (Date.now() - startedAt);
            if (remaining > 0) {
                await delay(remaining);
            }
            this.loading.set(false);
        }
    }

    /** Кнопка «Комната заполнена» 30 с — не спамим /join, пока слот не освободится. */
    private activateRoomFullCooldown(): void {
        this.roomFull.set(true);
        this.error.set(null);

        if (this.roomFullTimeout) {
            clearTimeout(this.roomFullTimeout);
        }

        this.roomFullTimeout = setTimeout(() => {
            this.roomFull.set(false);
            this.roomFullTimeout = null;
        }, ROOM_FULL_COOLDOWN_MS);
    }
}
