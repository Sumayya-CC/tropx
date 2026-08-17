import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { ContactInquiry, ContactInquiryStatus } from '../../../../core/models/contact-inquiry.model';
import { StatusBadgeComponent } from '../../../../shared/components/status-badge/status-badge.component';

@Component({
  selector: 'app-contact-inquiry-detail-modal',
  standalone: true,
  imports: [CommonModule, DatePipe, StatusBadgeComponent],
  templateUrl: './contact-inquiry-detail-modal.component.html',
  styleUrl: './contact-inquiry-detail-modal.component.scss'
})
export class ContactInquiryDetailModalComponent {
  @Input({ required: true }) inquiry!: ContactInquiry;
  @Output() closed = new EventEmitter<void>();
  @Output() statusChange = new EventEmitter<ContactInquiryStatus>();

  closeModal() {
    this.closed.emit();
  }

  toDate(ts: any): Date {
    if (!ts) return new Date(0);
    return ts.toDate ? ts.toDate() : new Date(ts);
  }
}
