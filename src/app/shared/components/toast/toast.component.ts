import { Component, inject } from '@angular/core';
import { ToastService } from '../../services/toast.service';

@Component({
  selector: 'app-toast',
  standalone: true,
  imports: [],
  template: `
    <div class="toast-container">
      @for (toast of toastService.toasts(); track toast.id) {
        <div class="toast-card" [class]="toast.type">
          <div class="toast-border"></div>
          <div class="toast-content">
            <span class="toast-icon">
              @switch (toast.type) {
                @case ('success') { ✓ }
                @case ('error') { ✗ }
                @case ('warning') { ⚠ }
                @default { ℹ }
              }
            </span>
            <span class="toast-message">{{ toast.message }}</span>
          </div>
          <button class="toast-close" (click)="toastService.remove(toast.id)">&times;</button>
        </div>
      }
    </div>
  `,
  styles: `
    .toast-container {
      position: fixed;
      bottom: 2rem;
      right: 2rem;
      z-index: 1000;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      pointer-events: none;
    }

    .toast-card {
      pointer-events: auto;
      min-width: 300px;
      max-width: 450px;
      background: var(--white);
      color: var(--charcoal);
      border-radius: 8px;
      box-shadow: 0 4px 15px rgba(0,0,0,0.1);
      display: flex;
      align-items: center;
      justify-content: space-between;
      overflow: hidden;
      position: relative;
      animation: slideIn 0.3s ease-out;
    }

    @keyframes slideIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }

    .toast-border {
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 4px;
    }

    .success .toast-border { background: var(--green); }
    .error .toast-border { background: var(--red); }
    .warning .toast-border { background: var(--gold); }
    .info .toast-border { background: var(--navy); }

    .toast-content {
      padding: 1rem;
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .toast-icon {
      font-weight: bold;
      font-size: 1.1rem;
    }

    .success .toast-icon { color: var(--green); }
    .error .toast-icon { color: var(--red); }
    .warning .toast-icon { color: var(--gold); }
    .info .toast-icon { color: var(--navy); }

    .toast-message {
      font-size: 0.9rem;
      font-weight: 500;
    }

    .toast-close {
      background: none;
      border: none;
      padding: 1rem;
      font-size: 1.25rem;
      cursor: pointer;
      color: var(--gray);
      transition: color 0.2s;
    }

    .toast-close:hover {
      color: var(--charcoal);
    }
  `
})
export class ToastComponent {
  readonly toastService = inject(ToastService);
}

