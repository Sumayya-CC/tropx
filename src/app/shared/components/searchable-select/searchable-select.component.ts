import { Component, input, output, signal, computed, ElementRef, HostListener, viewChild, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

export interface SearchableSelectOption {
  value: string;
  label: string;
  sublabel?: string;
  imageUrl?: string;
  meta?: string;
}

@Component({
  selector: 'app-searchable-select',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './searchable-select.component.html',
  styleUrl: './searchable-select.component.scss'
})
export class SearchableSelectComponent {
  // Inputs
  options = input<SearchableSelectOption[]>([]);
  placeholder = input<string>('Select...');
  disabled = input<boolean>(false);
  value = input<string | null>(null);

  // Outputs
  selected = output<SearchableSelectOption>();

  // State
  isOpen = signal(false);
  searchQuery = signal('');
  activeIndex = signal(-1);

  // View Child for auto-focus
  searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');

  // Computed
  filteredOptions = computed(() => {
    const query = this.searchQuery().toLowerCase().trim();
    if (!query) return this.options();
    return this.options().filter(opt => 
      opt.label.toLowerCase().includes(query) || 
      opt.sublabel?.toLowerCase().includes(query)
    );
  });

  selectedOption = computed(() => {
    const val = this.value();
    if (!val) return null;
    return this.options().find(opt => opt.value === val) || null;
  });

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    const isInside = target.closest('app-searchable-select');
    if (!isInside && this.isOpen()) {
      this.close();
    }
  }

  toggle() {
    if (this.disabled()) return;
    if (this.isOpen()) {
      this.close();
    } else {
      this.open();
    }
  }

  open() {
    this.isOpen.set(true);
    this.searchQuery.set('');
    this.activeIndex.set(-1);
    // Focus search input on next tick
    setTimeout(() => {
      this.searchInput()?.nativeElement.focus();
    }, 0);
  }

  close() {
    this.isOpen.set(false);
    this.searchQuery.set('');
  }

  selectOption(opt: SearchableSelectOption) {
    this.selected.emit(opt);
    this.close();
  }

  @HostListener('keydown', ['$event'])
  handleKeyboard(event: KeyboardEvent) {
    if (this.disabled()) return;

    if (!this.isOpen()) {
      if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
        this.open();
        event.preventDefault();
      }
      return;
    }

    switch (event.key) {
      case 'Escape':
        this.close();
        break;
      case 'ArrowDown':
        this.activeIndex.update(idx => Math.min(idx + 1, this.filteredOptions().length - 1));
        event.preventDefault();
        break;
      case 'ArrowUp':
        this.activeIndex.update(idx => Math.max(idx - 1, 0));
        event.preventDefault();
        break;
      case 'Enter':
        const current = this.filteredOptions()[this.activeIndex()];
        if (current) {
          this.selectOption(current);
        } else if (this.filteredOptions().length === 1) {
          this.selectOption(this.filteredOptions()[0]);
        }
        event.preventDefault();
        break;
      case 'Tab':
        this.close();
        break;
    }
  }
}
