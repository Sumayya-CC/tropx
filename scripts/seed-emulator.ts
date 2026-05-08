import { initializeApp } from 'firebase/app';
import {
  getAuth,
  createUserWithEmailAndPassword,
  connectAuthEmulator,
  signInWithEmailAndPassword,
} from 'firebase/auth';
import {
  initializeFirestore,
  doc,
  setDoc,
  getDoc,
  collection,
  addDoc,
  connectFirestoreEmulator,
  serverTimestamp,
  query,
  where,
  getDocs,
} from 'firebase/firestore';
import { environment } from '../src/environments/environment';

/**
 * seed-emulator.ts
 *
 * This script seeds the local Firebase emulators with initial data.
 *
 * WHY USE THE CLIENT SDK INSTEAD OF ADMIN SDK?
 * ─────────────────────────────────────────────────────────────────────
 * Using the Client SDK ensures that we are testing the same data shapes
 * and constraints that the application will use. It also avoids
 * accidentally using features (like Admin SDK's bypass of security rules)
 * that won't be available in production client code.
 *
 * WHY FETCH FOR CUSTOM CLAIMS?
 * ─────────────────────────────────────────────────────────────────────
 * The Firebase Client SDK does not provide a way to set custom claims.
 * However, the Auth Emulator exposes a REST API for exactly this purpose.
 * This lets us set roles without needing the heavy Admin SDK in a client
 * context.
 */

const app = initializeApp(environment.firebase);
const auth = getAuth(app);
const db = initializeFirestore(app, {}, environment.databaseName);

// Connect to emulators
connectAuthEmulator(auth, 'http://localhost:9099');
connectFirestoreEmulator(db, 'localhost', 8080);

import * as admin from 'firebase-admin';

// Initialize Admin SDK for custom claims (Client SDK cannot do this)
process.env.FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9099';
admin.initializeApp({ projectId: environment.firebase.projectId });

async function setEmulatorCustomClaims(uid: string, claims: object) {
  try {
    await admin.auth().setCustomUserClaims(uid, claims);
    console.log(`✅ Set custom claims for ${uid}`);
  } catch (error) {
    console.error(`Error setting custom claims for ${uid}:`, error);
  }
}

async function seed() {
  console.log('🌱 Starting emulator seed...');

  const stats = {
    settings: 0,
    serviceAreas: 0,
    categories: 0,
    brands: 0,
    users: 0,
    customers: 0,
    products: 0,
  };

  // 1. SETTINGS
  const globalSettingsRef = doc(db, 'settings', 'global');
  const globalSettingsSnap = await getDoc(globalSettingsRef);
  if (!globalSettingsSnap.exists()) {
    await setDoc(globalSettingsRef, {
      businessName: 'Tropx Wholesale',
      displayName: 'Tropx Wholesale',
      address: { street: '', city: 'Kitchener', province: 'ON', postalCode: '', country: 'CA' },
      contact: { phone: '', email: '' },
      taxRate: 0.13,
      invoicingEnabled: false,
      invoicePrefix: 'INV-2026-',
      invoiceStartingNumber: 1,
      orderNotificationRecipients: [],
      tenantId: 1,
      isDeleted: false,
    });
    stats.settings++;
  }

  const contentSettingsRef = doc(db, 'settings', 'content');
  const contentSettingsSnap = await getDoc(contentSettingsRef);
  if (!contentSettingsSnap.exists()) {
    await setDoc(contentSettingsRef, {
      heroHeadline: "Stocking Canada's Stores, One Shelf at a Time",
      heroSubheadline: 'Reliable wholesale supply for convenience stores and gas stations across Ontario.',
      heroCtaText: 'Become a Wholesale Partner',
      aboutText: 'Tropx Wholesale is a federally incorporated Canadian distributor based in Kitchener, Ontario.',
      publicContactInfo: { phone: '', email: '', address: '', hours: '' },
      footerText: '© 2026 Tropx Enterprises Inc.',
      tenantId: 1,
    });
    stats.settings++;
  }

  // 2. SERVICE AREAS
  const serviceAreas = ['Kitchener', 'Waterloo', 'Cambridge', 'Guelph', 'Brantford'];
  for (const name of serviceAreas) {
    const q = query(collection(db, 'serviceAreas'), where('name', '==', name), where('tenantId', '==', 1));
    const snap = await getDocs(q);
    if (snap.empty) {
      await addDoc(collection(db, 'serviceAreas'), {
        name,
        active: true,
        tenantId: 1,
        isDeleted: false,
        createdAt: serverTimestamp(),
      });
      stats.serviceAreas++;
    }
  }

  // 3. CATEGORIES
  const categories = [
    'Chips & Snacks', 'Beverages', 'Juices', 'Candy & Chocolate',
    'Imported Goods', 'Dairy', 'Bakery', 'Household'
  ];
  const categoryIds: Record<string, string> = {};

  for (let i = 0; i < categories.length; i++) {
    const name = categories[i];
    const q = query(collection(db, 'categories'), where('name', '==', name), where('tenantId', '==', 1));
    const snap = await getDocs(q);
    if (snap.empty) {
      const docRef = await addDoc(collection(db, 'categories'), {
        name,
        displayOrder: i + 1,
        active: true,
        tenantId: 1,
        isDeleted: false,
        createdAt: serverTimestamp(),
      });
      categoryIds[name] = docRef.id;
      stats.categories++;
    } else {
      categoryIds[name] = snap.docs[0].id;
    }
  }

  // 4. BRANDS
  const brands = ['Lays', 'Pringles', 'Coca-Cola', 'Pepsi', 'Red Bull', 'Tropx Private Label', 'Other'];
  const brandIds: Record<string, string> = {};

  for (const name of brands) {
    const q = query(collection(db, 'brands'), where('name', '==', name), where('tenantId', '==', 1));
    const snap = await getDocs(q);
    if (snap.empty) {
      const docRef = await addDoc(collection(db, 'brands'), {
        name,
        active: true,
        tenantId: 1,
        isDeleted: false,
        createdAt: serverTimestamp(),
      });
      brandIds[name] = docRef.id;
      stats.brands++;
    } else {
      brandIds[name] = snap.docs[0].id;
    }
  }

  // 5. ADMIN USER
  const adminEmail = 'admin@tropxwholesale.ca';
  let adminUid = '';

  try {
    const userCred = await createUserWithEmailAndPassword(auth, adminEmail, 'Admin@123456');
    adminUid = userCred.user.uid;
    console.log(`👤 Created admin user: ${adminUid}`);
  } catch (e: any) {
    if (e.code === 'auth/email-already-in-use') {
      const userCred = await signInWithEmailAndPassword(auth, adminEmail, 'Admin@123456');
      adminUid = userCred.user.uid;
      console.log(`👤 Admin user already exists: ${adminUid}`);
    } else {
      console.error('Admin Auth Error:', e);
    }
  }

  if (adminUid) {
    await setEmulatorCustomClaims(adminUid, { role: 'admin', tenantId: 1 });
    const adminUserRef = doc(db, 'users', adminUid);
    const adminUserSnap = await getDoc(adminUserRef);
    if (!adminUserSnap.exists()) {
      await setDoc(adminUserRef, {
        name: 'Maqbool',
        email: adminEmail,
        role: 'admin',
        status: 'active',
        tenantId: 1,
        isDeleted: false,
        createdAt: serverTimestamp(),
      });
      stats.users++;
    }
  }

  // 6. SAMPLE CUSTOMER
  const customerEmail = 'teststore@example.com';
  let customerUid = '';

  try {
    const userCred = await createUserWithEmailAndPassword(auth, customerEmail, 'Store@123456');
    customerUid = userCred.user.uid;
    console.log(`👤 Created customer user: ${customerUid}`);
  } catch (e: any) {
    if (e.code === 'auth/email-already-in-use') {
      const userCred = await signInWithEmailAndPassword(auth, customerEmail, 'Store@123456');
      customerUid = userCred.user.uid;
      console.log(`👤 Customer user already exists: ${customerUid}`);
    } else {
      console.error('Customer Auth Error:', e);
    }
  }

  if (customerUid) {
    await setEmulatorCustomClaims(customerUid, { role: 'customer', tenantId: 1 });
    const qCustomer = query(collection(db, 'customers'), where('email', '==', customerEmail), where('tenantId', '==', 1));
    const snapCustomer = await getDocs(qCustomer);

    let customerId = '';
    if (snapCustomer.empty) {
      const customerRef = await addDoc(collection(db, 'customers'), {
        businessName: 'Test Gas Station',
        ownerName: 'Test Owner',
        email: customerEmail,
        phone: '519-555-0100',
        address: { street: '123 King St W', city: 'Kitchener', province: 'ON', postalCode: 'N2G 1A1', country: 'CA' },
        status: 'active',
        source: 'admin_created',
        tenantId: 1,
        totalOrderedCents: 0,
        totalPaidCents: 0,
        totalOwingCents: 0,
        currencyCode: 'CAD',
        isDeleted: false,
        createdAt: serverTimestamp(),
        linkedUserId: customerUid,
      });
      customerId = customerRef.id;
      stats.customers++;
    } else {
      customerId = snapCustomer.docs[0].id;
    }

    const customerUserRef = doc(db, 'users', customerUid);
    const customerUserSnap = await getDoc(customerUserRef);
    if (!customerUserSnap.exists()) {
      await setDoc(customerUserRef, {
        name: 'Test Owner',
        email: customerEmail,
        role: 'customer',
        status: 'active',
        tenantId: 1,
        linkedCustomerId: customerId,
        isDeleted: false,
        createdAt: serverTimestamp(),
      });
      stats.users++;
    }
  }

  // 7. SAMPLE PRODUCTS
  const productsData = [
    {
      name: 'Lays Classic Chips',
      description: 'Classic salted potato chips',
      sku: 'LAY-CLASS-40G',
      barcode: '060410013222',
      measurement: { quantity: 40, unit: 'g' },
      priceCents: 199,
      costCents: 89,
      category: 'Chips & Snacks',
      brand: 'Lays',
      stock: 100,
      lowStockThreshold: 20
    },
    {
      name: 'Coca-Cola 355mL Can',
      description: 'Classic Coca-Cola sparkling soft drink',
      sku: 'COKE-355-CAN',
      barcode: '049000028911',
      measurement: { quantity: 355, unit: 'mL' },
      priceCents: 149,
      costCents: 65,
      category: 'Beverages',
      brand: 'Coca-Cola',
      stock: 200,
      lowStockThreshold: 50
    },
    {
      name: 'Red Bull Energy 250mL',
      description: 'Energy drink',
      sku: 'RBULL-250-CAN',
      barcode: '',
      measurement: { quantity: 250, unit: 'mL' },
      priceCents: 349,
      costCents: 189,
      category: 'Beverages',
      brand: 'Red Bull',
      stock: 80,
      lowStockThreshold: 20
    }
  ];

  for (const p of productsData) {
    const q = query(collection(db, 'products'), where('sku', '==', p.sku), where('tenantId', '==', 1));
    const snap = await getDocs(q);
    if (snap.empty) {
      await addDoc(collection(db, 'products'), {
        name: p.name,
        description: p.description || '',
        sku: p.sku,
        barcode: p.barcode || '',
        measurement: p.measurement,
        priceCents: p.priceCents,
        costCents: p.costCents,
        currencyCode: 'CAD',
        imageUrl: '',
        stock: p.stock,
        lowStockThreshold: p.lowStockThreshold,
        active: true,
        categoryId: categoryIds[p.category] || '',
        brandId: brandIds[p.brand] || '',
        tenantId: 1,
        isDeleted: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: 'admin-system',
      });
      stats.products++;
    }
  }

  console.log('\n✅ Seeding complete!');
  console.log('────────────────────────────────');
  console.log(`Settings:      ${stats.settings}`);
  console.log(`Service Areas: ${stats.serviceAreas}`);
  console.log(`Categories:    ${stats.categories}`);
  console.log(`Brands:        ${stats.brands}`);
  console.log(`Users:         ${stats.users}`);
  console.log(`Customers:     ${stats.customers}`);
  console.log(`Products:      ${stats.products}`);
  console.log('────────────────────────────────\n');

  process.exit(0);
}

seed().catch(err => {
  console.error('❌ Seeding failed:', err);
  process.exit(1);
});
