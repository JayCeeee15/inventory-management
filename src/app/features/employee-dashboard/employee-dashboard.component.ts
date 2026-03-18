import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
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
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { AuthService } from '../../core/services/auth.service';
import {
  InventoryService,
  PatientIssueResult,
  StockGraphPoint,
  StockMovement,
  WalkInSaleResult
} from '../../core/services/inventory.service';
import { WalkInSaleComponent } from '../transactions/walk-in-sale/walk-in-sale.component';
import { PatientIssueComponent } from '../transactions/patient-issue/patient-issue.component';
import { TransactionHistoryComponent } from '../transactions/transaction-history/transaction-history.component';
import { ProductListComponent } from '../products/product-list/product-list.component';
import { CategoryListComponent } from '../categories/category-list/category-list.component';
import { CategoryFormComponent } from '../categories/category-form/category-form.component';
import { APP_LOCALE } from '../../shared/utils/locale-format';

interface CalendarEntry {
  id: number;
  name: string;
  quantity: number;
  date: string;
}

interface CalendarDay {
  value: number;
  date: Date;
  inCurrentMonth: boolean;
  isToday: boolean;
  stockTotal: number;
  topItems: CalendarEntry[];
}

interface RangeProductSummary {
  name: string;
  total: number;
}

interface StockGraphBar {
  name: string;
  category: string;
  stock: number;
  percent: number;
}

interface OverviewModuleCard {
  icon: string;
  eyebrow: string;
  title: string;
  description: string;
  primaryLabel: string;
  primarySection: EmployeeSection;
  secondaryLabel: string;
  secondarySection: EmployeeSection;
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

interface EmployeeNavItem {
  icon: string;
  label: string;
  section: EmployeeSection;
  helper: string;
}

interface EmployeeNavGroup {
  title: string;
  items: EmployeeNavItem[];
}

interface DashboardLoadResult<T> {
  data: T;
  error: unknown | null;
}

type RangeMode = 'day' | 'month' | 'year';

type EmployeeSection =
  | 'overview'
  | 'walkin'
  | 'issue'
  | 'history'
  | 'products'
  | 'categories'
  | 'categoryCreate'
  | 'categoryEdit';

@Component({
  selector: 'app-employee-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    WalkInSaleComponent,
    PatientIssueComponent,
    TransactionHistoryComponent,
    ProductListComponent,
    CategoryListComponent,
    CategoryFormComponent
  ],
  templateUrl: './employee-dashboard.component.html',
  styleUrls: ['./employee-dashboard.component.css']
})
export class EmployeeDashboardComponent implements OnInit, OnDestroy {
  private static readonly LOAD_TIMEOUT_MS = 15000;
  private static readonly LIVE_REFRESH_INTERVAL_MS = 15000;
  private loadSub?: Subscription;
  private liveRefreshSub?: Subscription;
  private currentLoadId = 0;
  private destroyed = false;
  private autoRetryUsed = false;

  loading = false;
  errorMessage = '';
  sideNavOpen = true;
  activeSection: EmployeeSection = 'overview';
  walkInReloadToken = 0;
  patientIssueReloadToken = 0;
  historyReloadToken = 0;
  productListReloadToken = 0;
  categoryListReloadToken = 0;
  categoryCreateReloadToken = 0;
  categoryEditReloadToken = 0;
  selectedCategoryId: number | null = null;

  readonly todayLabel = new Intl.DateTimeFormat(APP_LOCALE, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  }).format(new Date());

  readonly navGroups: EmployeeNavGroup[] = [
    {
      title: 'Dashboard',
      items: [{ icon: 'home', label: 'Overview', section: 'overview', helper: 'Daily stock status' }]
    },
    {
      title: 'Transactions',
      items: [
        { icon: 'point_of_sale', label: 'Walk-in Sale', section: 'walkin', helper: 'Process patient purchases' },
        { icon: 'medication', label: 'Patient Issue', section: 'issue', helper: 'Issue stock to departments' },
        { icon: 'history', label: 'History', section: 'history', helper: 'Search and export transactions' }
      ]
    },
    {
      title: 'Records',
      items: [
        { icon: 'inventory_2', label: 'Item Master', section: 'products', helper: 'View product records' },
        { icon: 'category', label: 'Categories', section: 'categories', helper: 'View item groups' }
      ]
    }
  ];

  readonly overviewModules: OverviewModuleCard[] = [
    {
      icon: 'point_of_sale',
      eyebrow: 'Transactions',
      title: 'Walk-in Sale',
      description: 'Record counter purchases and deduct stock from the assigned location in real time.',
      primaryLabel: 'New',
      primarySection: 'walkin',
      secondaryLabel: 'View All',
      secondarySection: 'history'
    },
    {
      icon: 'medication',
      eyebrow: 'Transactions',
      title: 'Patient Issue',
      description: 'Dispense supplies to departments or admitted patients with full stock traceability.',
      primaryLabel: 'New',
      primarySection: 'issue',
      secondaryLabel: 'View All',
      secondarySection: 'history'
    },
    {
      icon: 'inventory_2',
      eyebrow: 'Records',
      title: 'Item Master',
      description: 'Review stock-on-hand, pricing, and item setup details without editing master records.',
      primaryLabel: 'View All',
      primarySection: 'products',
      secondaryLabel: 'History',
      secondarySection: 'history'
    },
    {
      icon: 'category',
      eyebrow: 'Records',
      title: 'Categories',
      description: 'View product groups and hospital inventory classifications in a read-only list.',
      primaryLabel: 'View All',
      primarySection: 'categories',
      secondaryLabel: 'History',
      secondarySection: 'history'
    }
  ];

  readonly quickActions = [
    {
      title: 'Create Walk-in Sale',
      subtitle: 'Deduct stock for in-person patient purchases',
      section: 'walkin' as const
    },
    {
      title: 'Issue to Patient',
      subtitle: 'Record dispensing to patient or department',
      section: 'issue' as const
    },
    {
      title: 'Open Transaction History',
      subtitle: 'Filter by date, type, product, and location',
      section: 'history' as const
    }
  ] as const;

  displayName = 'Staff Member';
  roleLabel = 'Employee';
  avatarInitials = 'ST';
  avatarUrl: string | null = null;
  accountUsername = '';
  accountEmail = '';
  logoImageVisible = true;
  titleImageVisible = true;
  overviewSearch = '';

  profileEditorOpen = false;
  profileSaving = false;
  profileErrorMessage = '';
  profileSuccessMessage = '';
  profileImageErrorMessage = '';
  profilePreviewUrl: string | null = null;
  profileSelectedImageName = '';
  private selectedAvatarFile: File | null = null;
  private profilePreviewObjectUrl: string | null = null;

  totalProducts = 0;
  stockLeft = 0;
  lowStockItems = 0;
  outOfStockItems = 0;
  salesToday = 0;
  transactionsToday = 0;
  weeklyMovements = 0;
  totalCategories = 0;
  recentMovements: StockMovement[] = [];

  weekdayHeaders = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  monthLabel = '';
  calendarWeeks: CalendarDay[][] = [];

  selectedRange: RangeMode = 'day';
  selectedDate = new Date();
  rangeLabel = '';
  rangeStockTotal = 0;
  rangeProductCount = 0;
  rangeProductSummary: RangeProductSummary[] = [];

  stockGraphBars: StockGraphBar[] = [];
  graphErrorMessage = '';
  graphLastSyncedLabel = 'Not synced yet';
  private calendarEntries: CalendarEntry[] = [];
  private viewedMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  readonly profileForm: FormGroup<{
    fullName: FormControl<string>;
    email: FormControl<string>;
    username: FormControl<string>;
  }>;

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private inventoryService: InventoryService,
    private cdr: ChangeDetectorRef
  ) {
    this.profileForm = this.fb.nonNullable.group({
      fullName: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(120)]],
      email: ['', [Validators.required, Validators.email, Validators.maxLength(120)]],
      username: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(50)]]
    });
  }

  ngOnInit(): void {
    this.applyCurrentUserProfile();
    this.loadDashboardData();
    this.syncLiveRefreshState();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.loadSub?.unsubscribe();
    this.liveRefreshSub?.unsubscribe();
    this.clearProfilePreviewObjectUrl();
  }

  get filteredOverviewTransactions(): OverviewTransactionRow[] {
    const query = this.overviewSearch.trim().toLowerCase();
    const rows = this.recentMovements.slice(0, 8).map(movement => this.toOverviewTransactionRow(movement));

    if (!query) {
      return rows;
    }

    return rows.filter(row => row.searchValue.includes(query));
  }

  toggleSideNav(): void {
    this.sideNavOpen = !this.sideNavOpen;
  }

  switchSection(section: EmployeeSection): void {
    if (section === 'walkin') {
      this.walkInReloadToken++;
    }

    if (section === 'issue') {
      this.patientIssueReloadToken++;
    }

    if (section === 'history') {
      this.historyReloadToken++;
    }

    if (section === 'products') {
      this.productListReloadToken++;
    }

    if (section === 'categories') {
      this.categoryListReloadToken++;
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

  onWalkInSalePosted(_result: WalkInSaleResult): void {
    this.historyReloadToken++;
    this.productListReloadToken++;
    this.refreshDashboardData();
  }

  onPatientIssuePosted(_result: PatientIssueResult): void {
    this.historyReloadToken++;
    this.productListReloadToken++;
    this.refreshDashboardData();
  }

  openCategoryCreate(): void {
    this.switchSection('categoryCreate');
  }

  openCategoryEdit(categoryId: number): void {
    this.selectedCategoryId = categoryId;
    this.switchSection('categoryEdit');
  }

  onCategoryFormCompleted(): void {
    this.selectedCategoryId = null;
    this.switchSection('categories');
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

  openProfileEditor(): void {
    this.fillProfileFormFromCurrentUser();
    this.profileErrorMessage = '';
    this.profileSuccessMessage = '';
    this.resetProfileImageState();
    this.profileEditorOpen = true;
  }

  closeProfileEditor(): void {
    this.profileEditorOpen = false;
    this.profileSaving = false;
    this.profileErrorMessage = '';
    this.profileSuccessMessage = '';
    this.resetProfileImageState();
  }

  saveProfile(): void {
    if (this.profileForm.invalid || this.profileSaving) {
      this.profileForm.markAllAsTouched();
      return;
    }

    this.profileSaving = true;
    this.profileErrorMessage = '';
    this.profileSuccessMessage = '';

    const raw = this.profileForm.getRawValue();
    this.authService
      .updateProfile({
        fullName: raw.fullName,
        email: raw.email,
        username: raw.username,
        avatarFile: this.selectedAvatarFile,
        removeAvatar: !this.profilePreviewUrl && !!this.avatarUrl && !this.selectedAvatarFile
      })
      .pipe(finalize(() => (this.profileSaving = false)))
      .subscribe({
        next: () => {
          this.applyCurrentUserProfile();
          this.fillProfileFormFromCurrentUser();
          this.resetProfileImageState();
          this.profileSuccessMessage = 'Profile updated successfully.';
        },
        error: (error: unknown) => {
          const code = error instanceof Error ? error.message : '';
          if (code === 'USERNAME_EXISTS') {
            this.profileErrorMessage = 'Username is already in use.';
            return;
          }
          if (code === 'EMAIL_EXISTS') {
            this.profileErrorMessage = 'Email is already in use.';
            return;
          }
          if (code === 'INVALID_PROFILE') {
            this.profileErrorMessage = 'Please provide valid full name, email, and username.';
            return;
          }

          if (code === 'INVALID_AVATAR_FILE') {
            this.profileErrorMessage = 'Only JPG, PNG, and WebP images are allowed.';
            return;
          }

          if (code === 'AVATAR_TOO_LARGE') {
            this.profileErrorMessage = 'Profile image must be 2 MB or smaller.';
            return;
          }

          this.profileErrorMessage = 'Unable to update profile right now. Please try again.';
        }
      });
  }

  onProfileImageSelected(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0] ?? null;

    if (input) {
      input.value = '';
    }

    if (!file) {
      return;
    }

    const allowedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
    const maxBytes = 2 * 1024 * 1024;

    if (!allowedMimeTypes.has(file.type)) {
      this.profileImageErrorMessage = 'Only JPG, PNG, and WebP images are allowed.';
      this.refreshUi();
      return;
    }

    if (file.size > maxBytes) {
      this.profileImageErrorMessage = 'Profile image must be 2 MB or smaller.';
      this.refreshUi();
      return;
    }

    this.profileImageErrorMessage = '';
    this.profileSuccessMessage = '';
    this.selectedAvatarFile = file;
    this.profileSelectedImageName = file.name;
    this.setProfilePreviewFromFile(file);
    this.refreshUi();
  }

  removeProfilePhoto(): void {
    this.clearProfilePreviewObjectUrl();
    this.selectedAvatarFile = null;
    this.profileSelectedImageName = '';
    this.profilePreviewUrl = null;
    this.profileImageErrorMessage = '';
    this.profileSuccessMessage = '';
    this.refreshUi();
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

  formatRelativeTime(isoDate: string): string {
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

  trackByMovementId(_index: number, movement: StockMovement): number {
    return movement.id;
  }

  trackByTransactionId(_index: number, row: OverviewTransactionRow): number {
    return row.id;
  }

  private applyCurrentUserProfile(): void {
    const currentUser = this.authService.currentUser();
    if (!currentUser) {
      return;
    }

    const username = currentUser.username?.trim() || 'staff';
    const fullName = currentUser.fullName?.trim() || username;
    this.displayName = fullName;
    this.roleLabel = currentUser.role === 'admin' ? 'Administrator' : 'Employee';
    this.accountUsername = username;
    this.accountEmail = currentUser.email?.trim() || '';
    this.avatarUrl = currentUser.avatarUrl?.trim() || null;

    const initials = fullName
      .split(/\s+/)
      .map(part => part[0] || '')
      .join('')
      .slice(0, 2)
      .toUpperCase();
    this.avatarInitials = initials || fullName.slice(0, 2).toUpperCase();
  }

  private fillProfileFormFromCurrentUser(): void {
    const currentUser = this.authService.currentUser();
    if (!currentUser) {
      return;
    }

    this.profileForm.setValue({
      fullName: currentUser.fullName?.trim() || currentUser.username?.trim() || '',
      email: currentUser.email?.trim() || '',
      username: currentUser.username?.trim() || ''
    });
  }

  private resetProfileImageState(): void {
    this.clearProfilePreviewObjectUrl();
    this.selectedAvatarFile = null;
    this.profileSelectedImageName = '';
    this.profileImageErrorMessage = '';
    this.profilePreviewUrl = this.avatarUrl;
    this.refreshUi();
  }

  private setProfilePreviewFromFile(file: File): void {
    this.clearProfilePreviewObjectUrl();
    this.profilePreviewObjectUrl = URL.createObjectURL(file);
    this.profilePreviewUrl = this.profilePreviewObjectUrl;
  }

  private clearProfilePreviewObjectUrl(): void {
    if (this.profilePreviewObjectUrl) {
      URL.revokeObjectURL(this.profilePreviewObjectUrl);
      this.profilePreviewObjectUrl = null;
    }
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
      movements: this.buildRequest(this.inventoryService.getStockMovements({ limit: 120 }), [] as StockMovement[]),
      stockGraph: this.buildRequest(this.inventoryService.getDashboardStockGraph(6), [] as StockGraphPoint[])
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
        next: ({ summary, movements, stockGraph }) => {
          if (loadId !== this.currentLoadId) {
            return;
          }

          this.totalProducts = summary.data.totalProducts;
          this.stockLeft = summary.data.stockLeft;
          this.lowStockItems = summary.data.lowStockItems;
          this.outOfStockItems = summary.data.outOfStockItems;
          this.salesToday = summary.data.salesToday;
          this.transactionsToday = summary.data.transactionsToday;
          this.weeklyMovements = summary.data.stockMovementsLast7Days;
          this.totalCategories = summary.data.totalCategories;
          this.recentMovements = movements.data.slice(0, 6);
          this.calendarEntries = this.mapCalendarEntries(movements.data);
          this.stockGraphBars = this.buildStockGraphBars(stockGraph.data);
          this.graphErrorMessage = stockGraph.error ? this.getGraphErrorMessage(stockGraph.error) : '';
          if (!stockGraph.error) {
            this.graphLastSyncedLabel = this.formatSyncTime(new Date());
          }
          this.errorMessage = this.getDashboardErrorMessage(summary.error, movements.error);
          this.buildCalendar(this.viewedMonth);
          this.updateRangeMetrics();
          this.refreshUi();
        },
        error: () => {
          if (loadId !== this.currentLoadId) {
            return;
          }

          this.errorMessage = 'Unable to load employee dashboard data.';
          this.totalProducts = 0;
          this.stockLeft = 0;
          this.lowStockItems = 0;
          this.outOfStockItems = 0;
          this.salesToday = 0;
          this.transactionsToday = 0;
          this.weeklyMovements = 0;
          this.totalCategories = 0;
          this.recentMovements = [];
          this.calendarEntries = [];
          this.stockGraphBars = [];
          this.graphErrorMessage = 'Unable to load stock graph data.';
          this.buildCalendar(this.viewedMonth);
          this.updateRangeMetrics();
          this.refreshUi();
        }
      });
  }

  private buildRequest<T>(request$: Observable<T>, fallback: T): Observable<DashboardLoadResult<T>> {
    return request$.pipe(
      timeout(EmployeeDashboardComponent.LOAD_TIMEOUT_MS),
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

    this.liveRefreshSub = interval(EmployeeDashboardComponent.LIVE_REFRESH_INTERVAL_MS).subscribe(() => {
      if (this.loading) {
        return;
      }
      this.loadDashboardData();
    });
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

  private mapCalendarEntries(movements: StockMovement[]): CalendarEntry[] {
    return movements.map((movement, index) => ({
      id: movement.id || index + 1,
      name: movement.productName || 'Unknown product',
      quantity: Math.abs(movement.quantity),
      date: this.toIsoDate(movement.createdAt)
    }));
  }

  private buildStockGraphBars(stockRows: StockGraphPoint[]): StockGraphBar[] {
    const topProducts = stockRows
      .map(stockRow => ({
        name: stockRow.productName,
        category: stockRow.categoryName || 'General',
        stock: Math.max(0, Number(stockRow.qtyOnHand ?? 0))
      }))
      .sort((a, b) => b.stock - a.stock)
      .slice(0, 6);

    const maxStock = topProducts.reduce((max, product) => Math.max(max, product.stock), 0) || 1;

    return topProducts.map(product => ({
      ...product,
      percent: Math.max(8, Math.round((product.stock / maxStock) * 100))
    }));
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

      const items = this.getEntriesByDate(date);
      const stockTotal = items.reduce((sum, item) => sum + item.quantity, 0);

      days.push({
        value: date.getDate(),
        date,
        inCurrentMonth: date.getMonth() === month,
        isToday: this.isSameDay(date, today),
        stockTotal,
        topItems: items.slice(0, 2)
      });
    }

    this.calendarWeeks = [];
    for (let i = 0; i < days.length; i += 7) {
      this.calendarWeeks.push(days.slice(i, i + 7));
    }
  }

  private updateRangeMetrics(): void {
    const { start, end } = this.getRangeBounds(this.selectedDate, this.selectedRange);

    const entries = this.calendarEntries.filter(entry => {
      const entryDate = this.parseISODate(entry.date);
      return entryDate >= start && entryDate <= end;
    });

    this.rangeStockTotal = entries.reduce((sum, entry) => sum + entry.quantity, 0);

    const summaryMap = new Map<string, number>();
    for (const entry of entries) {
      summaryMap.set(entry.name, (summaryMap.get(entry.name) ?? 0) + entry.quantity);
    }

    this.rangeProductCount = summaryMap.size;
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

    if (mode === 'month') {
      const start = new Date(date.getFullYear(), date.getMonth(), 1);
      const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
      return { start, end };
    }

    const start = new Date(date.getFullYear(), 0, 1);
    const end = new Date(date.getFullYear(), 11, 31);
    return { start, end };
  }

  private formatRangeLabel(start: Date, end: Date, mode: RangeMode): string {
    const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };

    if (mode === 'day') {
      return start.toLocaleDateString(APP_LOCALE, opts);
    }

    if (mode === 'month') {
      return start.toLocaleDateString(APP_LOCALE, { month: 'long', year: 'numeric' });
    }

    return `${start.getFullYear()} yearly stock movement`;
  }

  private getEntriesByDate(targetDate: Date): CalendarEntry[] {
    return this.calendarEntries.filter(entry => this.isSameDay(this.parseISODate(entry.date), targetDate));
  }

  private isSameDay(a: Date, b: Date): boolean {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  private parseISODate(value: string): Date {
    return new Date(`${value}T00:00:00`);
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

  private formatSyncTime(value: Date): string {
    return value.toLocaleTimeString(APP_LOCALE, { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  }

  private getDashboardErrorMessage(summaryError: unknown | null, movementsError: unknown | null): string {
    const summaryUnavailable = this.isApiUnavailable(summaryError);
    const movementsUnavailable = this.isApiUnavailable(movementsError);

    if (summaryUnavailable && movementsUnavailable) {
      return 'Inventory API is offline. Start the API server on http://localhost:3001 and retry.';
    }

    if (summaryError && movementsError) {
      return this.autoRetryUsed
        ? 'Unable to load employee dashboard core data after retry. Please retry.'
        : 'Unable to load employee dashboard core data.';
    }

    if (summaryError) {
      return 'Dashboard summary is temporarily unavailable.';
    }

    if (movementsError) {
      return 'Recent stock activity is temporarily unavailable.';
    }

    return '';
  }

  private getGraphErrorMessage(graphError: unknown): string {
    if (this.isApiUnavailable(graphError)) {
      return 'Stock graph is unavailable because the inventory API is offline.';
    }

    if (this.isNotFoundError(graphError)) {
      return 'Stock graph endpoint is unavailable. Restart the API server and retry.';
    }

    return 'Unable to load stock graph data.';
  }

  private isApiUnavailable(error: unknown | null): boolean {
    return error instanceof HttpErrorResponse && error.status === 0;
  }

  private isNotFoundError(error: unknown | null): boolean {
    return error instanceof HttpErrorResponse && error.status === 404;
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
