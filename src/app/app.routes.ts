import { Routes } from '@angular/router';
import { roomGuard } from './guards/room.guard';

export const routes: Routes = [
    {
        path: '',
        pathMatch: 'full',
        redirectTo: 'login',
    },
    {
        path: 'login',
        loadComponent: () => import('./pages/login/login').then((m) => m.LoginComponent),
    },
    {
        path: 'room',
        canActivate: [roomGuard],
        loadComponent: () => import('./pages/room/room').then((m) => m.RoomComponent),
    },
    {
        path: 'roadmap',
        loadComponent: () => import('./pages/roadmap/roadmap').then((m) => m.RoadmapComponent),
    },
    {
        path: '**',
        redirectTo: 'login',
    },
];
