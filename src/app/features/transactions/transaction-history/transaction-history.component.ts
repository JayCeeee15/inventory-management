import { CommonModule, isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, Inject, Input, OnInit, PLATFORM_ID } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { finalize, firstValueFrom, forkJoin } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { AuthService } from '../../../core/services/auth.service';
import { ProductService } from '../../../core/services/product.service';
import { Product } from '../../../shared/models/product.model';
import {
  InventoryLocation,
  InventoryService,
  StockMovement,
  StockMovementQuery
} from '../../../core/services/inventory.service';

type MovementTypeFilter =
  | ''
  | 'RECEIVE'
  | 'SALE_WALKIN'
  | 'SALE_ONLINE'
  | 'PATIENT_ISSUE'
  | 'ADJUSTMENT_IN'
  | 'ADJUSTMENT_OUT';

interface TransactionFilterForm {
  movementType: FormControl<MovementTypeFilter>;
  productId: FormControl<string>;
  locationId: FormControl<string>;
  dateFrom: FormControl<string>;
  dateTo: FormControl<string>;
  pageSize: FormControl<string>;
}

@Component({
  selector: 'app-transaction-history',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink, MatButtonModule, MatCardModule],
  templateUrl: './transaction-history.component.html',
  styleUrls: ['./transaction-history.component.css']
})
export class TransactionHistoryComponent implements OnInit {
  @Input() embeddedMode = false;

  loadingFilters = false;
  loadingTable = false;
  exportingPage = false;
  exportingAll = false;
  errorMessage = '';

  displayName = 'Staff';
  roleLabel = 'Employee';
  avatarInitials = 'ST';

  readonly todayLabel = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  }).format(new Date());

  products: Product[] = [];
  locations: InventoryLocation[] = [];
  movements: StockMovement[] = [];

  page = 1;
  limit = 10;
  total = 0;

  readonly pageSizeOptions = [10, 20, 50];
  readonly movementTypeOptions: { value: MovementTypeFilter; label: string }[] = [
    { value: '', label: 'All transactions' },
    { value: 'SALE_WALKIN', label: 'Walk-in sales' },
    { value: 'SALE_ONLINE', label: 'Online sales' },
    { value: 'PATIENT_ISSUE', label: 'Patient issues' },
    { value: 'RECEIVE', label: 'Receiving' },
    { value: 'ADJUSTMENT_IN', label: 'Adjustments in' },
    { value: 'ADJUSTMENT_OUT', label: 'Adjustments out' }
  ];

  readonly form: FormGroup<TransactionFilterForm>;

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private productService: ProductService,
    private inventoryService: InventoryService,
    @Inject(PLATFORM_ID) private platformId: object
  ) {
    this.form = this.fb.nonNullable.group({
      movementType: this.fb.nonNullable.control<MovementTypeFilter>(''),
      productId: this.fb.nonNullable.control(''),
      locationId: this.fb.nonNullable.control(''),
      dateFrom: this.fb.nonNullable.control(''),
      dateTo: this.fb.nonNullable.control(''),
      pageSize: this.fb.nonNullable.control('10')
    });
  }

  ngOnInit(): void {
    this.applyCurrentUserProfile();
    this.loadReferencesAndMovements();
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.total / this.limit));
  }

  get startItem(): number {
    if (this.total === 0) {
      return 0;
    }
    return (this.page - 1) * this.limit + 1;
  }

  get endItem(): number {
    return Math.min(this.page * this.limit, this.total);
  }

  applyFilters(): void {
    if (!this.isDateRangeValid()) {
      this.errorMessage = 'Date From cannot be later than Date To.';
      return;
    }

    this.page = 1;
    this.limit = this.parsePageSize(this.form.controls.pageSize.value);
    this.loadMovements();
  }

  resetFilters(): void {
    this.form.setValue({
      movementType: '',
      productId: '',
      locationId: '',
      dateFrom: '',
      dateTo: '',
      pageSize: '10'
    });
    this.page = 1;
    this.limit = 10;
    this.loadMovements();
  }

  setQuickRange(days: number): void {
    const to = new Date();
    const from = new Date();
    from.setDate(to.getDate() - (days - 1));

    this.form.controls.dateFrom.setValue(this.toInputDate(from));
    this.form.controls.dateTo.setValue(this.toInputDate(to));
    this.applyFilters();
  }

  prevPage(): void {
    if (this.page <= 1 || this.loadingTable) {
      return;
    }
    this.page--;
    this.loadMovements();
  }

  nextPage(): void {
    if (this.page >= this.totalPages || this.loadingTable) {
      return;
    }
    this.page++;
    this.loadMovements();
  }

  exportCurrentPageCsv(): void {
    if (!isPlatformBrowser(this.platformId) || this.exportingPage || this.movements.length === 0) {
      return;
    }

    this.exportingPage = true;
    this.errorMessage = '';

    try {
      this.downloadCsv(this.movements, `transaction-history-page-${this.page}`);
    } finally {
      this.exportingPage = false;
    }
  }

  async exportAllFilteredCsv(): Promise<void> {
    if (!isPlatformBrowser(this.platformId) || this.exportingAll) {
      return;
    }

    if (!this.isDateRangeValid()) {
      this.errorMessage = 'Date From cannot be later than Date To.';
      return;
    }

    this.exportingAll = true;
    this.errorMessage = '';

    try {
      const filters = this.buildFilterQuery();
      const collected: StockMovement[] = [];
      let currentPage = 1;
      const exportLimit = 100;

      while (true) {
        const result = await firstValueFrom(
          this.inventoryService.getStockMovementsPage({
            ...filters,
            page: currentPage,
            limit: exportLimit
          })
        );

        collected.push(...result.movements);

        if (!result.hasMore || result.movements.length === 0) {
          break;
        }

        currentPage += 1;
        if (currentPage > 1000) {
          break;
        }
      }

      if (collected.length === 0) {
        this.errorMessage = 'No transactions found for the current filters.';
        return;
      }

      this.downloadCsv(collected, 'transaction-history-filtered');
    } catch (error: unknown) {
      this.errorMessage = this.extractErrorMessage(error, 'Failed to export filtered transactions.');
    } finally {
      this.exportingAll = false;
    }
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
      return 'Receive';
    }
    return normalized.replace(/_/g, ' ');
  }

  getReferenceLabel(movement: StockMovement): string {
    const refType = movement.referenceType?.trim();
    if (!refType) {
      return '-';
    }
    if (movement.referenceId === null || movement.referenceId === undefined) {
      return refType;
    }
    return `${refType} #${movement.referenceId}`;
  }

  trackByMovementId(_index: number, movement: StockMovement): number {
    return movement.id;
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

    const initials = fullName
      .split(/\s+/)
      .map(part => part[0] || '')
      .join('')
      .slice(0, 2)
      .toUpperCase();
    this.avatarInitials = initials || fullName.slice(0, 2).toUpperCase();
  }

  private loadReferencesAndMovements(): void {
    this.loadingFilters = true;
    this.errorMessage = '';

    forkJoin({
      products: this.productService.getAll({ limit: 250 }),
      locations: this.inventoryService.getLocations()
    })
      .pipe(finalize(() => (this.loadingFilters = false)))
      .subscribe({
        next: ({ products, locations }) => {
          this.products = products.filter(item => item.isActive);
          this.locations = locations.filter(item => item.isActive);
          this.loadMovements();
        },
        error: (error: unknown) => {
          this.errorMessage = this.extractErrorMessage(error, 'Failed to load products and locations.');
        }
      });
  }

  private loadMovements(): void {
    this.loadingTable = true;
    this.errorMessage = '';

    const query: StockMovementQuery = {
      ...this.buildFilterQuery(),
      page: this.page,
      limit: this.limit
    };

    this.inventoryService
      .getStockMovementsPage(query)
      .pipe(finalize(() => (this.loadingTable = false)))
      .subscribe({
        next: result => {
          this.page = result.page;
          this.limit = result.limit;
          this.total = result.total;
          this.movements = result.movements;
        },
        error: (error: unknown) => {
          this.errorMessage = this.extractErrorMessage(error, 'Failed to load transaction history.');
          this.movements = [];
          this.total = 0;
        }
      });
  }

  private buildFilterQuery(): StockMovementQuery {
    const movementType = this.form.controls.movementType.value;
    const productId = this.parseOptionalPositiveInt(this.form.controls.productId.value);
    const locationId = this.parseOptionalPositiveInt(this.form.controls.locationId.value);
    const dateFrom = this.form.controls.dateFrom.value.trim();
    const dateTo = this.form.controls.dateTo.value.trim();

    return {
      movementType: movementType || undefined,
      productId: productId ?? undefined,
      locationId: locationId ?? undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined
    };
  }

  private isDateRangeValid(): boolean {
    const from = this.form.controls.dateFrom.value.trim();
    const to = this.form.controls.dateTo.value.trim();
    if (!from || !to) {
      return true;
    }
    return from <= to;
  }

  private parseOptionalPositiveInt(value: string): number | null {
    if (!value) {
      return null;
    }
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return null;
    }
    return parsed;
  }

  private parsePageSize(value: string): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return 10;
    }
    return parsed;
  }

  private downloadCsv(records: StockMovement[], prefix: string): void {
    const headers = ['Date', 'Type', 'Product', 'Location', 'Quantity', 'Reference', 'By User', 'Notes'];
    const rows = records.map(movement => [
      this.toDisplayDate(movement.createdAt),
      this.formatMovementType(movement.movementType),
      movement.productName,
      movement.locationName || 'General',
      String(movement.quantity),
      this.getReferenceLabel(movement),
      movement.createdBy?.username || 'System',
      movement.notes || ''
    ]);

    const csv = [headers, ...rows]
      .map(row => row.map(value => this.escapeCsv(value)).join(','))
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${prefix}-${this.nowForFileName()}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  private toInputDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private toDisplayDate(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '';
    }
    return date.toLocaleString('en-US');
  }

  private nowForFileName(): string {
    const now = new Date();
    const parts = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
      String(now.getHours()).padStart(2, '0'),
      String(now.getMinutes()).padStart(2, '0'),
      String(now.getSeconds()).padStart(2, '0')
    ];
    return parts.join('');
  }

  private escapeCsv(value: string): string {
    const normalized = value.replace(/"/g, '""');
    return `"${normalized}"`;
  }

  private extractErrorMessage(error: unknown, fallback: string): string {
    if (!(error instanceof HttpErrorResponse)) {
      return fallback;
    }

    const payload = (error.error || {}) as { message?: string };
    if (typeof payload.message === 'string' && payload.message.trim()) {
      return payload.message;
    }

    return fallback;
  }
}
