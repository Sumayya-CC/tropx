import { Injectable, inject, computed, signal, effect } from '@angular/core';
import { Auth, signInWithEmailAndPassword, signOut,
  sendPasswordResetEmail, authState, getIdToken } from '@angular/fire/auth';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { Subscription } from 'rxjs';
import { FirestoreService } from './firestore.service';
import { AppUser, UserRole } from '../models/user.model';
import { ActionBy } from '../models/action-by.model';

const ROLE_PERMISSIONS: Record<UserRole, readonly string[]> = {
  admin: ['*'],
  manager: [
    'viewProducts', 'editProducts', 'viewOrders', 'manageOrders',
    'viewPayments', 'recordPayments', 'viewCustomers', 'manageCustomers',
    'addCustomer', 'adjustStock', 'viewDashboard', 'viewReports', 'approveAccess',
  ],
  sales_rep: [
    'viewProducts', 'viewOrders', 'manageOrders',
    'viewPayments', 'recordPayments', 'viewCustomers', 'addCustomer',
  ],
  warehouse: [
    'viewProducts', 'viewOrders', 'manageOrders', 'adjustStock', 'viewCustomers',
  ],
  customer: [
    'viewOwnProfile', 'viewOwnOrders', 'viewOwnCart',
    'viewOwnPayments', 'viewOwnTotals', 'browseProducts',
  ],
};

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly _auth = inject(Auth);
  private readonly _firestore = inject(FirestoreService);

  private readonly _currentUser = toSignal(authState(this._auth), { initialValue: null });
  private readonly _currentProfile = signal<AppUser | null>(null);

  readonly currentUser = computed(() => this._currentUser());
  readonly currentProfile = this._currentProfile.asReadonly();
  readonly isLoggedIn = computed(() => !!this._currentUser());
  readonly role = computed(() => this._currentProfile()?.role ?? null);
  readonly isAdmin = computed(() => this.role() === 'admin');
  readonly isStaff = computed(() => {
    const r = this.role();
    return r === 'admin' || r === 'manager' || r === 'sales_rep' || r === 'warehouse';
  });

  // Re-expose observables for guards to prevent breaking changes
  readonly user$ = toObservable(this.currentUser);
  readonly userProfile$ = toObservable(this.currentProfile);

  constructor() {
    let profileSub: Subscription | null = null;

    // effect() re-runs whenever _currentUser changes.
    // When user logs in: waits for ID token then subscribes to Firestore profile.
    // When user logs out: clears the profile signal immediately.
    effect(() => {
      const user = this._currentUser();
      
      // Clean up previous subscription before creating new one
      profileSub?.unsubscribe();
      profileSub = null;

      if (user) {
        // Wait for the ID token to be ready before reading Firestore.
        // The token must be attached to requests or security rules
        // will reject the read even for authenticated users.
        getIdToken(user).then(() => {
          profileSub = this._firestore
            .getDocument<AppUser>(`users/${user.uid}`)
            .subscribe(profile => this._currentProfile.set(profile));
        });

      } else {
        this._currentProfile.set(null);
      }
    });
  }



  hasPermission(permission: string): boolean {
    const r = this.role();
    if (!r) return false;
    const perms = ROLE_PERMISSIONS[r];
    return perms.includes('*') || perms.includes(permission);
  }

  login(email: string, password: string) {
    return signInWithEmailAndPassword(this._auth, email, password);
  }

  logout() {
    return signOut(this._auth);
  }

  resetPassword(email: string) {
    return sendPasswordResetEmail(this._auth, email);
  }

  getActionBy(): ActionBy | null {
    const profile = this._currentProfile();
    if (!profile) return null;

    return {
      uid: profile.uid,
      firstName: profile.firstName,
      lastName: profile.lastName,
    };
  }
}
