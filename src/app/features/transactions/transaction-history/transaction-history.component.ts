import { CommonModule, isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectorRef,
  Component,
  Inject,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  PLATFORM_ID,
  SimpleChanges
} from '@angular/core';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Subscription, finalize, firstValueFrom, retry, timeout, timer } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { AuthService } from '../../../core/services/auth.service';
import { Product } from '../../../shared/models/product.model';
import {
  InventoryLocation,
  InventoryService,
  SaleResetResult,
  SaleTransactionDetail,
  StockMovement,
  StockMovementQuery,
  TransactionDeleteResult
} from '../../../core/services/inventory.service';
import { TransactionReferenceService } from '../../../core/services/transaction-reference.service';
import { APP_LOCALE, formatPeso } from '../../../shared/utils/locale-format';

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
  patientId: FormControl<string>;
  dateFrom: FormControl<string>;
  dateTo: FormControl<string>;
  pageSize: FormControl<string>;
}

interface ConfirmDetailRow {
  label: string;
  value: string;
}

@Component({
  selector: 'app-transaction-history',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink, MatButtonModule, MatCardModule],
  templateUrl: './transaction-history.component.html',
  styleUrls: ['./transaction-history.component.css']
})
export class TransactionHistoryComponent implements OnInit, OnChanges, OnDestroy {
  private static readonly LOAD_TIMEOUT_MS = 15000;
  private referencesSub?: Subscription;
  private movementsSub?: Subscription;
  private detailSub?: Subscription;
  private initialized = false;
  private destroyed = false;
  private currentReferencesLoadId = 0;
  private currentMovementsLoadId = 0;

  @Input() embeddedMode = false;
  @Input() reloadToken = 0;

  loadingFilters = false;
  loadingFiltersMessage = 'Loading filters...';
  loadingTable = false;
  loadingTableMessage = 'Loading transactions...';
  exportingPage = false;
  exportingAll = false;
  loadingDetail = false;
  deletingTransactionKey: string | null = null;
  clearingSales = false;
  errorMessage = '';
  successMessage = '';
  detailErrorMessage = '';

  displayName = 'Staff';
  roleLabel = 'Employee';
  avatarInitials = 'ST';
  canManageTransactions = false;

  confirmModalOpen = false;
  confirmModalTitle = '';
  confirmModalMessage = '';
  confirmModalConfirmLabel = 'Confirm';
  confirmTypedRequiredText = '';
  confirmTypedValue = '';
  confirmDetailRows: ConfirmDetailRow[] = [];
  private pendingConfirmAction: (() => void) | null = null;

  readonly todayLabel = new Intl.DateTimeFormat(APP_LOCALE, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  }).format(new Date());

  products: Product[] = [];
  locations: InventoryLocation[] = [];
  movements: StockMovement[] = [];
  selectedSaleDetail: SaleTransactionDetail | null = null;
  detailModalOpen = false;
  private activeSaleId: number | null = null;

  page = 1;
  limit = 10;
  total = 0;
  private referencesLoaded = false;

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
    private transactionReferenceService: TransactionReferenceService,
    private inventoryService: InventoryService,
    @Inject(PLATFORM_ID) private platformId: object,
    private cdr: ChangeDetectorRef
  ) {
    this.form = this.fb.nonNullable.group({
      movementType: this.fb.nonNullable.control<MovementTypeFilter>(''),
      productId: this.fb.nonNullable.control(''),
      locationId: this.fb.nonNullable.control(''),
      patientId: this.fb.nonNullable.control(''),
      dateFrom: this.fb.nonNullable.control(''),
      dateTo: this.fb.nonNullable.control(''),
      pageSize: this.fb.nonNullable.control('10')
    });
  }

  ngOnInit(): void {
    this.initialized = true;
    this.applyCurrentUserProfile();
    this.runReferencesLoad('init');
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.initialized) {
      return;
    }

    if (changes['reloadToken']) {
      this.runReferencesLoad('input-change');
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.referencesSub?.unsubscribe();
    this.movementsSub?.unsubscribe();
    this.detailSub?.unsubscribe();
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

  get isConfirmActionDisabled(): boolean {
    if (!this.confirmTypedRequiredText) {
      return false;
    }

    return this.confirmTypedValue.trim() !== this.confirmTypedRequiredText;
  }

  applyFilters(): void {
    if (!this.isDateRangeValid()) {
      this.errorMessage = 'Date From cannot be later than Date To.';
      return;
    }

    this.successMessage = '';
    this.page = 1;
    this.limit = this.parsePageSize(this.form.controls.pageSize.value);
    this.runMovementsLoad('query-change');
  }

  resetFilters(): void {
    this.form.setValue({
      movementType: '',
      productId: '',
      locationId: '',
      patientId: '',
      dateFrom: '',
      dateTo: '',
      pageSize: '10'
    });
    this.page = 1;
    this.limit = 10;
    this.successMessage = '';
    this.runMovementsLoad('query-change');
  }

  retryLoading(): void {
    if (this.referencesLoaded) {
      this.runMovementsLoad('retry');
      return;
    }

    this.runReferencesLoad('retry');
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
    this.runMovementsLoad('query-change');
  }

  nextPage(): void {
    if (this.page >= this.totalPages || this.loadingTable) {
      return;
    }
    this.page++;
    this.runMovementsLoad('query-change');
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
    if (movement.referenceNo?.trim()) {
      return movement.referenceNo.trim();
    }
    const refType = movement.referenceType?.trim();
    if (!refType) {
      return '-';
    }
    if (movement.referenceId === null || movement.referenceId === undefined) {
      return refType;
    }
    return `${refType} #${movement.referenceId}`;
  }

  canOpenReferenceDetails(movement: StockMovement): boolean {
    return movement.referenceType === 'sale' && Number.isInteger(movement.referenceId) && Number(movement.referenceId) > 0;
  }

  openReferenceDetails(movement: StockMovement): void {
    if (!this.canOpenReferenceDetails(movement) || this.loadingDetail || this.deletingTransactionKey !== null || this.clearingSales) {
      return;
    }

    const saleId = Number(movement.referenceId);
    this.detailSub?.unsubscribe();
    this.detailModalOpen = true;
    this.activeSaleId = saleId;
    this.loadSaleDetails(saleId);
  }

  retryReferenceDetails(): void {
    if (!this.activeSaleId || this.loadingDetail) {
      return;
    }

    this.detailSub?.unsubscribe();
    this.loadSaleDetails(this.activeSaleId);
  }

  private loadSaleDetails(saleId: number): void {
    this.loadingDetail = true;
    this.detailErrorMessage = '';
    this.selectedSaleDetail = null;
    this.refreshUi();

    this.detailSub = this.inventoryService
      .getSaleTransactionDetails(saleId)
      .pipe(
        timeout(TransactionHistoryComponent.LOAD_TIMEOUT_MS),
        retry({
          count: 1,
          delay: () => timer(250)
        }),
        finalize(() => {
          this.loadingDetail = false;
          this.refreshUi();
        })
      )
      .subscribe({
        next: detail => {
          this.selectedSaleDetail = detail;
          this.refreshUi();
        },
        error: (error: unknown) => {
          this.detailErrorMessage = this.extractErrorMessage(error, 'Unable to load transaction details. Please retry.');
          this.refreshUi();
        }
      });
  }

  closeReferenceDetails(): void {
    this.detailSub?.unsubscribe();
    this.detailModalOpen = false;
    this.loadingDetail = false;
    this.detailErrorMessage = '';
    this.selectedSaleDetail = null;
    this.activeSaleId = null;
    this.refreshUi();
  }

  canDeleteMovement(movement: StockMovement): boolean {
    return this.canManageTransactions && this.isDeletableMovement(movement);
  }

  deleteMovement(movement: StockMovement): void {
    if (!this.canDeleteMovement(movement) || this.loadingTable || this.clearingSales || this.deletingTransactionKey !== null) {
      return;
    }

    const movementLabel = this.formatMovementType(movement.movementType);
    this.openConfirmationModal({
      title: 'Delete Transaction Record',
      message: this.getDeleteConfirmationMessage(movement),
      confirmLabel: 'Delete Transaction',
      details: this.buildDeleteConfirmationDetails(movement),
      onConfirm: () => this.executeDeleteMovement(movement)
    });
  }

  private executeDeleteMovement(movement: StockMovement): void {
    const transactionKey = this.getTransactionKey(movement);
    this.deletingTransactionKey = transactionKey;
    this.errorMessage = '';
    this.successMessage = '';
    this.refreshUi();

    this.inventoryService.deleteTransactionRecord(movement.id).pipe(
      finalize(() => {
        this.deletingTransactionKey = null;
        this.refreshUi();
      })
    ).subscribe({
      next: result => {
        if (movement.referenceType === 'sale' && this.activeSaleId === movement.referenceId) {
          this.closeReferenceDetails();
        }
        this.afterTransactionDelete(result, movement);
      },
      error: (error: unknown) => {
        this.errorMessage = this.extractErrorMessage(error, 'Unable to delete the selected transaction.');
        this.refreshUi();
      }
    });
  }

  deleteSelectedSaleFromDetail(): void {
    if (!this.selectedSaleDetail) {
      return;
    }

    const sourceMovement = this.movements.find(
      movement => movement.referenceType === 'sale' && movement.referenceId === this.selectedSaleDetail?.id
    );

    if (!sourceMovement) {
      this.detailErrorMessage = 'Unable to locate the selected sale in the current transaction list.';
      this.refreshUi();
      return;
    }

    this.deleteMovement(sourceMovement);
  }

  clearAllSales(): void {
    if (!this.canManageTransactions || this.loadingTable || this.clearingSales || this.deletingTransactionKey !== null) {
      return;
    }

    this.openConfirmationModal({
      title: 'Clear All Transaction History',
      message:
        'This will permanently remove all transaction history used for testing, including walk-in sales, patient issues, receiving and adjustment ledger rows, and linked patient IDs. Inventory stock will be reset to zero so the database stays consistent.',
      confirmLabel: 'Clear All Transactions',
      requiredText: 'CLEAR',
      onConfirm: () => this.executeClearAllSales()
    });
  }

  private executeClearAllSales(): void {
    this.clearingSales = true;
    this.errorMessage = '';
    this.successMessage = '';
    this.refreshUi();

    this.inventoryService.clearAllSaleTransactions().pipe(
      finalize(() => {
        this.clearingSales = false;
        this.refreshUi();
      })
    ).subscribe({
      next: result => {
        this.closeReferenceDetails();
        this.afterTransactionHistoryReset(result);
      },
      error: (error: unknown) => {
        this.errorMessage = this.extractErrorMessage(error, 'Unable to clear transaction history.');
        this.refreshUi();
      }
    });
  }

  closeConfirmationModal(): void {
    this.confirmModalOpen = false;
    this.confirmModalTitle = '';
    this.confirmModalMessage = '';
    this.confirmModalConfirmLabel = 'Confirm';
    this.confirmTypedRequiredText = '';
    this.confirmTypedValue = '';
    this.confirmDetailRows = [];
    this.pendingConfirmAction = null;
    this.refreshUi();
  }

  submitConfirmationModal(): void {
    if (this.isConfirmActionDisabled || !this.pendingConfirmAction) {
      return;
    }

    const action = this.pendingConfirmAction;
    this.closeConfirmationModal();
    action();
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
    this.canManageTransactions = currentUser.role === 'admin';

    const initials = fullName
      .split(/\s+/)
      .map(part => part[0] || '')
      .join('')
      .slice(0, 2)
      .toUpperCase();
    this.avatarInitials = initials || fullName.slice(0, 2).toUpperCase();
  }

  private runReferencesLoad(reason: 'init' | 'input-change' | 'retry'): void {
    this.referencesSub?.unsubscribe();
    const loadId = ++this.currentReferencesLoadId;

    this.loadingFilters = true;
    this.loadingFiltersMessage =
      reason === 'retry' ? 'Connection issue. Retrying filters...' : 'Loading filters...';
    this.errorMessage = '';
    this.successMessage = '';
    this.referencesLoaded = false;
    this.refreshUi();

    this.referencesSub = this.transactionReferenceService
      .load({
        onRetry: () => {
          if (loadId !== this.currentReferencesLoadId) {
            return;
          }
          this.loadingFiltersMessage = 'Connection issue. Retrying once...';
          this.refreshUi();
        }
      })
      .pipe(
        finalize(() => {
          if (loadId !== this.currentReferencesLoadId) {
            return;
          }
          this.loadingFilters = false;
          this.loadingFiltersMessage = 'Loading filters...';
          this.refreshUi();
        })
      )
      .subscribe({
        next: ({ products, locations }) => {
          if (loadId !== this.currentReferencesLoadId) {
            return;
          }

          this.products = products;
          this.locations = locations;
          this.referencesLoaded = true;
          this.refreshUi();
          this.runMovementsLoad('init');
        },
        error: (error: unknown) => {
          if (loadId !== this.currentReferencesLoadId) {
            return;
          }
          this.referencesLoaded = false;
          this.products = [];
          this.locations = [];
          this.errorMessage = this.extractErrorMessage(error, 'Unable to load products and locations. Please retry.');
          this.refreshUi();
        }
      });
  }

  private runMovementsLoad(reason: 'init' | 'query-change' | 'retry'): void {
    if (!this.referencesLoaded) {
      this.runReferencesLoad(reason === 'retry' ? 'retry' : 'init');
      return;
    }

    this.movementsSub?.unsubscribe();
    const loadId = ++this.currentMovementsLoadId;

    this.loadingTable = true;
    this.loadingTableMessage =
      reason === 'retry' ? 'Connection issue. Retrying transactions...' : 'Loading transactions...';
    this.errorMessage = '';
    this.refreshUi();

    const query: StockMovementQuery = {
      ...this.buildFilterQuery(),
      page: this.page,
      limit: this.limit
    };

    this.movementsSub = this.inventoryService
      .getStockMovementsPage(query)
      .pipe(
        timeout(TransactionHistoryComponent.LOAD_TIMEOUT_MS),
        retry({
          count: 1,
          delay: () => {
            if (loadId !== this.currentMovementsLoadId) {
              return timer(0);
            }
            this.loadingTableMessage = 'Connection issue. Retrying once...';
            this.refreshUi();
            return timer(250);
          }
        }),
        finalize(() => {
          if (loadId !== this.currentMovementsLoadId) {
            return;
          }
          this.loadingTable = false;
          this.loadingTableMessage = 'Loading transactions...';
          this.refreshUi();
        })
      )
      .subscribe({
        next: result => {
          if (loadId !== this.currentMovementsLoadId) {
            return;
          }
          this.page = result.page;
          this.limit = result.limit;
          this.total = result.total;
          this.movements = result.movements;
          this.refreshUi();
        },
        error: (error: unknown) => {
          if (loadId !== this.currentMovementsLoadId) {
            return;
          }
          this.errorMessage = this.extractErrorMessage(error, 'Unable to load transaction history. Please retry.');
          this.movements = [];
          this.total = 0;
          this.refreshUi();
        }
      });
  }

  private buildFilterQuery(): StockMovementQuery {
    const movementType = this.form.controls.movementType.value;
    const productId = this.parseOptionalPositiveInt(this.form.controls.productId.value);
    const locationId = this.parseOptionalPositiveInt(this.form.controls.locationId.value);
    const patientId = this.form.controls.patientId.value.trim();
    const dateFrom = this.form.controls.dateFrom.value.trim();
    const dateTo = this.form.controls.dateTo.value.trim();

    return {
      movementType: movementType || undefined,
      productId: productId ?? undefined,
      locationId: locationId ?? undefined,
      patientId: patientId || undefined,
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

  private afterSaleReset(result: SaleResetResult, prefixMessage: string): void {
    if (this.page > 1 && this.movements.length <= 1) {
      this.page -= 1;
    }

    this.successMessage = `${prefixMessage} Next Patient ID: ${result.nextPatientId}.`;
    this.runMovementsLoad('query-change');
  }

  private afterTransactionDelete(result: TransactionDeleteResult, movement: StockMovement): void {
    const deletedCount = Math.max(1, Number(result.deletedMovementLogs || 1));
    const remainingAfterDelete = Math.max(0, this.total - deletedCount);
    const maxPageAfterDelete = Math.max(1, Math.ceil(remainingAfterDelete / this.limit));

    if (this.page > maxPageAfterDelete) {
      this.page = maxPageAfterDelete;
    }

    const referenceLabel = result.referenceNo?.trim() || this.getReferenceLabel(movement);
    const formattedType = this.formatMovementType(movement.movementType);
    const referenceSuffix = referenceLabel && referenceLabel !== '-' ? ` (${referenceLabel})` : '';
    const patientSuffix = result.nextPatientId ? ` Next Patient ID: ${result.nextPatientId}.` : '';

    this.successMessage =
      `Deleted ${formattedType}${referenceSuffix} successfully. ` +
      `${deletedCount} history record${deletedCount === 1 ? '' : 's'} removed.` +
      patientSuffix;
    this.runMovementsLoad('query-change');
  }

  private afterTransactionHistoryReset(result: SaleResetResult): void {
    this.form.setValue({
      movementType: '',
      productId: '',
      locationId: '',
      patientId: '',
      dateFrom: '',
      dateTo: '',
      pageSize: '10'
    });
    this.page = 1;
    this.limit = 10;
    this.total = 0;
    this.movements = [];

    const clearedTransactions = result.deletedMovementLogs ?? 0;
    const clearedSales = result.deletedSales ?? 0;
    const clearedIssues = result.deletedPatientIssues ?? 0;
    const remainingTransactions = result.remainingTransactions ?? 0;

    this.successMessage =
      `Cleared ${clearedTransactions} transaction record${clearedTransactions === 1 ? '' : 's'} ` +
      `(${clearedSales} sales, ${clearedIssues} patient issues). ` +
      `${remainingTransactions} transaction${remainingTransactions === 1 ? '' : 's'} remaining. ` +
      `Next Patient ID: ${result.nextPatientId}.`;
    this.refreshUi();
    this.runMovementsLoad('query-change');
  }

  private openConfirmationModal(options: {
    title: string;
    message: string;
    confirmLabel: string;
    requiredText?: string;
    details?: ConfirmDetailRow[];
    onConfirm: () => void;
  }): void {
    if (!isPlatformBrowser(this.platformId) || !this.canManageTransactions) {
      return;
    }

    this.confirmModalTitle = options.title;
    this.confirmModalMessage = options.message;
    this.confirmModalConfirmLabel = options.confirmLabel;
    this.confirmTypedRequiredText = options.requiredText?.trim() || '';
    this.confirmTypedValue = '';
    this.confirmDetailRows = Array.isArray(options.details) ? options.details : [];
    this.pendingConfirmAction = options.onConfirm;
    this.confirmModalOpen = true;
    this.refreshUi();
  }

  getDeleteButtonLabel(movement: StockMovement): string {
    return this.isDeletingMovement(movement) ? 'Deleting...' : 'Delete';
  }

  isDeletingMovement(movement: StockMovement): boolean {
    return this.deletingTransactionKey === this.getTransactionKey(movement);
  }

  private isDeletableMovement(movement: StockMovement): boolean {
    if (movement.referenceType === 'sale' && Number.isInteger(movement.referenceId) && Number(movement.referenceId) > 0) {
      return true;
    }

    if (
      movement.referenceType === 'patient_issue' &&
      Number.isInteger(movement.referenceId) &&
      Number(movement.referenceId) > 0
    ) {
      return true;
    }

    return ['RECEIVE', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT'].includes(movement.movementType);
  }

  private getTransactionKey(movement: StockMovement): string {
    if (
      (movement.referenceType === 'sale' || movement.referenceType === 'patient_issue') &&
      Number.isInteger(movement.referenceId) &&
      Number(movement.referenceId) > 0
    ) {
      return `${movement.referenceType}:${movement.referenceId}`;
    }

    return `movement:${movement.id}`;
  }

  private getDeleteConfirmationMessage(movement: StockMovement): string {
    if (movement.referenceType === 'sale') {
      return 'This will remove the sale header, related sale items, linked patient record, and all sale ledger rows, then restore the deducted stock.';
    }

    if (movement.referenceType === 'patient_issue') {
      return 'This will remove the patient issue, all issued items, and related ledger rows, then restore the deducted stock.';
    }

    return 'This will remove the selected stock receive/adjustment row and reverse its stock effect in the database.';
  }

  private buildDeleteConfirmationDetails(movement: StockMovement): ConfirmDetailRow[] {
    return [
      { label: 'Type', value: this.formatMovementType(movement.movementType) },
      { label: 'Product', value: movement.productName || '-' },
      { label: 'Location', value: movement.locationName || 'General' },
      { label: 'Qty', value: String(movement.quantity) },
      { label: 'Patient ID', value: movement.patientId || '-' },
      { label: 'Reference', value: this.getReferenceLabel(movement) }
    ];
  }

  private downloadCsv(records: StockMovement[], prefix: string): void {
    const headers = [
      'Date',
      'Type',
      'Product',
      'Location',
      'Quantity',
      'Unit Cost',
      'Amount',
      'Patient ID',
      'Patient Name',
      'Reference',
      'By User',
      'Notes'
    ];
    const rows = records.map(movement => [
      this.toDisplayDate(movement.createdAt),
      this.formatMovementType(movement.movementType),
      movement.productName,
      movement.locationName || 'General',
      String(movement.quantity),
      movement.unitCost !== null ? formatPeso(movement.unitCost) : '',
      movement.unitCost !== null ? formatPeso(Math.abs(movement.quantity) * movement.unitCost) : '',
      movement.patientId || '',
      movement.patientName || '',
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
    return date.toLocaleString(APP_LOCALE);
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
    if (typeof error === 'object' && error !== null && 'name' in error && (error as { name: string }).name === 'TimeoutError') {
      return 'Request timed out while loading transaction history. Check API and database.';
    }

    if (!(error instanceof HttpErrorResponse)) {
      return fallback;
    }

    const payload = (error.error || {}) as { message?: string };
    if (typeof payload.message === 'string' && payload.message.trim()) {
      return payload.message;
    }

    return fallback;
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
}
