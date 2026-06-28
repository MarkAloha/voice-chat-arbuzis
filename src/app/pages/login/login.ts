import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { pickRandomNickname } from '../../data/random-nicknames';
import { JoinError } from '../../models/join.model';
import { AuthApiService } from '../../services/auth-api.service';
import { JoinService } from '../../services/join.service';

const ROOM_FULL_COOLDOWN_MS = 30_000;
const JOIN_MIN_DELAY_MS = 300; // минимум «Вход…», чтобы кнопка не мигала на быстром API

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

@Component({
    selector: 'app-login',
    imports: [FormsModule, RouterLink],
    templateUrl: './login.html',
    styleUrl: './login.scss',
})
export class LoginComponent implements OnDestroy {
    private readonly authApi = inject(AuthApiService);
    private readonly joinService = inject(JoinService);
    private readonly router = inject(Router);

    private readonly nicknameHistory = signal<string[]>([]);
    private nicknameOnFocus = '';
    private roomFullTimeout: ReturnType<typeof setTimeout> | null = null;

    protected password = '';
    protected nickname = '';
    protected readonly loading = signal(false);
    protected readonly error = signal<string | null>(null);
    protected readonly roomFull = signal(false);
    protected readonly canRestoreNickname = computed(() => this.nicknameHistory().length > 0);

    ngOnDestroy(): void {
        if (this.roomFullTimeout) {
            clearTimeout(this.roomFullTimeout);
        }
    }

    protected pickRandomName(): void {
        this.rememberCurrentNickname();
        this.nickname = pickRandomNickname();
    }

    protected restorePreviousNickname(): void {
        const history = [...this.nicknameHistory()];
        const previous = history.pop();
        if (!previous) {
            return;
        }

        this.nicknameHistory.set(history);
        this.nickname = previous;
    }

    protected onNicknameFocus(): void {
        this.nicknameOnFocus = this.nickname;
    }

    protected onNicknameBlur(): void {
        const current = this.nickname.trim();
        const previous = this.nicknameOnFocus.trim();
        if (previous && current && previous !== current) {
            this.pushNicknameHistory(previous);
        }
    }

    protected async submit(): Promise<void> {
        if (this.loading() || this.roomFull()) {
            return;
        }

        this.loading.set(true);
        this.error.set(null);
        const startedAt = Date.now();

        try {
            const session = await this.authApi.join({
                password: this.password,
                nickname: this.nickname,
            });
            this.joinService.setSession(session, this.password);
            await this.router.navigateByUrl('/room');
        } catch (err) {
            if (err instanceof JoinError && err.code === 'room_full') {
                this.activateRoomFullCooldown();
                return; // finally всё равно сбросит loading после JOIN_MIN_DELAY_MS
            }

            const message = err instanceof Error ? err.message : 'Не удалось войти в комнату.';
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

    private rememberCurrentNickname(): void {
        const current = this.nickname.trim();
        if (current) {
            this.pushNicknameHistory(current);
        }
    }

    /** Стек имён для «?» и стрелки назад — только в памяти вкладки. */
    private pushNicknameHistory(value: string): void {
        const history = this.nicknameHistory();
        if (history[history.length - 1] === value) {
            return;
        }

        this.nicknameHistory.set([...history, value]);
    }
}
