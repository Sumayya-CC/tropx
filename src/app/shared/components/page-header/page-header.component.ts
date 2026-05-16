import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-page-header',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './page-header.component.html',
  styleUrl: './page-header.component.scss'
})
export class PageHeaderComponent {
  @Input({ required: true }) title!: string;
  @Input() subtitle?: string;
  @Input() backLink?: string;
  @Input() backLinkLabel?: string;
  @Input() buttonLabel?: string;
  @Input() buttonIcon: 'plus' | 'none' = 'plus';
  @Input() buttonVariant: 'primary' | 'secondary' = 'primary';
  @Output() buttonClick = new EventEmitter<void>();
}
