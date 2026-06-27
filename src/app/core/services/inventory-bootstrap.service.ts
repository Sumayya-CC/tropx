import { Injectable, inject } from '@angular/core';
import { Firestore, collection, getDocs, query, where, setDoc, doc, serverTimestamp } from '@angular/fire/firestore';

@Injectable({ providedIn: 'root' })
export class InventoryBootstrapService {
  private readonly firestore = inject(Firestore);
  private hasRun = false;

  async bootstrap(): Promise<void> {
    if (this.hasRun) return;
    this.hasRun = true;

    try {
      const warehousesRef = collection(this.firestore, 'warehouses');
      const q = query(
        warehousesRef,
        where('tenantId', '==', 1),
        where('isDeleted', '==', false)
      );
      
      const snap = await getDocs(q);
      if (snap.empty) {
        // Create Main Warehouse
        const newWarehouseRef = doc(warehousesRef);
        await setDoc(newWarehouseRef, {
          name: 'Main Warehouse',
          code: 'MAIN',
          isDefault: true,
          active: true,
          tenantId: 1,
          isDeleted: false,
          country: 'Canada',
          createdAt: serverTimestamp()
        });

        // Write settings/inventory
        const inventoryRef = doc(this.firestore, 'settings/inventory');
        await setDoc(inventoryRef, {
          defaultWarehouseId: newWarehouseRef.id,
          defaultWarehouseName: 'Main Warehouse',
          multiWarehouseEnabled: false
        }, { merge: true });
        
        console.log('Bootstrapped Main Warehouse successfully');
      }
    } catch (err) {
      console.error('Failed to bootstrap inventory:', err);
    }
  }
}
