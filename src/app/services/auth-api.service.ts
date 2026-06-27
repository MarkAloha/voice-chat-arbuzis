import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ApiError, JoinRequest, JoinResponse } from '../models/join.model';

@Injectable({ providedIn: 'root' })
export class AuthApiService {
  private readonly http = inject(HttpClient);

  join(request: JoinRequest): Promise<JoinResponse> {
    return firstValueFrom(
      this.http.post<JoinResponse>('/api/join', request),
    ).catch((error: { error?: ApiError; message?: string }) => {
      const message =
        error.error?.error ?? error.message ?? 'Не удалось войти в комнату.';
      throw new Error(message);
    });
  }
}
