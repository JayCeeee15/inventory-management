import { Injectable, signal } from '@angular/core';
import { Observable, Subject } from 'rxjs';

export type AppRefreshScope =
  | 'dashboard'
  | 'inventory'
  | 'products'
  | 'categories'
  | 'transactions'
  | 'orders'
  | 'shop';

export interface AppRefreshEvent {
  id: number;
  reason: string;
  scopes: AppRefreshScope[];
  requestedAt: number;
}

@Injectable({
  providedIn: 'root'
})
export class AppRefreshService {
  private static readonly DEFAULT_SCOPES: AppRefreshScope[] = [
    'dashboard',
    'inventory',
    'products',
    'categories',
    'transactions',
    'orders',
    'shop'
  ];

  private sequence = 0;
  private readonly refreshSubject = new Subject<AppRefreshEvent>();
  private readonly lastEventSignal = signal<AppRefreshEvent | null>(null);

  readonly refresh$: Observable<AppRefreshEvent> = this.refreshSubject.asObservable();
  readonly lastEvent = this.lastEventSignal.asReadonly();

  request(reason: string, scopes: AppRefreshScope[] = AppRefreshService.DEFAULT_SCOPES): void {
    const event: AppRefreshEvent = {
      id: ++this.sequence,
      reason: reason.trim() || 'manual',
      scopes,
      requestedAt: Date.now()
    };

    this.lastEventSignal.set(event);
    this.refreshSubject.next(event);
  }

  matches(event: AppRefreshEvent, scopes: AppRefreshScope[]): boolean {
    return scopes.some(scope => event.scopes.includes(scope));
  }
}
