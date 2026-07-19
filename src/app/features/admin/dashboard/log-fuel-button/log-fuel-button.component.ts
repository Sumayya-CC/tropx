import { Component, inject, signal } from '@angular/core';
import { SettingsService } from '../../../../core/services/settings.service';
import { ExpenseFormModalComponent } from '../../expenses/expense-form-modal/expense-form-modal.component';

@Component({
  selector: 'app-log-fuel-button',
  standalone: true,
  imports: [ExpenseFormModalComponent],
  templateUrl: './log-fuel-button.component.html',
  styleUrl: './log-fuel-button.component.scss'
})
export class LogFuelButtonComponent {
  protected readonly settings = inject(SettingsService);

  showModal = signal(false);

  open() {
    this.showModal.set(true);
  }

  close() {
    this.showModal.set(false);
  }
}
