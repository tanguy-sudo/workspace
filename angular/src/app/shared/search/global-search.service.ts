import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class GlobalSearchService {
  private readonly openState = signal(false);
  readonly isOpen = this.openState.asReadonly();

  open(): void {
    this.openState.set(true);
  }

  close(): void {
    this.openState.set(false);
  }

  toggle(): void {
    this.openState.update((open) => !open);
  }
}
