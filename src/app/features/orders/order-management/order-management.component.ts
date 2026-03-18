import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, OnDestroy, OnInit, Output, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subscription, finalize, retry, timeout, timer } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import {
  AdminOrderDetail,
  AdminOrderStatusAction,
  AdminOrderSummary,
  ShopService
} from '../../../core/services/shop.service';
import { formatPeso } from '../../../shared/utils/locale-format';

@Component({
  selector: 'app-order-management',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatCardModule],
  templateUrl: './order-management.component.html',
  styleUrls: ['./order-management.component.css']
})
export class OrderManagementComponent implements OnInit, OnChanges, OnDestroy {
  private static readonly LOAD_TIMEOUT_MS = 12000;
  private ordersSub?: Subscription;
  private detailSub?: Subscription;
  private actionSub?: Subscription;

  @Input() embeddedMode = false;
  @Input() reloadToken = 0;
  @Output() ordersChanged = new EventEmitter<void>();

  orders: AdminOrderSummary[] = [];
  selectedOrder: AdminOrderDetail | null = null;

  loading = false;
  detailLoading = false;
  actionLoading = false;
  errorMessage = '';
  successMessage = '';
  detailErrorMessage = '';

  searchTerm = '';
  statusFilter = '';
  page = 1;
  limit = 10;
  total = 0;

  detailOpen = false;

  constructor(private shopService: ShopService) {}

  ngOnInit(): void {
    this.loadOrders();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['reloadToken'] && !changes['reloadToken'].firstChange) {
      this.loadOrders();
    }
  }

  ngOnDestroy(): void {
    this.ordersSub?.unsubscribe();
    this.detailSub?.unsubscribe();
    this.actionSub?.unsubscribe();
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.total / this.limit));
  }

  applyFilters(): void {
    this.page = 1;
    this.loadOrders();
  }

  resetFilters(): void {
    this.searchTerm = '';
    this.statusFilter = '';
    this.page = 1;
    this.loadOrders();
  }

  prevPage(): void {
    if (this.page <= 1 || this.loading) {
      return;
    }

    this.page -= 1;
    this.loadOrders();
  }

  nextPage(): void {
    if (this.page >= this.totalPages || this.loading) {
      return;
    }

    this.page += 1;
    this.loadOrders();
  }

  retryLoad(): void {
    this.loadOrders();
  }

  openOrder(order: AdminOrderSummary): void {
    if (this.detailLoading || this.actionLoading) {
      return;
    }

    this.detailOpen = true;
    this.selectedOrder = null;
    this.detailErrorMessage = '';
    this.detailLoading = true;

    this.detailSub?.unsubscribe();
    this.detailSub = this.shopService
      .getAdminOrderDetail(order.id)
      .pipe(
        timeout(OrderManagementComponent.LOAD_TIMEOUT_MS),
        retry({ count: 1, delay: () => timer(250) }),
        finalize(() => (this.detailLoading = false))
      )
      .subscribe({
        next: detail => {
          this.selectedOrder = detail;
        },
        error: () => {
          this.detailErrorMessage = 'Unable to load order details. Please retry.';
        }
      });
  }

  closeDetail(): void {
    this.detailOpen = false;
    this.selectedOrder = null;
    this.detailErrorMessage = '';
    this.detailLoading = false;
  }

  handleOrderAction(action: AdminOrderStatusAction, order: AdminOrderSummary | AdminOrderDetail): void {
    if (this.actionLoading) {
      return;
    }

    const label = action === 'approve' ? 'approve' : action === 'fulfill' ? 'fulfill' : 'cancel';
    const confirmed = typeof window === 'undefined' ? true : window.confirm(`Are you sure you want to ${label} ${order.orderNo}?`);
    if (!confirmed) {
      return;
    }

    this.actionLoading = true;
    this.errorMessage = '';
    this.successMessage = '';

    this.actionSub?.unsubscribe();
    this.actionSub = this.shopService
      .updateOrderStatus(order.id, action)
      .pipe(finalize(() => (this.actionLoading = false)))
      .subscribe({
        next: updated => {
          this.successMessage = `Order ${updated.orderNo} saved successfully as ${updated.status}.`;
          this.ordersChanged.emit();
          this.loadOrders(false);

          if (this.detailOpen && this.selectedOrder?.id === updated.id) {
            this.openOrder(updated);
          }
        },
        error: error => {
          this.errorMessage =
            typeof error?.error?.message === 'string'
              ? error.error.message
              : 'Unable to update the selected order.';
        }
      });
  }

  canApprove(order: AdminOrderSummary | AdminOrderDetail): boolean {
    return order.status === 'pending';
  }

  canFulfill(order: AdminOrderSummary | AdminOrderDetail): boolean {
    return order.status === 'pending' || order.status === 'approved';
  }

  canCancel(order: AdminOrderSummary | AdminOrderDetail): boolean {
    return order.status === 'pending' || order.status === 'approved';
  }

  formatMoney(value: number): string {
    return formatPeso(value);
  }

  trackByOrderId(_index: number, order: AdminOrderSummary): number {
    return order.id;
  }

  private loadOrders(clearMessages = true): void {
    this.ordersSub?.unsubscribe();
    this.loading = true;
    if (clearMessages) {
      this.errorMessage = '';
      this.successMessage = '';
    }

    this.ordersSub = this.shopService
      .getAdminOrders({
        page: this.page,
        limit: this.limit,
        status: this.statusFilter || undefined,
        search: this.searchTerm || undefined
      })
      .pipe(
        timeout(OrderManagementComponent.LOAD_TIMEOUT_MS),
        retry({ count: 1, delay: () => timer(250) }),
        finalize(() => (this.loading = false))
      )
      .subscribe({
        next: result => {
          this.orders = result.orders;
          this.total = result.total;

          if (this.page > this.totalPages) {
            this.page = this.totalPages;
            this.loadOrders(false);
          }
        },
        error: () => {
          this.orders = [];
          this.total = 0;
          this.errorMessage = 'Unable to load customer orders. Please retry.';
        }
      });
  }
}
