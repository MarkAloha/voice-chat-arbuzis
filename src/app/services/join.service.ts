import { Injectable, computed, signal } from '@angular/core';
import { JoinSession } from '../models/join.model';

@Injectable({ providedIn: 'root' })
export class JoinService {
  private readonly sessionState = signal<JoinSession | null>(null);

  readonly session = this.sessionState.asReadonly();
  readonly isJoined = computed(() => this.sessionState() !== null);

  setSession(session: JoinSession): void {
    this.sessionState.set(session);
  }

  clear(): void {
    this.sessionState.set(null);
  }
}
