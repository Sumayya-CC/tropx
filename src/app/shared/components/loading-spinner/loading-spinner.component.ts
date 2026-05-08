import { Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-loading-spinner',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="spinner-wrapper" [class]="'size-' + size()">
      <div class="spinner"></div>
    </div>
  `,
  styles: [`
    .spinner-wrapper {
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .spinner {
      border: 3px solid rgba(0, 0, 0, 0.1);
      border-top-color: var(--color-primary, #6366f1);
      border-radius: 50%;
      animation: spin 0.75s linear infinite;
    }
    .size-sm .spinner { width: 20px; height: 20px; }
    .size-md .spinner { width: 40px; height: 40px; }
    .size-lg .spinner { width: 64px; height: 64px; }
    @keyframes spin { to { transform: rotate(360deg); } }
  `],
})
export class LoadingSpinnerComponent {
  size = input<'sm' | 'md' | 'lg'>('md');
}
