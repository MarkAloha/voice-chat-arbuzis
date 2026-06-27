import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
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

  protected password = '';
  protected nickname = '';
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

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
      const message =
        err instanceof Error ? err.message : 'Не удалось войти в комнату.';
      this.error.set(message);
    } finally {
      this.loading.set(false);
    }
  }
}
