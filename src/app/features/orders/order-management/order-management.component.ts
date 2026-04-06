import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectorRef, Component, EventEmitter, Input, OnChanges, OnDestroy, OnInit, Output, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import { Subscription, TimeoutError, distinctUntilChanged, filter, finalize, map, retry, startWith, timeout, timer } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import {
  AdminOrderDetail,
  AdminOrderStatusAction,
  AdminOrderSummary,
  ShopService
} from '../../../core/services/shop.service';
import { formatPeso } from '../../../shared/utils/locale-format';
import { AppRefreshService } from '../../../core/services/app-refresh.service';

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
  private routeActivationSub?: Subscription;
  private ordersLoadId = 0;
  private detailLoadId = 0;
  private destroyed = false;
  private routeLoadQueued = false;

  @Input() embeddedMode = false;
  @Input() reloadToken = 0;
  @Output() ordersChanged = new EventEmitter<void>();

  orders: AdminOrderSummary[] = [];
  selectedOrder: AdminOrderDetail | null = null;

  loading = false;
  detailLoading = false;
  actionLoading = false;
  errorMessage = '';
  errorDetail = '';
  successMessage = '';
  detailErrorMessage = '';
  detailErrorDetail = '';

  searchTerm = '';
  statusFilter = '';
  page = 1;
  limit = 10;
  total = 0;

  detailOpen = false;
  readonly skeletonRows = Array.from({ length: 4 });
  readonly skeletonColumns = Array.from({ length: 8 });

  constructor(
    private shopService: ShopService,
    private appRefreshService: AppRefreshService,
    private route: ActivatedRoute,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.bindRouteActivation();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['reloadToken'] && !changes['reloadToken'].firstChange) {
      this.loadOrders();
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.ordersLoadId += 1;
    this.detailLoadId += 1;
    this.routeActivationSub?.unsubscribe();
    this.ordersSub?.unsubscribe();
    this.detailSub?.unsubscribe();
    this.actionSub?.unsubscribe();
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.total / this.limit));
  }

  get showEmptyState(): boolean {
    return !this.loading && !this.errorMessage && this.orders.length === 0;
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
    this.detailErrorDetail = '';
    this.detailLoading = true;
    this.requestViewRefresh();
    const detailLoadId = ++this.detailLoadId;
    const detailEndpoint = this.shopService.getAdminOrderDetailEndpoint(order.id);

    this.detailSub?.unsubscribe();
    this.detailSub = this.shopService
      .getAdminOrderDetail(order.id)
      .pipe(
        timeout(OrderManagementComponent.LOAD_TIMEOUT_MS),
        retry({ count: 1, delay: () => timer(250) }),
        finalize(() => {
          if (detailLoadId === this.detailLoadId) {
            this.detailLoading = false;
            this.requestViewRefresh();
          }
        })
      )
      .subscribe({
        next: detail => {
          if (detailLoadId !== this.detailLoadId) {
            return;
          }
          this.selectedOrder = detail;
          this.detailErrorMessage = '';
          this.detailErrorDetail = '';
          this.requestViewRefresh();
        },
        error: error => {
          if (detailLoadId !== this.detailLoadId) {
            return;
          }
          console.error('Failed to load admin order details.', {
            endpoint: detailEndpoint,
            orderId: order.id,
            error
          });
          const requestError = this.describeRequestError(error, {
            endpoint: detailEndpoint,
            fallbackMessage: 'Unable to load order details.'
          });
          this.detailErrorMessage = requestError.message;
          this.detailErrorDetail = requestError.detail;
          this.requestViewRefresh();
        }
      });
  }

  closeDetail(): void {
    this.detailLoadId += 1;
    this.detailSub?.unsubscribe();
    this.detailOpen = false;
    this.selectedOrder = null;
    this.detailErrorMessage = '';
    this.detailErrorDetail = '';
    this.detailLoading = false;
    this.requestViewRefresh();
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
    this.errorDetail = '';
    this.successMessage = '';
    this.requestViewRefresh();
    const statusEndpoint = this.shopService.getAdminOrderStatusEndpoint(order.id);

    this.actionSub?.unsubscribe();
    this.actionSub = this.shopService
      .updateOrderStatus(order.id, action)
      .pipe(
        finalize(() => {
          this.actionLoading = false;
          this.requestViewRefresh();
        })
      )
      .subscribe({
        next: updated => {
          this.successMessage = `Order ${updated.orderNo} saved successfully as ${updated.status}.`;
          this.errorDetail = '';
          this.appRefreshService.request('order-status-updated', ['dashboard', 'inventory', 'products', 'transactions', 'orders', 'shop']);
          this.ordersChanged.emit();
          this.loadOrders(false);

          if (this.detailOpen && this.selectedOrder?.id === updated.id) {
            this.openOrder(updated);
          }
          this.requestViewRefresh();
        },
        error: error => {
          console.error('Failed to update admin order status.', {
            endpoint: statusEndpoint,
            orderId: order.id,
            action,
            error
          });
          const requestError = this.describeRequestError(error, {
            endpoint: statusEndpoint,
            fallbackMessage: 'Unable to update the selected order.'
          });
          this.errorMessage = requestError.message;
          this.errorDetail = requestError.detail;
          this.requestViewRefresh();
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
    const loadId = ++this.ordersLoadId;
    this.ordersSub?.unsubscribe();
    this.loading = true;
    if (clearMessages) {
      this.errorMessage = '';
      this.errorDetail = '';
      this.successMessage = '';
    }
    this.requestViewRefresh();
    const endpoint = this.shopService.getAdminOrdersEndpoint();

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
        finalize(() => {
          if (loadId === this.ordersLoadId) {
            this.loading = false;
            this.requestViewRefresh();
          }
        })
      )
      .subscribe({
        next: result => {
          if (loadId !== this.ordersLoadId) {
            return;
          }
          this.orders = result.orders;
          this.total = result.total;
          this.errorMessage = '';
          this.errorDetail = '';

          if (this.page > this.totalPages) {
            this.page = this.totalPages;
            this.loadOrders(false);
            return;
          }
          this.requestViewRefresh();
        },
        error: error => {
          if (loadId !== this.ordersLoadId) {
            return;
          }
          console.error('Failed to load admin customer orders.', {
            endpoint,
            page: this.page,
            limit: this.limit,
            status: this.statusFilter || null,
            search: this.searchTerm || null,
            error
          });
          const requestError = this.describeRequestError(error, {
            endpoint,
            fallbackMessage: 'Unable to load customer orders.'
          });
          this.orders = [];
          this.total = 0;
          this.errorMessage = requestError.message;
          this.errorDetail = requestError.detail;
          this.requestViewRefresh();
        }
      });
  }

  private bindRouteActivation(): void {
    this.routeActivationSub?.unsubscribe();
    this.routeActivationSub = this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        startWith(null),
        map(() => this.isOrdersRouteActive()),
        distinctUntilChanged()
      )
      .subscribe(isActive => {
        if (!isActive) {
          return;
        }

        this.queueRouteLoad();
      });
  }

  private isOrdersRouteActive(): boolean {
    if (!this.embeddedMode) {
      return true;
    }

    return this.route.snapshot.queryParamMap.get('section') === 'orders';
  }

  private queueRouteLoad(): void {
    if (this.routeLoadQueued) {
      return;
    }

    this.routeLoadQueued = true;
    queueMicrotask(() => {
      this.routeLoadQueued = false;

      if (this.destroyed || !this.isOrdersRouteActive()) {
        return;
      }

      this.loadOrders();
    });
  }

  private requestViewRefresh(): void {
    if (this.destroyed) {
      return;
    }

    this.cdr.markForCheck();
    queueMicrotask(() => {
      if (this.destroyed) {
        return;
      }

      try {
        this.cdr.detectChanges();
      } catch {
        // No-op: the component may be mid-teardown while async callbacks complete.
      }
    });
  }

  private describeRequestError(
    error: unknown,
    options: { endpoint: string; fallbackMessage: string }
  ): { message: string; detail: string } {
    if (error instanceof TimeoutError) {
      return {
        message: `${options.fallbackMessage} Request timed out.`,
        detail: `No response from ${options.endpoint} within ${OrderManagementComponent.LOAD_TIMEOUT_MS / 1000} seconds. Check the Express server and MySQL connection.`
      };
    }

    if (error instanceof HttpErrorResponse) {
      const payload = typeof error.error === 'object' && error.error !== null ? (error.error as Record<string, unknown>) : null;
      const apiCode = payload && typeof payload['error'] === 'string' ? payload['error'] : '';
      const apiMessage = payload && typeof payload['message'] === 'string' ? payload['message'] : '';
      const apiDetail = payload && typeof payload['detail'] === 'string' ? payload['detail'] : '';

      if (error.status === 0) {
        return {
          message: 'Cannot reach the Orders API.',
          detail: `Request to ${options.endpoint} failed before the server responded. Check the Express server, CORS origin, or API base URL. ${error.message}`.trim()
        };
      }

      if (error.status === 401) {
        return {
          message: 'Your admin session is no longer valid.',
          detail: `The Orders request was rejected with 401. Log in again, then retry ${options.endpoint}.`
        };
      }

      if (error.status === 403) {
        return {
          message: 'Your account does not have permission to manage customer orders.',
          detail: `The Orders request was rejected with 403 for ${options.endpoint}. Confirm the signed-in user still has the admin role.`
        };
      }

      if (error.status === 503) {
        const detail = apiDetail || apiMessage || error.message;
        return {
          message: 'The Orders API cannot reach MySQL right now.',
          detail: `Request: ${options.endpoint} | HTTP 503${apiCode ? ` | Code: ${apiCode}` : ''} | ${detail} | Verify DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, and that MySQL is running.`
        };
      }

      const detailParts = [
        `Request: ${options.endpoint}`,
        `HTTP ${error.status}`,
        apiCode ? `Code: ${apiCode}` : '',
        apiMessage || '',
        apiDetail || '',
        !apiMessage && !apiDetail ? error.message : ''
      ].filter(Boolean);

      return {
        message: apiMessage || options.fallbackMessage,
        detail: detailParts.join(' | ')
      };
    }

    const genericDetail = error instanceof Error ? error.message : 'Unknown client error.';
    return {
      message: options.fallbackMessage,
      detail: `Request: ${options.endpoint} | ${genericDetail}`
    };
  }
}
