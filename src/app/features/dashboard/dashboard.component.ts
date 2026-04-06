import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Params, Router, RouterLink } from '@angular/router';
import {
  Observable,
  Subscription,
  catchError,
  finalize,
  forkJoin,
  interval,
  map,
  of,
  retry,
  timeout,
  timer
} from 'rxjs';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { AuthService } from '../../core/services/auth.service';
import { InventoryService, StockMovement } from '../../core/services/inventory.service';
import { ProductService } from '../../core/services/product.service';
import { Product } from '../../shared/models/product.model';
import { TransactionHistoryComponent } from '../transactions/transaction-history/transaction-history.component';
import { ProductListComponent } from '../products/product-list/product-list.component';
import { ProductFormComponent } from '../products/product-form/product-form.component';
import { CategoryListComponent } from '../categories/category-list/category-list.component';
import { CategoryFormComponent } from '../categories/category-form/category-form.component';
import { StockReceiveComponent } from '../transactions/stock-receive/stock-receive.component';
import { OrderManagementComponent } from '../orders/order-management/order-management.component';
import { APP_LOCALE } from '../../shared/utils/locale-format';
import { AppRefreshEvent, AppRefreshService } from '../../core/services/app-refresh.service';

interface ActivityItem {
  action: string;
  detail: string;
  time: string;
}

interface ProductItem {
  id: number;
  name: string;
  category: string;
  quantity: number;
  price: number;
  dateAdded: string;
}

interface CalendarDay {
  value: number;
  date: Date;
  inCurrentMonth: boolean;
  isToday: boolean;
  stockTotal: number;
  products: ProductItem[];
}

type RangeMode = 'day' | 'week' | 'month';

type AdminSection =
  | 'overview'
  | 'stockReceive'
  | 'products'
  | 'productCreate'
  | 'productEdit'
  | 'categories'
  | 'categoryCreate'
  | 'categoryEdit'
  | 'history'
  | 'orders';

interface RangeProductSummary {
  name: string;
  total: number;
}

interface DashboardLoadResult<T> {
  data: T;
  error: unknown | null;
}

interface OverviewModuleCard {
  icon: string;
  eyebrow: string;
  title: string;
  description: string;
  primaryLabel: string;
  primarySection: AdminSection;
  secondaryLabel: string;
  secondarySection: AdminSection;
}

interface OverviewTransactionRow {
  id: number;
  dateLabel: string;
  moduleLabel: string;
  product: string;
  location: string;
  quantityLabel: string;
  reference: string;
  user: string;
  patient: string;
  searchValue: string;
}

interface AdminNavItem {
  icon: string;
  label: string;
  section: AdminSection;
  helper: string;
}

interface AdminNavGroup {
  title: string;
  items: AdminNavItem[];
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    MatCardModule,
    MatButtonModule,
    TransactionHistoryComponent,
    ProductListComponent,
    ProductFormComponent,
    CategoryListComponent,
    CategoryFormComponent,
    StockReceiveComponent,
    OrderManagementComponent
  ],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.css']
})
export class DashboardComponent implements OnInit, OnDestroy {
  private static readonly LOAD_TIMEOUT_MS = 15000;
  private static readonly LIVE_REFRESH_INTERVAL_MS = 15000;
  private loadSub?: Subscription;
  private liveRefreshSub?: Subscription;
  private refreshEventsSub?: Subscription;
  private routeSectionSub?: Subscription;
  private currentLoadId = 0;
  private destroyed = false;
  private autoRetryUsed = false;

  loading = false;
  errorMessage = '';

  sideNavOpen = true;
  activeSection: AdminSection = 'overview';
  selectedProductId: number | null = null;
  selectedCategoryId: number | null = null;
  productListReloadToken = 0;
  categoryListReloadToken = 0;
  historyReloadToken = 0;
  ordersReloadToken = 0;
  stockReceiveReloadToken = 0;
  productCreateReloadToken = 0;
  productEditReloadToken = 0;
  categoryCreateReloadToken = 0;
  categoryEditReloadToken = 0;

  displayName = 'Administrator';
  roleLabel = 'Admin';
  avatarInitials = 'AD';
  avatarUrl: string | null = null;
  logoImageVisible = true;
  titleImageVisible = true;
  overviewSearch = '';
  recentMovements: StockMovement[] = [];

  readonly todayLabel = new Intl.DateTimeFormat(APP_LOCALE, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  }).format(new Date());

  readonly navGroups: AdminNavGroup[] = [
    {
      title: 'Dashboard',
      items: [{ icon: 'home', label: 'Overview', section: 'overview', helper: 'System snapshot and stock calendar' }]
    },
    {
      title: 'Inventory',
      items: [
        { icon: 'move_to_inbox', label: 'Stock Receive', section: 'stockReceive', helper: 'Receive stock into a location' },
        { icon: 'inventory_2', label: 'Item Master', section: 'products', helper: 'View, edit, and archive items' },
        { icon: 'add_box', label: 'Add Item', section: 'productCreate', helper: 'Create a new inventory item' },
        { icon: 'category', label: 'Categories', section: 'categories', helper: 'Maintain category and location groups' },
        { icon: 'playlist_add', label: 'Add Category', section: 'categoryCreate', helper: 'Create new category records' },
        { icon: 'shopping_cart', label: 'Orders', section: 'orders', helper: 'Review and fulfill online orders' }
      ]
    },
    {
      title: 'Audit',
      items: [
        {
          icon: 'history',
          label: 'Transaction History',
          section: 'history',
          helper: 'Audit stock movements and exports'
        }
      ]
    }
  ];

  readonly overviewModules: OverviewModuleCard[] = [
    {
      icon: 'move_to_inbox',
      eyebrow: 'Stock In',
      title: 'Stock Receive',
      description: 'Receive existing inventory into a selected location and increase stock-on-hand with a ledger entry.',
      primaryLabel: 'Receive Stock',
      primarySection: 'stockReceive',
      secondaryLabel: 'View History',
      secondarySection: 'history'
    },
    {
      icon: 'inventory_2',
      eyebrow: 'Master Data',
      title: 'Item Master',
      description: 'Create and maintain product records, pricing, and reorder rules for hospital inventory.',
      primaryLabel: 'New Item',
      primarySection: 'productCreate',
      secondaryLabel: 'View All',
      secondarySection: 'products'
    },
    {
      icon: 'category',
      eyebrow: 'Structure',
      title: 'Category Setup',
      description: 'Organize medicines, supplies, and departments with a cleaner category structure.',
      primaryLabel: 'New Category',
      primarySection: 'categoryCreate',
      secondaryLabel: 'View All',
      secondarySection: 'categories'
    },
    {
      icon: 'history',
      eyebrow: 'Audit',
      title: 'Reports and History',
      description: 'Review recent stock movements, exports, and traceable transaction activity.',
      primaryLabel: 'Open History',
      primarySection: 'history',
      secondaryLabel: 'View Audit',
      secondarySection: 'history'
    },
    {
      icon: 'shopping_bag',
      eyebrow: 'Online Shop',
      title: 'Order Management',
      description: 'Approve, fulfill, or cancel customer orders while live stock reservations stay in sync.',
      primaryLabel: 'Open Orders',
      primarySection: 'orders',
      secondaryLabel: 'View History',
      secondarySection: 'history'
    }
  ];

  readonly quickActions = [
    {
      title: 'Receive Stock',
      subtitle: 'Post stock-in transactions to the selected location',
      section: 'stockReceive' as const
    },
    {
      title: 'Create Inventory Item',
      subtitle: 'Register a new medicine, supply, or equipment record',
      section: 'productCreate' as const
    },
    {
      title: 'Create Category',
      subtitle: 'Set up a new stock classification for products',
      section: 'categoryCreate' as const
    },
    {
      title: 'Review Transaction History',
      subtitle: 'Filter and export movement logs for auditing',
      section: 'history' as const
    },
    {
      title: 'Review Online Orders',
      subtitle: 'Process pending customer reservations and fulfillment',
      section: 'orders' as const
    }
  ] as const;

  totalItems = 0;
  lowStockItems = 0;
  totalCategories = 0;

  recentProducts: ProductItem[] = [];
  recentActivities: ActivityItem[] = [];

  activityPageSize = 3;
  currentActivityPage = 1;

  weekdayHeaders = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  monthLabel = '';
  calendarWeeks: CalendarDay[][] = [];

  selectedRange: RangeMode = 'day';
  selectedDate = new Date();
  rangeLabel = '';
  rangeStockTotal = 0;
  rangeProductSummary: RangeProductSummary[] = [];

  private viewedMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private authService: AuthService,
    private productService: ProductService,
    private inventoryService: InventoryService,
    private appRefreshService: AppRefreshService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.applyCurrentUserProfile();
    this.bindRefreshEvents();
    this.bindRouteSection();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.loadSub?.unsubscribe();
    this.liveRefreshSub?.unsubscribe();
    this.refreshEventsSub?.unsubscribe();
    this.routeSectionSub?.unsubscribe();
  }

  get filteredOverviewTransactions(): OverviewTransactionRow[] {
    const query = this.overviewSearch.trim().toLowerCase();
    const rows = this.recentMovements.slice(0, 8).map(movement => this.toOverviewTransactionRow(movement));

    if (!query) {
      return rows;
    }

    return rows.filter(row => row.searchValue.includes(query));
  }

  get paginatedActivities(): ActivityItem[] {
    const start = (this.currentActivityPage - 1) * this.activityPageSize;
    return this.recentActivities.slice(start, start + this.activityPageSize);
  }

  get totalActivityPages(): number {
    return Math.max(1, Math.ceil(this.recentActivities.length / this.activityPageSize));
  }

  toggleSideNav(): void {
    this.sideNavOpen = !this.sideNavOpen;
  }

  switchSection(section: AdminSection): void {
    this.navigateToSection(section);
  }

  getSectionQueryParams(section: AdminSection): Params {
    return section === 'overview' ? { section: null } : { section };
  }

  private navigateToSection(section: AdminSection): void {
    if (this.activeSection === section) {
      this.activateSection(section);
      return;
    }

    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: this.getSectionQueryParams(section),
      queryParamsHandling: 'merge'
    });
  }

  private activateSection(section: AdminSection): void {
    if (section === 'products') {
      this.productListReloadToken++;
    }

    if (section === 'stockReceive') {
      this.stockReceiveReloadToken++;
    }

    if (section === 'categories') {
      this.categoryListReloadToken++;
    }

    if (section === 'history') {
      this.historyReloadToken++;
    }

    if (section === 'orders') {
      this.ordersReloadToken++;
    }

    if (section === 'productCreate') {
      this.selectedProductId = null;
      this.productCreateReloadToken++;
    }

    if (section === 'productEdit') {
      this.productEditReloadToken++;
    }

    if (section === 'categoryCreate') {
      this.selectedCategoryId = null;
      this.categoryCreateReloadToken++;
    }

    if (section === 'categoryEdit') {
      this.categoryEditReloadToken++;
    }

    this.activeSection = section;
    this.syncLiveRefreshState();
    if (section === 'overview' && !this.loading) {
      this.loadDashboardData();
    }
  }

  retryDashboardLoad(): void {
    this.loadDashboardData();
  }

  refreshDashboardData(): void {
    this.loadDashboardData();
  }

  onLogoImageError(): void {
    this.logoImageVisible = false;
    this.refreshUi();
  }

  onTitleImageError(): void {
    this.titleImageVisible = false;
    this.refreshUi();
  }

  openProductCreate(): void {
    this.switchSection('productCreate');
  }

  openProductEdit(productId: number): void {
    this.selectedProductId = productId;
    this.switchSection('productEdit');
  }

  openCategoryCreate(): void {
    this.switchSection('categoryCreate');
  }

  openCategoryEdit(categoryId: number): void {
    this.selectedCategoryId = categoryId;
    this.switchSection('categoryEdit');
  }

  onProductFormCompleted(): void {
    this.selectedProductId = null;
    this.switchSection('products');
  }

  onCategoryFormCompleted(): void {
    this.selectedCategoryId = null;
    this.switchSection('categories');
  }

  prevActivityPage(): void {
    if (this.currentActivityPage > 1) {
      this.currentActivityPage--;
    }
  }

  nextActivityPage(): void {
    if (this.currentActivityPage < this.totalActivityPages) {
      this.currentActivityPage++;
    }
  }

  logout(): void {
    this.authService.logout();
  }

  formatMovementType(value: string): string {
    const normalized = value.trim().toUpperCase();
    if (normalized === 'SALE_WALKIN') {
      return 'Walk-in Sale';
    }
    if (normalized === 'SALE_ONLINE') {
      return 'Online Sale';
    }
    if (normalized === 'PATIENT_ISSUE') {
      return 'Patient Issue';
    }
    if (normalized === 'ADJUSTMENT_IN') {
      return 'Adjustment In';
    }
    if (normalized === 'ADJUSTMENT_OUT') {
      return 'Adjustment Out';
    }
    if (normalized === 'RECEIVE') {
      return 'Stock Receive';
    }
    return normalized.replace(/_/g, ' ');
  }

  prevMonth(): void {
    this.viewedMonth = new Date(this.viewedMonth.getFullYear(), this.viewedMonth.getMonth() - 1, 1);
    this.selectedDate = new Date(this.viewedMonth.getFullYear(), this.viewedMonth.getMonth(), 1);
    this.buildCalendar(this.viewedMonth);
    this.updateRangeMetrics();
  }

  nextMonth(): void {
    this.viewedMonth = new Date(this.viewedMonth.getFullYear(), this.viewedMonth.getMonth() + 1, 1);
    this.selectedDate = new Date(this.viewedMonth.getFullYear(), this.viewedMonth.getMonth(), 1);
    this.buildCalendar(this.viewedMonth);
    this.updateRangeMetrics();
  }

  setRange(mode: RangeMode): void {
    this.selectedRange = mode;
    this.updateRangeMetrics();
  }

  selectDay(day: CalendarDay): void {
    this.selectedDate = new Date(day.date);
    this.selectedRange = 'day';

    if (!day.inCurrentMonth) {
      this.viewedMonth = new Date(day.date.getFullYear(), day.date.getMonth(), 1);
      this.buildCalendar(this.viewedMonth);
    }

    this.updateRangeMetrics();
  }

  private applyCurrentUserProfile(): void {
    const currentUser = this.authService.currentUser();
    if (!currentUser) {
      return;
    }

    const username = currentUser.username?.trim() || 'admin';
    const fullName = currentUser.fullName?.trim() || username;

    this.displayName = fullName;
    this.roleLabel = currentUser.role === 'admin' ? 'Administrator' : 'Employee';
    this.avatarUrl = currentUser.avatarUrl?.trim() || null;

    const initials = fullName
      .split(/\s+/)
      .map(part => part[0] || '')
      .join('')
      .slice(0, 2)
      .toUpperCase();

    this.avatarInitials = initials || fullName.slice(0, 2).toUpperCase();
  }

  private loadDashboardData(): void {
    this.loadSub?.unsubscribe();
    this.autoRetryUsed = false;
    this.loading = true;
    this.errorMessage = '';
    this.refreshUi();

    const loadId = ++this.currentLoadId;

    this.loadSub = forkJoin({
      summary: this.buildRequest(
        this.inventoryService.getDashboardSummary(),
        {
          totalProducts: 0,
          totalCategories: 0,
          stockLeft: 0,
          lowStockItems: 0,
          outOfStockItems: 0,
          salesToday: 0,
          transactionsToday: 0,
          stockMovementsLast7Days: 0
        }
      ),
      products: this.buildRequest(this.productService.getAll({ limit: 200 }), [] as Product[]),
      movements: this.buildRequest(this.inventoryService.getStockMovements({ limit: 120 }), [] as StockMovement[])
    })
      .pipe(
        finalize(() => {
          if (loadId !== this.currentLoadId) {
            return;
          }
          this.loading = false;
          this.refreshUi();
        })
      )
      .subscribe({
        next: ({ summary, products, movements }) => {
          if (loadId !== this.currentLoadId) {
            return;
          }

          this.totalItems = summary.data.totalProducts;
          this.lowStockItems = summary.data.lowStockItems;
          this.totalCategories = summary.data.totalCategories;
          this.recentMovements = movements.data.slice(0, 12);

          this.recentActivities = this.mapActivities(movements.data);
          this.recentProducts = this.mapCalendarItems(products.data, movements.data);
          this.errorMessage = this.getDashboardErrorMessage(summary.error, products.error, movements.error);

          this.currentActivityPage = 1;
          this.buildCalendar(this.viewedMonth);
          this.updateRangeMetrics();
          this.refreshUi();
        },
        error: () => {
          if (loadId !== this.currentLoadId) {
            return;
          }

          this.errorMessage = 'Unable to load dashboard data.';
          this.recentActivities = [];
          this.recentMovements = [];
          this.recentProducts = [];
          this.buildCalendar(this.viewedMonth);
          this.updateRangeMetrics();
          this.refreshUi();
        }
      });
  }

  private buildRequest<T>(request$: Observable<T>, fallback: T): Observable<DashboardLoadResult<T>> {
    return request$.pipe(
      timeout(DashboardComponent.LOAD_TIMEOUT_MS),
      retry({
        count: 1,
        delay: () => {
          this.autoRetryUsed = true;
          this.refreshUi();
          return timer(250);
        }
      }),
      map(data => ({ data, error: null })),
      catchError(error => of({ data: fallback, error }))
    );
  }

  private syncLiveRefreshState(): void {
    if (this.activeSection !== 'overview') {
      this.liveRefreshSub?.unsubscribe();
      this.liveRefreshSub = undefined;
      return;
    }

    if (this.liveRefreshSub) {
      return;
    }

    this.liveRefreshSub = interval(DashboardComponent.LIVE_REFRESH_INTERVAL_MS).subscribe(() => {
      if (this.loading) {
        return;
      }
      this.loadDashboardData();
    });
  }

  private bindRefreshEvents(): void {
    this.refreshEventsSub?.unsubscribe();
    this.refreshEventsSub = this.appRefreshService.refresh$.subscribe(event => this.handleRefreshEvent(event));
  }

  private bindRouteSection(): void {
    this.routeSectionSub?.unsubscribe();
    this.routeSectionSub = this.route.queryParamMap.subscribe(params => {
      const section = this.parseSectionParam(params.get('section'));
      this.activateSection(section);
    });
  }

  private parseSectionParam(value: string | null): AdminSection {
    const candidate = String(value || '').trim();
    const allowedSections: readonly AdminSection[] = [
      'overview',
      'stockReceive',
      'products',
      'productCreate',
      'productEdit',
      'categories',
      'categoryCreate',
      'categoryEdit',
      'history',
      'orders'
    ];

    return allowedSections.includes(candidate as AdminSection) ? (candidate as AdminSection) : 'overview';
  }

  private handleRefreshEvent(event: AppRefreshEvent): void {
    if (this.appRefreshService.matches(event, ['inventory', 'products', 'transactions', 'orders', 'shop'])) {
      this.productListReloadToken++;
      this.stockReceiveReloadToken++;
    }

    if (this.appRefreshService.matches(event, ['transactions', 'inventory', 'orders', 'shop'])) {
      this.historyReloadToken++;
    }

    if (this.appRefreshService.matches(event, ['orders', 'shop'])) {
      this.ordersReloadToken++;
    }

    if (this.appRefreshService.matches(event, ['categories'])) {
      this.categoryListReloadToken++;
    }

    if (
      this.appRefreshService.matches(event, ['dashboard', 'inventory', 'products', 'categories', 'transactions', 'orders', 'shop']) &&
      !this.loading
    ) {
      this.loadDashboardData();
    }

    this.refreshUi();
  }

  private refreshUi(): void {
    if (this.destroyed) {
      return;
    }

    try {
      this.cdr.detectChanges();
    } catch {
      // No-op: component may be unmounting while async callbacks complete.
    }
  }

  private mapActivities(movements: StockMovement[]): ActivityItem[] {
    return movements.slice(0, 36).map(movement => {
      const quantity = Math.abs(movement.quantity);
      const location = movement.locationName ? ` at ${movement.locationName}` : '';

      return {
        action: this.getMovementAction(movement.movementType),
        detail: `${movement.productName} ${quantity} units${location}`,
        time: this.formatRelativeTime(movement.createdAt)
      };
    });
  }

  private mapCalendarItems(products: Product[], movements: StockMovement[]): ProductItem[] {
    const productsById = new Map<number, Product>(products.map(product => [product.id, product]));

    return movements.map((movement, index) => {
      const linkedProduct = productsById.get(movement.productId);
      const fallbackCategory = movement.locationName || 'General';

      return {
        id: movement.id || movement.productId || index + 1,
        name: movement.productName,
        category: linkedProduct?.categoryName || fallbackCategory,
        quantity: Math.abs(movement.quantity),
        price: movement.unitCost ?? linkedProduct?.price ?? 0,
        dateAdded: this.toIsoDate(movement.createdAt)
      };
    });
  }

  private getMovementAction(movementType: string): string {
    const normalizedType = movementType.toUpperCase();

    if (normalizedType === 'RECEIVE') {
      return 'Stock received';
    }
    if (normalizedType === 'SALE_WALKIN') {
      return 'Walk-in sale';
    }
    if (normalizedType === 'SALE_ONLINE') {
      return 'Online sale';
    }
    if (normalizedType === 'PATIENT_ISSUE') {
      return 'Patient issue';
    }
    if (normalizedType === 'ADJUSTMENT_IN' || normalizedType === 'ADJUSTMENT_OUT') {
      return 'Stock adjustment';
    }

    return 'Stock movement';
  }

  private formatRelativeTime(isoDate: string): string {
    const date = new Date(isoDate);
    if (Number.isNaN(date.getTime())) {
      return 'Unknown time';
    }

    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMinutes = Math.floor(diffMs / 60000);

    if (diffMinutes < 1) {
      return 'Just now';
    }

    if (diffMinutes < 60) {
      return `${diffMinutes} min ago`;
    }

    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) {
      return `${diffHours} hr ago`;
    }

    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) {
      return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    }

    return date.toLocaleDateString(APP_LOCALE, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  private toIsoDate(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      const today = new Date();
      const todayMonth = String(today.getMonth() + 1).padStart(2, '0');
      const todayDay = String(today.getDate()).padStart(2, '0');
      return `${today.getFullYear()}-${todayMonth}-${todayDay}`;
    }

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private buildCalendar(referenceMonth: Date): void {
    const year = referenceMonth.getFullYear();
    const month = referenceMonth.getMonth();

    this.monthLabel = referenceMonth.toLocaleString(APP_LOCALE, {
      month: 'long',
      year: 'numeric'
    });

    const monthStart = new Date(year, month, 1);
    const firstVisibleDate = new Date(monthStart);
    firstVisibleDate.setDate(1 - monthStart.getDay());

    const today = new Date();
    const days: CalendarDay[] = [];

    for (let i = 0; i < 42; i++) {
      const date = new Date(firstVisibleDate);
      date.setDate(firstVisibleDate.getDate() + i);

      const products = this.getProductsByDate(date);
      const stockTotal = products.reduce((sum, product) => sum + product.quantity, 0);

      days.push({
        value: date.getDate(),
        date,
        inCurrentMonth: date.getMonth() === month,
        isToday: this.isSameDay(date, today),
        stockTotal,
        products
      });
    }

    this.calendarWeeks = [];
    for (let i = 0; i < days.length; i += 7) {
      this.calendarWeeks.push(days.slice(i, i + 7));
    }
  }

  private updateRangeMetrics(): void {
    const { start, end } = this.getRangeBounds(this.selectedDate, this.selectedRange);

    const rangeProducts = this.recentProducts.filter(product => {
      const productDate = this.parseISODate(product.dateAdded);
      return productDate >= start && productDate <= end;
    });

    this.rangeStockTotal = rangeProducts.reduce((sum, product) => sum + product.quantity, 0);

    const summaryMap = new Map<string, number>();
    for (const product of rangeProducts) {
      summaryMap.set(product.name, (summaryMap.get(product.name) ?? 0) + product.quantity);
    }

    this.rangeProductSummary = Array.from(summaryMap.entries())
      .map(([name, total]) => ({ name, total }))
      .sort((a, b) => b.total - a.total);

    this.rangeLabel = this.formatRangeLabel(start, end, this.selectedRange);
  }

  private getRangeBounds(anchorDate: Date, mode: RangeMode): { start: Date; end: Date } {
    const date = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), anchorDate.getDate());

    if (mode === 'day') {
      return { start: date, end: date };
    }

    if (mode === 'week') {
      const start = new Date(date);
      start.setDate(date.getDate() - date.getDay());
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      return { start, end };
    }

    const start = new Date(date.getFullYear(), date.getMonth(), 1);
    const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    return { start, end };
  }

  private formatRangeLabel(start: Date, end: Date, mode: RangeMode): string {
    const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };

    if (mode === 'day') {
      return start.toLocaleDateString(APP_LOCALE, opts);
    }

    if (mode === 'week') {
      return `${start.toLocaleDateString(APP_LOCALE, opts)} - ${end.toLocaleDateString(APP_LOCALE, opts)}`;
    }

    return start.toLocaleDateString(APP_LOCALE, { month: 'long', year: 'numeric' });
  }

  private getProductsByDate(targetDate: Date): ProductItem[] {
    return this.recentProducts.filter(product => this.isSameDay(this.parseISODate(product.dateAdded), targetDate));
  }

  private isSameDay(a: Date, b: Date): boolean {
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
  }

  private parseISODate(value: string): Date {
    return new Date(`${value}T00:00:00`);
  }

  private getDashboardErrorMessage(
    summaryError: unknown | null,
    productsError: unknown | null,
    movementsError: unknown | null
  ): string {
    const summaryUnavailable = this.isApiUnavailable(summaryError);
    const productsUnavailable = this.isApiUnavailable(productsError);
    const movementsUnavailable = this.isApiUnavailable(movementsError);

    if (summaryUnavailable && productsUnavailable && movementsUnavailable) {
      return 'Inventory API is offline. Start the API server on http://localhost:3001 and retry.';
    }

    if (summaryError && movementsError) {
      return this.autoRetryUsed
        ? 'Unable to load admin dashboard core data after retry. Please retry.'
        : 'Unable to load admin dashboard core data.';
    }

    if (summaryError) {
      return 'Dashboard summary is temporarily unavailable.';
    }

    if (movementsError) {
      return 'Recent activity and calendar data are temporarily unavailable.';
    }

    if (productsError) {
      return 'Some product context is temporarily unavailable, but dashboard data is still loading.';
    }

    return '';
  }

  private isApiUnavailable(error: unknown | null): boolean {
    return error instanceof HttpErrorResponse && error.status === 0;
  }

  private toOverviewTransactionRow(movement: StockMovement): OverviewTransactionRow {
    const quantity = Number(movement.quantity ?? 0);
    const patientBits = [movement.patientId, movement.patientName].filter(Boolean).join(' - ') || 'N/A';

    return {
      id: movement.id,
      dateLabel: this.formatOverviewDate(movement.createdAt),
      moduleLabel: this.formatMovementType(movement.movementType),
      product: movement.productName || 'Unknown product',
      location: movement.locationName || 'General location',
      quantityLabel: `${quantity > 0 ? '+' : ''}${quantity}`,
      reference: movement.referenceNo || `${movement.referenceType || 'record'} #${movement.referenceId ?? movement.id}`,
      user: movement.createdBy?.username || 'System',
      patient: patientBits,
      searchValue: [
        this.formatOverviewDate(movement.createdAt),
        this.formatMovementType(movement.movementType),
        movement.productName,
        movement.locationName,
        movement.referenceNo,
        movement.createdBy?.username,
        movement.patientId,
        movement.patientName
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
    };
  }

  private formatOverviewDate(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return 'Unknown date';
    }

    return date.toLocaleDateString(APP_LOCALE, {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  }
}
