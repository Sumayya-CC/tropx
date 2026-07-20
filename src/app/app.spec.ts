import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { Firestore } from '@angular/fire/firestore';
import { Storage } from '@angular/fire/storage';
import { App } from './app';
import { FirestoreService } from './core/services/firestore.service';
import { AuthService } from './core/services/auth.service';

// App -> SettingsService reads several settings/* docs on construction via
// FirestoreService, and App -> MonitoringContextService reads AuthService's
// signals. Stub both (and the raw Firestore/Storage tokens SettingsService
// also injects but doesn't call at construction time) so this stays a
// pure, offline component test with no real Firebase project/emulator
// needed.
describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideZonelessChangeDetection(),
        { provide: FirestoreService, useValue: { getDocument: () => of(null) } },
        { provide: Firestore, useValue: {} },
        { provide: Storage, useValue: {} },
        { provide: AuthService, useValue: { currentProfile: () => null, isStaff: () => false } },
      ]
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render its root outlet and toast host', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('router-outlet')).toBeTruthy();
    expect(compiled.querySelector('app-toast')).toBeTruthy();
  });
});
