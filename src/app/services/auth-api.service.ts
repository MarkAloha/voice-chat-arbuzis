import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';
import { ApiError, JoinError, JoinRequest, JoinResponse, ResumeJoinRequest } from '../models/join.model';
import { getUserErrorMessage } from '../utils/user-error-message';

@Injectable({ providedIn: 'root' })
export class AuthApiService {
    private readonly http = inject(HttpClient);

    join(request: JoinRequest): Promise<JoinResponse> {
        return firstValueFrom(
            this.http.post<JoinResponse>('/api/join', request).pipe(timeout(12000)),
        ).catch((error: HttpErrorResponse | Error) => this.mapJoinError(error));
    }

    resumeJoin(request: ResumeJoinRequest): Promise<JoinResponse> {
        return firstValueFrom(
            this.http.post<JoinResponse>('/api/join/resume', request).pipe(timeout(12000)),
        ).catch((error: HttpErrorResponse | Error) => this.mapJoinError(error));
    }

    private mapJoinError(error: HttpErrorResponse | Error): never {
        if (error instanceof HttpErrorResponse) {
            const body = error.error as ApiError | undefined;
            const apiMessage = body?.error;

            if (body?.code === 'room_full') {
                throw new JoinError(apiMessage ?? 'Комната заполнена', body.code);
            }

            if (apiMessage) {
                throw new Error(apiMessage);
            }

            if (error.status === 0) {
                throw new Error(
                    getUserErrorMessage(error, 'Сервер недоступен. Запустите npm run dev и попробуйте снова.'),
                );
            }

            throw new Error(
                getUserErrorMessage(
                    error,
                    'Не удалось войти в комнату. Проверьте интернет и попробуйте ещё раз.',
                ),
            );
        }

        throw new Error(
            getUserErrorMessage(
                error,
                'Не удалось войти в комнату. Проверьте интернет и попробуйте ещё раз.',
            ),
        );
    }

/** Снимает «мёртвый» резерв слота, если connect в LiveKit не состоялся. */
    releaseJoin(identity: string): Promise<void> {
        return firstValueFrom(
            this.http
                .post('/api/join/release', { identity }, { responseType: 'text' })
                .pipe(timeout(5000)),
        ).then(() => undefined);
    }
}
