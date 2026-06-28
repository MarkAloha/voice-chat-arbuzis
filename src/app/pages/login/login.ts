import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { pickRandomNickname } from '../../data/random-nicknames';
import { AuthApiService } from '../../services/auth-api.service';
import { JoinService } from '../../services/join.service';

@Component({
    selector: 'app-login',
    imports: [FormsModule],
    templateUrl: './login.html',
    styleUrl: './login.scss',
})
export class LoginComponent {
    private readonly authApi = inject(AuthApiService);
    private readonly joinService = inject(JoinService);
    private readonly router = inject(Router);

    private readonly nicknameHistory = signal<string[]>([]);
    private nicknameOnFocus = '';

    protected password = '';
    protected nickname = '';
    protected readonly loading = signal(false);
    protected readonly error = signal<string | null>(null);
    protected readonly canRestoreNickname = computed(() => this.nicknameHistory().length > 0);

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
        if (this.loading()) {
            return;
        }

        this.loading.set(true);
        this.error.set(null);

        try {
            const session = await this.authApi.join({
                password: this.password,
                nickname: this.nickname,
            });
            this.joinService.setSession(session);
            await this.router.navigateByUrl('/room');
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Не удалось войти в комнату.';
            this.error.set(message);
        } finally {
            this.loading.set(false);
        }
    }

    private rememberCurrentNickname(): void {
        const current = this.nickname.trim();
        if (current) {
            this.pushNicknameHistory(current);
        }
    }

    private pushNicknameHistory(value: string): void {
        const history = this.nicknameHistory();
        if (history[history.length - 1] === value) {
            return;
        }

        this.nicknameHistory.set([...history, value]);
    }
}
