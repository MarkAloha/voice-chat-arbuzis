import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';
import { ApiError, JoinError, JoinRequest, JoinResponse } from '../models/join.model';

@Injectable({ providedIn: 'root' })
export class AuthApiService {
    private readonly http = inject(HttpClient);

    join(request: JoinRequest): Promise<JoinResponse> {
        return firstValueFrom(
            this.http.post<JoinResponse>('/api/join', request).pipe(timeout(12000)),
        ).catch((error: HttpErrorResponse | Error) => {
            if (error instanceof HttpErrorResponse) {
                const body = error.error as ApiError | undefined;
                const message = body?.error ?? error.message;

                if (body?.code === 'room_full') {
                    throw new JoinError(message, body.code);
                }

                throw new Error(
                    message ||
                        'Не удалось войти в комнату. Проверьте интернет и попробуйте ещё раз.',
                );
            }

            throw error;
        });
    }
}
