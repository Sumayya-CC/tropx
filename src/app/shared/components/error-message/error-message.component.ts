import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-error-message',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="error-banner" role="alert">
      <span class="error-icon">⚠️</span>
      <span class="error-text">{{ message() }}</span>
      @if (retryable()) {
        <button class="retry-btn" (click)="retry.emit()">Retry</button>
      }
    </div>
  `,
  styles: [`
    .error-banner {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.875rem 1.25rem;
      background: #fef2f2;
      border: 1px solid #fecaca;
      border-radius: 0.5rem;
      color: #991b1b;
      font-size: 0.9rem;
    }
    .retry-btn {
      margin-left: auto;
      padding: 0.25rem 0.75rem;
      background: #ef4444;
      color: #fff;
      border: none;
      border-radius: 0.375rem;
      cursor: pointer;
      font-size: 0.8rem;
    }
    .retry-btn:hover { background: #dc2626; }
  `],
})
export class ErrorMessageComponent {
  message = input<string>('An unexpected error occurred.');
  retryable = input<boolean>(false);
  retry = output<void>();
}
