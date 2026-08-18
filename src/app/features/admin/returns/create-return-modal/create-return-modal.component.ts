import { Component, Input, Output, EventEmitter, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { ToastService } from '../../../../shared/services/toast.service';
import { centsToDisplay } from '../../../../shared/utils/currency.utils';
import { Order } from '../../../../core/models/order.model';
import { ReturnType, ReturnReasonCode, RETURN_REASON_LABELS } from '../../../../core/models/return.model';

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
  private readonly functions = inject(Functions);
  private readonly toast = inject(ToastService);

  @Input({ required: true }) order!: Order;
  @Output() closed = new EventEmitter<boolean>();

  // Form Signals
  returnType = signal<ReturnType>('credit_note');
  reasonCode = signal<ReturnReasonCode>('wrong_item');
  reason = signal('');
  internalNotes = signal('');
  isSubmitting = signal(false);

  // List of order items prepared for selection
  items = signal<SelectionItem[]>([]);

  reasonOptions = computed(() => {
    return Object.entries(RETURN_REASON_LABELS).map(([code, label]) => ({
      code: code as ReturnReasonCode,
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

  // Live total calculations — a client-side preview only. The server
  // (submitReturn) re-derives amountCents net-of-discount, plus-tax from
  // the order's frozen snapshot; this gross preview is close enough for
  // in-modal feedback but is never what actually gets stored.
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

  // Delegates to submitReturn (onCall) — same server-owned path the
  // portal uses, so quantity/price validation, the net-of-discount+tax
  // amountCents calc, and isFullReturn detection (which gates terminal
  // coupon release on approveReturn) all run for admin-created returns
  // too. Used to be a direct client Firestore batch write; that let an
  // admin-created full return silently skip coupon release since
  // isFullReturn was never stamped.
  async submitReturn() {
    const selectedItems = this.items().filter(item => item.selected && item.returnQty > 0);
    if (selectedItems.length === 0) {
      this.toast.error('Must select at least 1 item to return');
      return;
    }

    if (!this.reason().trim()) {
      this.toast.error('Please provide a reason description');
      return;
    }

    this.isSubmitting.set(true);

    try {
      const callable = httpsCallable<
        {
          orderId: string;
          items: { productId: string; quantity: number }[];
          returnType: ReturnType;
          reasonCode: ReturnReasonCode;
          notes: string;
          internalNotes: string;
        },
        { returnId: string; returnNumber: string }
      >(this.functions, 'submitReturn');

      const res = await callable({
        orderId: this.order.id,
        items: selectedItems.map(item => ({ productId: item.productId, quantity: item.returnQty })),
        returnType: this.returnType(),
        reasonCode: this.reasonCode(),
        notes: this.reason().trim(),
        internalNotes: this.internalNotes().trim(),
      });

      this.toast.success(`Return ${res.data.returnNumber} submitted for review`);
      this.close(true);
    } catch (err: any) {
      console.error('Error submitting return:', err);
      this.toast.error(err?.message || 'Failed to submit return');
    } finally {
      this.isSubmitting.set(false);
    }
  }
}
