import { Component, inject, signal, computed, input, output, ElementRef, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FirestoreService } from '../../../core/services/firestore.service';
import { ToastService } from '../../services/toast.service';
import { where, serverTimestamp } from '@angular/fire/firestore';

@Component({
  selector: 'app-service-area-select',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './service-area-select.component.html',
  styleUrl: './service-area-select.component.scss'
})
export class ServiceAreaSelectComponent implements OnDestroy {
  private readonly firestoreService = inject(FirestoreService);
  private readonly toast = inject(ToastService);
  private readonly elementRef = inject(ElementRef);

  // Inputs
  selected = input<string | null>(null);
  // Output
  selectedChange = output<{ id: string; name: string } | null>();

  serviceAreas = signal<{ id: string; name: string }[]>([]);

  isLoading = signal(false);
  showDropdown = signal(false);
  searchQuery = signal('');
  showAddForm = signal(false);
  newAreaName = signal('');
  isSaving = signal(false);

  private documentClickListener: ((event: MouseEvent) => void) | null = null;

  selectedArea = computed(() => {
    const id = this.selected();
    if (!id) return null;
    return this.serviceAreas().find(a => a.id === id) || null;
  });

  filteredAreas = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    if (!q) return this.serviceAreas();
    return this.serviceAreas().filter(a => a.name.toLowerCase().includes(q));
  });

  constructor() {
    this.loadServiceAreas();
  }

  ngOnDestroy() {
    this.removeOutsideClickListener();
  }

  loadServiceAreas() {
    this.isLoading.set(true);
    this.firestoreService.getCollection<any>(
      'serviceAreas',
      where('tenantId', '==', 1),
      where('isDeleted', '==', false)
    ).subscribe({
      next: (areas) => {
        this.serviceAreas.set(
          areas
            .filter((a: any) => !a.isDeleted)
            .sort((a: any, b: any) => a.name.localeCompare(b.name))
        );
        this.isLoading.set(false);
      },
      error: (err) => {
        console.error('Error loading service areas:', err);
        this.isLoading.set(false);
      }
    });
  }

  private addOutsideClickListener() {
    if (this.documentClickListener) return;
    this.documentClickListener = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!this.elementRef.nativeElement.contains(target)) {
        this.showDropdown.set(false);
        this.showAddForm.set(false);
        this.searchQuery.set('');
        this.removeOutsideClickListener();
      }
    };
    document.addEventListener('click', this.documentClickListener, true);
  }

  private removeOutsideClickListener() {
    if (this.documentClickListener) {
      document.removeEventListener('click', this.documentClickListener, true);
      this.documentClickListener = null;
    }
  }

  openDropdown() {
    this.showDropdown.set(true);
    this.showAddForm.set(false);
    this.searchQuery.set('');
    // Register listener on the next event loop turn to avoid closing instantly
    setTimeout(() => this.addOutsideClickListener());
  }

  selectArea(area: { id: string; name: string }) {
    this.selectedChange.emit(area);
    this.showDropdown.set(false);
    this.searchQuery.set('');
    this.removeOutsideClickListener();
  }

  clearSelection() {
    this.selectedChange.emit(null);
  }

  openAddForm() {
    this.showAddForm.set(true);
    this.newAreaName.set('');
  }

  cancelAdd() {
    this.showAddForm.set(false);
    this.newAreaName.set('');
  }

  async saveNewArea() {
    const name = this.newAreaName().trim();
    if (!name) {
      this.toast.error('Area name is required');
      return;
    }

    // Check duplicate
    const exists = this.serviceAreas().some(
      a => a.name.toLowerCase() === name.toLowerCase()
    );
    if (exists) {
      this.toast.error(`"${name}" already exists`);
      return;
    }

    this.isSaving.set(true);
    try {
      const newArea = await this.firestoreService.addDocument('serviceAreas', {
        name,
        tenantId: 1,
        isDeleted: false,
        createdAt: serverTimestamp(),
      });

      // Optimistically add to list
      const added = { id: newArea.id, name };
      this.serviceAreas.update(list =>
        [...list, added].sort((a, b) => a.name.localeCompare(b.name))
      );

      // Select it immediately
      this.selectedChange.emit(added);
      this.showDropdown.set(false);
      this.showAddForm.set(false);
      this.newAreaName.set('');
      this.toast.success(`"${name}" added and selected`);
    } catch (err) {
      console.error('Error saving service area:', err);
      this.toast.error('Failed to save service area');
    } finally {
      this.isSaving.set(false);
    }
  }
}
