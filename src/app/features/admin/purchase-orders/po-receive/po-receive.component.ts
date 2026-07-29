import { Component, inject, signal, computed, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { FirestoreService } from '../../../../core/services/firestore.service';
import { SettingsService } from '../../../../core/services/settings.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { PurchaseOrder } from '../../../../core/models/purchase-order.model';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { LoadingSpinnerComponent } from '../../../../shared/components/loading-spinner/loading-spinner.component';
import { where } from '@angular/fire/firestore';
import { todayInputValue } from '../../../../shared/utils/date.utils';

interface ReceiveRow {
  productId: string;
  productName: string;
  productSku: string;
  quantityOrdered: number;
  quantityReceived: number;
  remaining: number;
  receiveNow: number;
  unitCostCents: number;
}

@Component({
  selector: 'app-po-receive',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, PageHeaderComponent, LoadingSpinnerComponent],
  template: `
    @if (isLoading()) {
      <app-loading-spinner></app-loading-spinner>
    } @else if (po()) {
      <app-page-header 
        [title]="'Receive Items: ' + po()!.poNumber" 
        [backLink]="'/admin/purchase-orders/' + po()!.id"
        backLinkLabel="Back to PO">
      </app-page-header>

      <div class="content-grid">
        <div class="main-column">
          <div class="card">
            <h3>Receive Quantities</h3>
            <table class="receive-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th style="text-align:center">Ordered</th>
                  <th style="text-align:center">Previously Received</th>
                  <th style="text-align:center">Remaining</th>
                  <th style="text-align:center">Receive Now</th>
                </tr>
              </thead>
              <tbody>
                @for (row of rows(); track row.productId; let i = $index) {
                  <tr>
                    <td>
                      <div class="fw-bold">{{ row.productName }}</div>
                      <div class="sku">{{ row.productSku }}</div>
                    </td>
                    <td style="text-align:center">{{ row.quantityOrdered }}</td>
                    <td style="text-align:center">{{ row.quantityReceived }}</td>
                    <td style="text-align:center; font-weight:600;">{{ row.remaining }}</td>
                    <td style="text-align:center">
                      <input type="number" class="qty-input"
                        min="0" [max]="row.remaining"
                        [ngModel]="row.receiveNow"
                        (ngModelChange)="updateReceiveNow(i, $event)"
                        [disabled]="row.remaining === 0">
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>

          <div class="card">
            <h3>Notes</h3>
            <textarea rows="3" [ngModel]="notes()" (ngModelChange)="notes.set($event)" placeholder="Delivery notes, waybill numbers, or damage remarks..."></textarea>
          </div>
        </div>

        <div class="side-column">
          <div class="card">
            <h3>Receipt Info</h3>
            
            <div class="form-group">
              <label>Received Date</label>
              <input type="date" [ngModel]="receivedDate()" (ngModelChange)="receivedDate.set($event)">
            </div>

            @if (inventorySettings().multiWarehouseEnabled) {
              <div class="form-group">
                <label>Warehouse</label>
                <select [ngModel]="warehouseId()" (ngModelChange)="warehouseId.set($event)">
                  <option value="">-- Select Warehouse --</option>
                  @for (w of warehouses(); track w.id) {
                    <option [value]="w.id">{{ w.name }}</option>
                  }
                </select>
              </div>
            } @else {
              <div class="info-item">
                <label>Warehouse</label>
                <div>{{ po()!.warehouseName }}</div>
              </div>
            }

            <button class="btn-save" (click)="saveReceive()" [disabled]="isSaving() || totalReceivingNow() === 0">
              {{ isSaving() ? 'Saving...' : 'Confirm Receipt' }}
            </button>
          </div>
        </div>
      </div>
    } @else {
      <div class="error-state">
        <h3>PO Not Found or Not Receivable</h3>
        <button class="btn-outline" routerLink="/admin/purchase-orders">Back to POs</button>
      </div>
    }
  `,
  styles: [`
    .content-grid {
      display: grid;
      grid-template-columns: 1fr 350px;
      gap: 24px;
      align-items: start;
    }
    .card {
      background: #fff;
      border-radius: 12px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      padding: 24px;
      margin-bottom: 24px;

      h3 {
        margin: 0 0 20px 0;
        font-size: 1.1rem;
        color: #0f172a;
        border-bottom: 1px solid #f1f5f9;
        padding-bottom: 12px;
      }
    }
    .receive-table {
      width: 100%;
      border-collapse: collapse;
      th {
        text-align: left;
        padding: 12px 8px;
        font-size: 0.8rem;
        color: #64748b;
        text-transform: uppercase;
        border-bottom: 2px solid #f1f5f9;
      }
      td {
        padding: 16px 8px;
        border-bottom: 1px solid #f1f5f9;
      }
      .fw-bold { font-weight: 600; color: #0f172a; }
      .sku { font-size: 0.8rem; color: #64748b; font-family: monospace; }
      .qty-input {
        width: 80px;
        padding: 8px;
        border: 1px solid #cbd5e1;
        border-radius: 6px;
        text-align: center;
        font-weight: 600;
        &:focus { outline: none; border-color: #0f172a; }
        &:disabled { background: #f8fafc; color: #94a3b8; }
      }
    }
    .form-group {
      margin-bottom: 16px;
      label {
        display: block;
        font-size: 0.85rem;
        font-weight: 600;
        color: #475569;
        margin-bottom: 6px;
      }
      input, select, textarea {
        width: 100%;
        padding: 10px;
        border: 1px solid #cbd5e1;
        border-radius: 6px;
        font-size: 0.95rem;
        &:focus { outline: none; border-color: #0f172a; }
      }
    }
    .info-item {
      margin-bottom: 16px;
      label {
        display: block;
        font-size: 0.85rem;
        font-weight: 600;
        color: #475569;
        margin-bottom: 6px;
      }
      div { font-weight: 500; color: #0f172a; }
    }
    textarea {
      width: 100%;
      padding: 12px;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      font-size: 0.95rem;
      resize: vertical;
    }
    .btn-save {
      width: 100%;
      margin-top: 16px;
      padding: 14px;
      background: #0f172a;
      color: #fff;
      border: none;
      border-radius: 8px;
      font-weight: 600;
      font-size: 1rem;
      cursor: pointer;
      &:hover:not(:disabled) { background: #1e293b; }
      &:disabled { opacity: 0.7; cursor: not-allowed; }
    }
    .error-state {
      text-align: center;
      padding: 60px 20px;
      h3 { margin-bottom: 16px; }
      .btn-outline {
        padding: 8px 16px;
        border: 1px solid #cbd5e1;
        border-radius: 6px;
        background: #fff;
        cursor: pointer;
      }
    }
  `]
})
export class PoReceiveComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly firestore = inject(FirestoreService);
  private readonly functions = inject(Functions);
  private readonly settings = inject(SettingsService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  poId = this.route.snapshot.paramMap.get('id') || '';
  po = signal<PurchaseOrder | null>(null);
  isLoading = signal(true);
  isSaving = signal(false);

  rows = signal<ReceiveRow[]>([]);
  notes = signal('');
  receivedDate = signal(todayInputValue());
  warehouseId = signal('');
  warehouses = signal<any[]>([]);
  inventorySettings = this.settings.inventory;

  totalReceivingNow = computed(() => this.rows().reduce((sum, r) => sum + r.receiveNow, 0));

  constructor() {
    this.loadData();
  }

  async loadData() {
    try {
      this.firestore.getDocument<PurchaseOrder>(`purchaseOrders/${this.poId}`).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(po => {
        if (!po || (po.status !== 'sent' && po.status !== 'partially_received')) {
          this.po.set(null);
          this.isLoading.set(false);
          return;
        }
        
        this.po.set(po);
        this.warehouseId.set(po.warehouseId);

        const initialRows = po.items.map(item => {
          const remaining = item.quantityOrdered - item.quantityReceived;
          return {
            productId: item.productId,
            productName: item.productName,
            productSku: item.productSku,
            quantityOrdered: item.quantityOrdered,
            quantityReceived: item.quantityReceived,
            remaining,
            receiveNow: remaining,
            unitCostCents: item.unitCostCents
          };
        });
        this.rows.set(initialRows);

        if (this.inventorySettings().multiWarehouseEnabled) {
          this.firestore.getCollection<any>('warehouses', where('tenantId', '==', 1))
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(ws => this.warehouses.set(ws.filter(w => !w.isDeleted && w.active)));
        }

        this.isLoading.set(false);
      });
    } catch (e) {
      this.isLoading.set(false);
    }
  }

  updateReceiveNow(index: number, val: string | number) {
    let qty = typeof val === 'string' ? parseInt(val, 10) : val;
    if (isNaN(qty)) qty = 0;
    
    const current = [...this.rows()];
    if (qty > current[index].remaining) qty = current[index].remaining;
    if (qty < 0) qty = 0;
    
    current[index].receiveNow = qty;
    this.rows.set(current);
  }

  // Runs server-side (Admin SDK, runTransaction) rather than a client
  // writeBatch preceded by a separate getNextReceiveNumber() transaction:
  // that split meant a receive-number could be consumed even if the batch
  // that followed it failed, and a getDoc() read of each product was never
  // re-validated at commit time. See receivePurchaseOrder in
  // functions/src/index.ts.
  async saveReceive() {
    const order = this.po();
    if (!order) return;

    if (this.totalReceivingNow() === 0) {
      this.toast.error('Must receive at least one item');
      return;
    }

    const invSettings = this.inventorySettings();
    if (invSettings.multiWarehouseEnabled && !this.warehouseId()) {
      this.toast.error('Select a warehouse');
      return;
    }

    this.isSaving.set(true);
    try {
      const callable = httpsCallable<
        {
          purchaseOrderId: string;
          rows: { productId: string; receiveNow: number }[];
          notes: string;
          receivedDate: string;
          warehouseId: string;
        },
        { receiveNumber: string; purchaseOrderId: string }
      >(this.functions, 'receivePurchaseOrder');

      const res = await callable({
        purchaseOrderId: order.id,
        rows: this.rows()
          .filter(r => r.receiveNow > 0)
          .map(r => ({ productId: r.productId, receiveNow: r.receiveNow })),
        notes: this.notes(),
        receivedDate: this.receivedDate(),
        warehouseId: this.warehouseId(),
      });

      this.toast.success(`Received goods successfully (GRN: ${res.data.receiveNumber})`);
      this.router.navigate(['/admin/purchase-orders', order.id]);
    } catch (err: any) {
      console.error('Receive error', err);
      this.toast.error(err?.message || 'Failed to process receipt');
    } finally {
      this.isSaving.set(false);
    }
  }
}
