import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { JoinService } from '../services/join.service';

/** Без сессии /room открыть нельзя — только после успешного /join. */
export const roomGuard: CanActivateFn = () => {
    const joinService = inject(JoinService);
    const router = inject(Router);

    if (joinService.isJoined()) {
        return true;
    }

    return router.createUrlTree(['/login']);
};
