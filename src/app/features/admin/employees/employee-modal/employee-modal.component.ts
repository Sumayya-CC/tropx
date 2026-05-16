import { Component, EventEmitter, Input, Output, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { FirestoreService } from '../../../../core/services/firestore.service';
import { AuthService } from '../../../../core/services/auth.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { AppUser, UserRole, UserStatus } from '../../../../core/models/user.model';
import { LoadingSpinnerComponent } from '../../../../shared/components/loading-spinner/loading-spinner.component';
import { serverTimestamp, doc, onSnapshot } from '@angular/fire/firestore';
import { Firestore } from '@angular/fire/firestore';

@Component({
  selector: 'app-employee-modal',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, LoadingSpinnerComponent],
  templateUrl: './employee-modal.component.html',
  styleUrls: ['./employee-modal.component.scss']
})
export class EmployeeModalComponent implements OnInit {
  @Input() employee?: AppUser;
  @Output() closed = new EventEmitter<boolean>();

  private fb = inject(FormBuilder);
  private firestoreService = inject(FirestoreService);
  private db = inject(Firestore);
  private auth = inject(AuthService);
  private toast = inject(ToastService);

  form!: FormGroup;
  isSubmitting = signal(false);
  showPassword = signal(false);

  roles: { value: UserRole; label: string }[] = [
    { value: 'admin', label: 'Admin' },
    { value: 'manager', label: 'Manager' },
    { value: 'sales_rep', label: 'Sales Rep' },
    { value: 'warehouse', label: 'Warehouse' }
  ];

  statuses: { value: UserStatus; label: string }[] = [
    { value: 'active', label: 'Active' },
    { value: 'suspended', label: 'Suspended' }
  ];

  ngOnInit() {
    this.initForm();
  }

  private initForm() {
    this.form = this.fb.group({
      firstName: [this.employee?.firstName || '', [Validators.required]],
      lastName: [this.employee?.lastName || '', [Validators.required]],
      phone: [this.employee?.phone || ''],
      role: [this.employee?.role || '', [Validators.required]],
    });

    if (!this.employee) {
      // Add mode
      this.form.addControl('email', this.fb.control('', [Validators.required, Validators.email]));
    } else {
      // Edit mode
      this.form.addControl('status', this.fb.control(this.employee.status || 'active', [Validators.required]));
    }
  }

  togglePassword() {
    this.showPassword.update(v => !v);
  }

  async onSubmit() {
    if (this.form.invalid || this.isSubmitting()) return;

    this.isSubmitting.set(true);
    const data = this.form.value;

    try {
      if (this.employee) {
        await this.handleUpdate(data);
      } else {
        await this.handleCreate(data);
      }
    } catch (error: any) {
      console.error('Error saving employee:', error);
      this.toast.error(error.message || 'An error occurred');
      this.isSubmitting.set(false);
    }
  }

  private async handleUpdate(data: any) {
    // Prevent changing your own role or status
    const currentUserId = this.auth.currentUser()?.uid;
    if (this.employee?.uid === currentUserId) {
      if (data.role !== this.employee?.role || data.status !== this.employee?.status) {
        throw new Error('You cannot change your own role or status');
      }
    }

    const updates: any = {
      firstName: data.firstName,
      lastName: data.lastName,
      phone: data.phone || null,
      role: data.role,
      status: data.status,
      updatedAt: serverTimestamp()
    };

    const oldStatus = this.employee?.status;
    const newStatus = data.status;

    await this.firestoreService.updateDocument(`users/${this.employee!.uid}`, updates);

    if (oldStatus !== newStatus) {
      const action = newStatus === 'suspended' ? 'disable' : 'enable';
      await this.firestoreService.addDocument('authActions', {
        action,
        uid: this.employee!.uid,
        createdAt: serverTimestamp(),
        tenantId: 1
      });
    }

    this.toast.success('Employee updated successfully');
    this.closed.emit(true);
  }

  private async handleCreate(data: any) {
    const invitation = {
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email,
      phone: data.phone || null,
      role: data.role,
      temporaryPassword: this.generatePassword(),
      tenantId: 1,
      status: 'pending',
      createdBy: this.auth.getActionBy(),
      createdAt: serverTimestamp(),
      isDeleted: false
    };

    const docRef = await this.firestoreService.addDocument('employeeInvitations', invitation);
    
    // Poll for status
    this.pollInvitation(docRef.id);
  }

  private pollInvitation(docId: string) {
    let attempts = 0;
    const maxAttempts = 15; // 15 * 2s = 30s
    
    const unsub = onSnapshot(doc(this.db, 'employeeInvitations', docId), (snapshot) => {
      const data = snapshot.data();
      if (data?.['status'] === 'processed') {
        unsub();
        this.toast.success('Employee created successfully');
        this.closed.emit(true);
      } else if (data?.['status'] === 'error') {
        unsub();
        this.toast.error(data?.['error'] || 'Failed to create employee');
        this.isSubmitting.set(false);
      }
      
      attempts++;
      if (attempts >= maxAttempts) {
        unsub();
        this.toast.warning('Employee may have been created — please refresh the list.');
        this.closed.emit(true);
      }
    });
  }

  private generatePassword(): string {
    const chars = 
      'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz' +
      '23456789!@#$%';
    let password = '';
    for (let i = 0; i < 12; i++) {
      password += chars.charAt(
        Math.floor(Math.random() * chars.length)
      );
    }
    return password;
  }

  close() {
    this.closed.emit(false);
  }
}
