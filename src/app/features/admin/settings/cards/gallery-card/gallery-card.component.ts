import { Component, effect, inject, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Storage } from '@angular/fire/storage';
import { FirestoreService } from '../../../../../core/services/firestore.service';
import { ToastService } from '../../../../../shared/services/toast.service';
import { SettingsService } from '../../../../../core/services/settings.service';
import { StorefrontGalleryImage } from '../../../../../core/models/storefront-settings.model';

@Component({
  selector: 'app-gallery-card',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './gallery-card.component.html',
  styleUrl: './gallery-card.component.scss',
})
export class GalleryCardComponent {
  protected readonly settings = inject(SettingsService);
  private readonly firestore = inject(FirestoreService);
  private readonly toast = inject(ToastService);
  private readonly storage = inject(Storage);

  editingGallery = signal(false);
  isSaving = signal(false);

  galleryEnabled = signal(false);
  galleryImages = signal<StorefrontGalleryImage[]>([]);
  galleryUploadFile = signal<File | null>(null);
  galleryUploadPreview = signal<string>('');
  galleryUploadCaption = signal('');
  isUploadingGalleryImage = signal(false);

  // Own lightbox, scoped to this card's images — the shell still owns a
  // separate lightboxImageUrl/overlay for Featured Banner slides (not yet
  // extracted; will get its own copy the same way when S4 splits it out).
  lightboxImageUrl = signal<string | null>(null);

  constructor() {
    effect(() => {
      const sf = this.settings.storefront();
      // Only sync when not actively editing (prevents Firestore listener
      // from clobbering local edits) — matches the pre-split behavior.
      if (!untracked(() => this.editingGallery())) {
        this.galleryEnabled.set(sf.galleryEnabled);
        this.galleryImages.set(sf.galleryImages || []);
      }
    }, { allowSignalWrites: true });
  }

  cancelGallery() {
    const sf = this.settings.storefront();
    this.galleryEnabled.set(sf.galleryEnabled);
    this.galleryImages.set(sf.galleryImages || []);
    this.galleryUploadFile.set(null);
    this.galleryUploadPreview.set('');
    this.galleryUploadCaption.set('');
    this.editingGallery.set(false);
  }

  onGalleryFileSelected(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      this.toast.error('Please select an image file');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      this.toast.error('Image must be under 2MB');
      return;
    }
    this.galleryUploadFile.set(file);
    const reader = new FileReader();
    reader.onload = (e) => this.galleryUploadPreview.set(e.target?.result as string);
    reader.readAsDataURL(file);
  }

  async addGalleryImage() {
    const file = this.galleryUploadFile();
    if (!file) {
      this.toast.error('Please select an image first');
      return;
    }
    this.isUploadingGalleryImage.set(true);
    try {
      const { ref, uploadBytes, getDownloadURL } = await import('@angular/fire/storage');
      const path = `storefront/gallery/${Date.now()}_${file.name}`;
      const storageRef = ref(this.storage, path);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);

      const newImage: StorefrontGalleryImage = {
        id: crypto.randomUUID(),
        imageUrl: url,
        caption: this.galleryUploadCaption().trim(),
        createdAt: Date.now(),
      };

      this.galleryImages.update(list => [...list, newImage]);
      this.galleryUploadFile.set(null);
      this.galleryUploadPreview.set('');
      this.galleryUploadCaption.set('');
      this.toast.success('Image added — remember to save');
    } catch (err) {
      console.error(err);
      this.toast.error('Failed to upload image');
    } finally {
      this.isUploadingGalleryImage.set(false);
    }
  }

  removeGalleryImage(id: string) {
    this.galleryImages.update(list => list.filter(img => img.id !== id));
  }

  // Fixed S3: was setDocument(...spread) — a full-doc overwrite that raced
  // with Home Sections/Popular/Featured Banner cards saving the same
  // settings/storefront doc concurrently. Now a scoped partial merge,
  // matching Featured Banner/Popular's existing updateDocument use.
  async saveGallery() {
    this.isSaving.set(true);
    try {
      await this.firestore.updateDocument('settings/storefront', {
        galleryEnabled: this.galleryEnabled(),
        galleryImages: this.galleryImages(),
      });
      this.toast.success('Gallery saved');
      this.editingGallery.set(false);
    } catch (err) {
      console.error(err);
      this.toast.error('Failed to save gallery');
    } finally {
      this.isSaving.set(false);
    }
  }
}
