import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { where, limit, orderBy } from '@angular/fire/firestore';
import { FirestoreService } from './firestore.service';
import { Shop } from '../models/shop.model';
import { Customer } from '../models/customer.model';
import { normalizeSearchName } from '../../shared/utils/text.utils';

@Injectable({ providedIn: 'root' })
export class ShopLinkService {
  private readonly firestore = inject(FirestoreService);

  /** Two-side link: IDs + flags on both, shop.status='customer', and fill an
   *  empty address on either side from the other (never overwrite a real one). */
  async linkCustomerAndShop(customerId: string, shopId: string): Promise<void> {
    const [customer, shop] = await Promise.all([
      firstValueFrom(this.firestore.getDocument<Customer>(`customers/${customerId}`)),
      firstValueFrom(this.firestore.getDocument<Shop>(`shops/${shopId}`)),
    ]);
    if (!customer || !shop) throw new Error('Customer or shop not found for linking');

    const custHasAddr = this.hasAddress(customer.address);
    const shopHasAddr = this.hasAddress(shop.address);

    await this.firestore.runBatch(async (batch, db) => {
      const { doc } = await import('@angular/fire/firestore');

      const custUpdate: any = { linkedShopId: shopId, hasShop: true };
      if (!custHasAddr && shopHasAddr) custUpdate.address = shop.address;

      const shopUpdate: any = { linkedCustomerId: customerId, hasCustomer: true, status: 'customer' };
      if (!shopHasAddr && custHasAddr) shopUpdate.address = customer.address;

      batch.update(doc(db, 'customers', customerId), custUpdate);
      batch.update(doc(db, 'shops', shopId), shopUpdate);
    });
  }

  async unlinkCustomerAndShop(
    customerId: string,
    shopId: string,
    newShopStatus: 'prospect' | 'dormant' | 'not_interested'
  ): Promise<void> {
    await this.firestore.runBatch(async (batch, db) => {
      const { doc } = await import('@angular/fire/firestore');
      const { deleteField } = await import('@angular/fire/firestore');

      batch.update(doc(db, 'customers', customerId), {
        linkedShopId: deleteField(),
        hasShop: false,
      });

      batch.update(doc(db, 'shops', shopId), {
        linkedCustomerId: deleteField(),
        hasCustomer: false,
        status: newShopStatus,
      });
    });
  }

  /** Prospect shops with no customer that look like this customer (phone / name). */
  async findShopSuggestionsForCustomer(customer: Customer): Promise<Shop[]> {
    const results: Shop[] = [];
    if (customer.phone) {
      results.push(...await firstValueFrom(this.firestore.getCollection<Shop>(
        'shops',
        where('tenantId', '==', 1), where('isDeleted', '==', false),
        where('hasCustomer', '==', false), where('phone', '==', customer.phone), limit(5),
      )));
    }
    results.push(...await firstValueFrom(this.firestore.getCollection<Shop>(
      'shops',
      where('tenantId', '==', 1), where('isDeleted', '==', false),
      where('hasCustomer', '==', false),
      where('searchName', '==', normalizeSearchName(customer.businessName)), limit(5),
    )));
    return this.mergeUnique(results);
  }

  /** Customers with no shop that look like this shop. */
  async findCustomerSuggestionsForShop(shop: Shop): Promise<Customer[]> {
    const results: Customer[] = [];
    if (shop.phone) {
      results.push(...await firstValueFrom(this.firestore.getCollection<Customer>(
        'customers',
        where('tenantId', '==', 1), where('isDeleted', '==', false),
        where('hasShop', '==', false), where('phone', '==', shop.phone), limit(5),
      )));
    }
    results.push(...await firstValueFrom(this.firestore.getCollection<Customer>(
      'customers',
      where('tenantId', '==', 1), where('isDeleted', '==', false),
      where('hasShop', '==', false),
      where('searchName', '==', normalizeSearchName(shop.name)), limit(5),
    )));
    return this.mergeUnique(results);
  }

  async listShopsWithoutCustomer(): Promise<Shop[]> {
    return firstValueFrom(this.firestore.getCollection<Shop>(
      'shops',
      where('tenantId', '==', 1), where('isDeleted', '==', false),
      where('hasCustomer', '==', false), orderBy('name'), limit(25),
    ));
  }

  async listCustomersWithoutShop(): Promise<Customer[]> {
    return firstValueFrom(this.firestore.getCollection<Customer>(
      'customers',
      where('tenantId', '==', 1), where('isDeleted', '==', false),
      where('hasShop', '==', false), orderBy('businessName'), limit(25),
    ));
  }

  private hasAddress(a: any): boolean {
    return !!(a && (a.street || a.city || a.province || a.postalCode));
  }
  private mergeUnique<T extends { id: string }>(items: T[]): T[] {
    const seen = new Set<string>();
    return items.filter(i => (seen.has(i.id) ? false : (seen.add(i.id), true)));
  }
}
