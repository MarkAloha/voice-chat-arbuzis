import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { JoinService } from '../services/join.service';

export const roomGuard: CanActivateFn = () => {
    const joinService = inject(JoinService);
    const router = inject(Router);

    if (joinService.isJoined()) {
        return true;
    }

    return router.createUrlTree(['/login']);
};
