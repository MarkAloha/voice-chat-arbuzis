import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';
import { ApiError, JoinRequest, JoinResponse } from '../models/join.model';

@Injectable({ providedIn: 'root' })
export class AuthApiService {
    private readonly http = inject(HttpClient);

    join(request: JoinRequest): Promise<JoinResponse> {
        return firstValueFrom(
            this.http.post<JoinResponse>('/api/join', request).pipe(timeout(12000)),
        ).catch((error: { error?: ApiError; message?: string }) => {
            const message =
                error.error?.error ??
                error.message ??
                'Не удалось войти в комнату. Проверьте интернет и попробуйте ещё раз.';
            throw new Error(message);
        });
    }
}
