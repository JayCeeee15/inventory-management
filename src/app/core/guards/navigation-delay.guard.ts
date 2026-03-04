import { CanActivateFn } from '@angular/router';
import { map, timer } from 'rxjs';

export const navigationDelayGuard: CanActivateFn = () => {
  return timer(700).pipe(map(() => true));
};
