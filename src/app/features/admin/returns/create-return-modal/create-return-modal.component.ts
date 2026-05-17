import { Component, Input, Output, EventEmitter, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Firestore, doc, getDoc, collection, serverTimestamp } from '@angular/fire/firestore';
import { FirestoreService } from '../../../../core/services/firestore.service';
import { AuthService } from '../../../../core/services/auth.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { centsToDisplay } from '../../../../shared/utils/currency.utils';
import { Order, OrderItem } from '../../../../core/models/order.model';
import { 
  Return, 
  ReturnItem, 
  ReturnType, 
  ReturnReasonCode, 
  RefundMethod, 
  RETURN_REASON_LABELS, 
  REFUND_METHOD_LABELS 
} from '../../../../core/models/return.model';

interface SelectionItem {
  productId: string;
  productName: string;
  productSku: string;
  orderedQty: number;
  unitPriceCents: number;
  selected: boolean;
  returnQty: number;
}

@Component({
  selector: 'app-create-return-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './create-return-modal.component.html',
  styleUrl: './create-return-modal.component.scss'
})
export class CreateReturnModalComponent implements OnInit {
  private readonly firestore = inject(FirestoreService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly db = inject(Firestore);

  @Input({ required: true }) order!: Order;
  @Output() closed = new EventEmitter<boolean>();

  // Form Signals
  returnType = signal<ReturnType>('credit_note');
  reasonCode = signal<ReturnReasonCode>('wrong_item');
  reason = signal('');
  internalNotes = signal('');
  refundMethod = signal<RefundMethod>('cash');
  refundReferenceNumber = signal('');
  isSubmitting = signal(false);

  // List of order items prepared for selection
  items = signal<SelectionItem[]>([]);

  reasonOptions = computed(() => {
    return Object.entries(RETURN_REASON_LABELS).map(([code, label]) => ({
      code: code as ReturnReasonCode,
      label
    }));
  });

  refundMethodOptions = computed(() => {
    return Object.entries(REFUND_METHOD_LABELS).map(([method, label]) => ({
      method: method as RefundMethod,
      label
    }));
  });

  ngOnInit() {
    if (this.order && this.order.items) {
      // Filter out any items with quantity <= 0 (if any exist)
      const selectable = this.order.items
        .filter(item => item.quantity > 0)
        .map(item => ({
          productId: item.productId,
          productName: item.productName,
          productSku: item.productSku,
          orderedQty: item.quantity,
          unitPriceCents: item.unitPriceCents,
          selected: false,
          returnQty: 1
        }));
      this.items.set(selectable);
    }
  }

  // Live total calculations
  liveSummary = computed(() => {
    const selected = this.items().filter(item => item.selected && item.returnQty > 0);
    const totalCount = selected.reduce((sum, item) => sum + item.returnQty, 0);
    const amountCents = selected.reduce((sum, item) => sum + (item.returnQty * item.unitPriceCents), 0);

    return {
      count: totalCount,
      amountCents,
      formattedAmount: centsToDisplay(amountCents)
    };
  });

  formatCurrency(cents: number): string {
    return centsToDisplay(cents);
  }

  onCheckboxChange(item: SelectionItem) {
    this.items.update(list =>
      list.map(i =>
        i.productId === item.productId
          ? { 
              ...i, 
              selected: !i.selected,
              returnQty: !i.selected ? (i.returnQty || 1) : i.returnQty
            }
          : i
      )
    );
  }

  onQtyChange(item: SelectionItem, event: any) {
    const raw = parseInt(event.target.value, 10);
    const qty = isNaN(raw) || raw < 1 
      ? 1 
      : raw > item.orderedQty 
        ? item.orderedQty 
        : raw;

    this.items.update(list =>
      list.map(i =>
        i.productId === item.productId
          ? { ...i, returnQty: qty }
          : i
      )
    );
  }

  close(saved = false) {
    this.closed.emit(saved);
  }

  async submitReturn() {
    // 1. Validation
    const selectedItems = this.items().filter(item => item.selected && item.returnQty > 0);
    if (selectedItems.length === 0) {
      this.toast.error('Must select at least 1 item to return');
      return;
    }

    if (!this.reason().trim()) {
      this.toast.error('Please provide a reason description');
      return;
    }

    const actionBy = this.auth.getActionBy();
    if (!actionBy) {
      this.toast.error('Authentication session not found');
      return;
    }

    this.isSubmitting.set(true);

    try {
      // 2. Fetch sequence and generate RET number outside the write batch
      // First get sequence ref
      const seqRef = doc(this.db, 'settings/returnSequence');
      const seqSnap = await getDoc(seqRef);
      
      let nextNumber = 1;
      if (seqSnap.exists()) {
        const seqData = seqSnap.data();
        nextNumber = (seqData['lastNumber'] || 0) + 1;
      }

      const year = new Date().getFullYear();
      const padded = String(nextNumber).padStart(4, '0');
      const returnNumber = `RET-${year}-${padded}`;

      // 3. Build ReturnItems snapshot list
      const returnItems: ReturnItem[] = selectedItems.map(item => ({
        productId: item.productId,
        productName: item.productName,
        productSku: item.productSku,
        quantity: item.returnQty,
        unitPriceCents: item.unitPriceCents,
        lineTotalCents: item.returnQty * item.unitPriceCents
      }));

      const amountCents = this.liveSummary().amountCents;

      // 4. Run the Firestore Write Batch
      await this.firestore.runBatch(async (batch, db) => {
        // a. Increment sequence
        const batchSeqRef = doc(db, 'settings/returnSequence');
        batch.set(batchSeqRef, { lastNumber: nextNumber, prefix: 'RET' }, { merge: true });

        // b. Create Return Document
        const returnDocRef = doc(collection(db, 'returns'));
        
        const returnData: Return = {
          id: returnDocRef.id,
          returnNumber,
          orderId: this.order.id,
          orderNumber: this.order.orderNumber,
          customerId: this.order.customerId,
          customerName: this.order.customerName,
          customerPhone: this.order.customerPhone || '',
          type: this.returnType(),
          status: 'pending',
          items: returnItems,
          amountCents,
          reasonCode: this.reasonCode(),
          reason: this.reason().trim(),
          internalNotes: this.internalNotes().trim() || null,
          stockRestored: false, // Stock decision is made by admin at approval time
          stockAdjustmentIds: [],
          tenantId: 1,
          createdAt: serverTimestamp(),
          createdBy: actionBy,
          isDeleted: false
        };

        if (this.returnType() === 'refund') {
          returnData.refundMethod = this.refundMethod();
          if (this.refundReferenceNumber().trim()) {
            returnData.refundReferenceNumber = this.refundReferenceNumber().trim();
          }
        }

        batch.set(returnDocRef, returnData);
      });

      this.toast.success(`Return ${returnNumber} submitted for review`);
      this.close(true);

    } catch (err) {
      console.error('Error submitting return:', err);
      this.toast.error('Failed to submit return');
    } finally {
      this.isSubmitting.set(false);
    }
  }
}
