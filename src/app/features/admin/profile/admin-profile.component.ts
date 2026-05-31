import { Component, inject, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Storage, ref, uploadBytes, getDownloadURL } from '@angular/fire/storage';
import { AuthService } from '../../../core/services/auth.service';
import { FirestoreService } from '../../../core/services/firestore.service';
import { ToastService } from '../../../shared/services/toast.service';

@Component({
  selector: 'app-admin-profile',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-profile.component.html',
  styleUrl: './admin-profile.component.scss'
})
export class AdminProfileComponent {
  private readonly auth = inject(AuthService);
  private readonly firestoreService = inject(FirestoreService);
  private readonly storage = inject(Storage);
  private readonly toast = inject(ToastService);

  isEditMode = signal(false);
  isSaving = signal(false);
  isUploadingAvatar = signal(false);
  isDirty = signal(false);

  private formLoaded = signal(false);

  // Form fields
  firstName = signal('');
  lastName = signal('');
  phone = signal('');
  avatarUrl = signal<string | null>(null);

  errors = signal<Record<string, string>>({});

  profile = computed(() =>
    this.auth.currentProfile()
  );

  userEmail = computed(() =>
    this.profile()?.email || ''
  );

  userRole = computed(() => {
    const role = this.profile()?.role || '';
    const map: Record<string, string> = {
      admin: 'Administrator',
      manager: 'Manager',
      sales_rep: 'Sales Representative',
      viewer: 'Viewer',
    };
    return map[role] || role;
  });

  initials = computed(() => {
    const f = this.firstName() || this.profile()?.firstName || '';
    const l = this.lastName() || this.profile()?.lastName || '';
    return ((f[0] || '') + (l[0] || ''))
      .toUpperCase() || '??';
  });

  // Load profile into form on init
  constructor() {
    effect(() => {
      const p = this.profile();
      if (p && !this.formLoaded()) {
        this.firstName.set(p.firstName || '');
        this.lastName.set(p.lastName || '');
        this.phone.set(p.phone || '');
        this.avatarUrl.set(p.avatarUrl || null);
        this.formLoaded.set(true);
      }
    });
  }

  enterEditMode() {
    this.isEditMode.set(true);
  }

  exitEditMode() {
    // Reset to current profile values
    const p = this.profile();
    if (p) {
      this.firstName.set(p.firstName || '');
      this.lastName.set(p.lastName || '');
      this.phone.set(p.phone || '');
      this.avatarUrl.set(p.avatarUrl || null);
    }
    this.isEditMode.set(false);
    this.isDirty.set(false);
    this.errors.set({});
  }

  markDirty() {
    this.isDirty.set(true);
  }

  validate(): boolean {
    const errs: Record<string, string> = {};
    if (!this.firstName().trim()) {
      errs['firstName'] = 'First name is required';
    }
    if (!this.lastName().trim()) {
      errs['lastName'] = 'Last name is required';
    }
    this.errors.set(errs);
    return Object.keys(errs).length === 0;
  }

  async save() {
    if (!this.validate()) return;

    const uid = this.profile()?.uid;
    if (!uid) return;

    this.isSaving.set(true);
    try {
      await this.firestoreService.updateDocument(
        `userProfiles/${uid}`,
        {
          firstName: this.firstName().trim(),
          lastName: this.lastName().trim(),
          phone: this.phone().trim(),
          avatarUrl: this.avatarUrl() || null,
        }
      );
      this.isDirty.set(false);
      this.isEditMode.set(false);
      this.toast.success('Profile updated');
    } catch (err) {
      console.error('Profile save error:', err);
      this.toast.error('Failed to save profile');
    } finally {
      this.isSaving.set(false);
    }
  }

  async onAvatarSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      this.toast.error('Please select an image file');
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      this.toast.error(
        'Image must be smaller than 2MB'
      );
      return;
    }

    const uid = this.profile()?.uid;
    if (!uid) return;

    this.isUploadingAvatar.set(true);
    try {
      const path =
        `userProfiles/${uid}/avatar_${Date.now()}`;
      const storageRef = ref(this.storage, path);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);
      this.avatarUrl.set(url);
      this.isDirty.set(true);
      this.toast.success('Avatar uploaded');
    } catch (err) {
      console.error('Avatar upload error:', err);
      this.toast.error('Failed to upload avatar');
    } finally {
      this.isUploadingAvatar.set(false);
      input.value = '';
    }
  }

  removeAvatar() {
    this.avatarUrl.set(null);
    this.isDirty.set(true);
  }


  getInitialLetter(): string {
    return (
      this.firstName() ||
      this.profile()?.firstName ||
      '?'
    ).charAt(0).toUpperCase();
  }
}
