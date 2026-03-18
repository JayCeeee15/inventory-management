import {
  ChangeDetectorRef,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  SimpleChanges
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  AbstractControl,
  FormArray,
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators
} from '@angular/forms';
import { RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { Subscription, finalize, forkJoin, timeout } from 'rxjs';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { Product } from '../../../shared/models/product.model';
import { ProductService } from '../../../core/services/product.service';
import {
  InventoryLocation,
  InventoryService,
  InventoryTransactionItemInput,
  WalkInSaleResult
} from '../../../core/services/inventory.service';
import { TransactionReferenceService } from '../../../core/services/transaction-reference.service';
import { formatPeso } from '../../../shared/utils/locale-format';

@Component({
  selector: 'app-walk-in-sale',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterLink,
    MatCardModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule
  ],
  templateUrl: './walk-in-sale.component.html',
  styleUrls: ['./walk-in-sale.component.css']
})
export class WalkInSaleComponent implements OnInit, OnChanges, OnDestroy {
  private static readonly STOCK_REFRESH_ERROR_MESSAGE =
    'Unable to refresh stock for the selected product and location.';

  private loadSub?: Subscription;
  private formChangesSub?: Subscription;
  private availabilitySubs: Array<Subscription | undefined> = [];
  private stockRequestIds: number[] = [];
  private currentLoadId = 0;
  private nextStockRequestId = 0;
  private initialized = false;
  private destroyed = false;

  @Input() embeddedMode = false;
  @Input() reloadToken = 0;
  @Output() salePosted = new EventEmitter<WalkInSaleResult>();

  loading = false;
  loadingMessage = 'Loading products, locations, and patient ID...';
  submitting = false;
  errorMessage = '';
  successMessage = '';

  products: Product[] = [];
  locations: InventoryLocation[] = [];
  estimatedTotal = 0;
  estimatedChange = 0;
  availableStocks: number[] = [];
  stockRowLoading: boolean[] = [];

  form: FormGroup;

  constructor(
    private fb: FormBuilder,
    private productService: ProductService,
    private inventoryService: InventoryService,
    private transactionReferenceService: TransactionReferenceService,
    private cdr: ChangeDetectorRef
  ) {
    this.form = this.fb.group({
      patientName: [''],
      patientId: [{ value: '', disabled: true }],
      notes: [''],
      paymentMethod: ['cash', Validators.required],
      amountPaid: [0, [Validators.required, Validators.min(0)]],
      items: this.fb.array([])
    });
  }

  ngOnInit(): void {
    this.initialized = true;
    this.formChangesSub = this.form.valueChanges.subscribe(() => this.updatePaymentSummary());
    this.runLoad('init');
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.initialized) {
      return;
    }

    if (changes['reloadToken']) {
      this.runLoad('input-change');
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.loadSub?.unsubscribe();
    this.formChangesSub?.unsubscribe();
    this.availabilitySubs.forEach(subscription => subscription?.unsubscribe());
  }

  get items(): FormArray<FormGroup> {
    return this.form.get('items') as FormArray<FormGroup>;
  }

  addItem(): void {
    this.items.push(this.createItemGroup(this.products[0]?.id ?? null, this.locations[0]?.id ?? null));
    this.availableStocks.push(0);
    this.stockRowLoading.push(false);
    this.availabilitySubs.push(undefined);
    this.stockRequestIds.push(0);
    this.refreshItemAvailability(this.items.length - 1);
    this.updatePaymentSummary();
  }

  removeItem(index: number): void {
    if (this.items.length <= 1) {
      return;
    }
    this.availabilitySubs[index]?.unsubscribe();
    this.availabilitySubs.splice(index, 1);
    this.availableStocks.splice(index, 1);
    this.stockRowLoading.splice(index, 1);
    this.stockRequestIds.splice(index, 1);
    this.items.removeAt(index);
    this.refreshAllItemAvailability();
    this.updatePaymentSummary();
  }

  retryReferenceData(): void {
    this.runLoad('retry');
  }

  getAvailableStock(index: number): number {
    return Math.max(0, Number(this.availableStocks[index] ?? 0));
  }

  getLineSubtotal(index: number): number {
    const control = this.items.at(index);
    const productId = Number(control?.get('productId')?.value ?? 0);
    const quantity = Number(control?.get('quantity')?.value ?? 0);
    if (!productId || !Number.isFinite(quantity) || quantity <= 0) {
      return 0;
    }

    const product = this.products.find(entry => entry.id === productId);
    const unitPrice = Number(product?.price ?? 0);
    return Number((unitPrice * quantity).toFixed(2));
  }

  hasPendingStockRefresh(): boolean {
    return this.stockRowLoading.some(Boolean);
  }

  onSubmit(): void {
    this.errorMessage = '';
    this.successMessage = '';

    if (this.form.invalid || this.submitting) {
      this.form.markAllAsTouched();
      this.refreshUi();
      return;
    }

    if (this.hasPendingStockRefresh()) {
      this.errorMessage = 'Refreshing live stock from the database. Please wait a moment.';
      this.refreshUi();
      return;
    }

    this.updatePaymentSummary();
    const raw = this.form.getRawValue();
    const paymentMethod = raw.paymentMethod === 'card' ? 'card' : 'cash';
    const amountPaid = Number(raw.amountPaid ?? 0);
    if (!Number.isFinite(amountPaid) || amountPaid < this.estimatedTotal) {
      this.errorMessage = `Amount paid must be at least ${formatPeso(this.estimatedTotal)}.`;
      this.refreshUi();
      return;
    }

    const lineItems = this.toTransactionItems(this.items.controls);
    if (lineItems.length === 0) {
      this.errorMessage = 'At least one valid item is required.';
      this.refreshUi();
      return;
    }

    for (let index = 0; index < this.items.controls.length; index += 1) {
      const control = this.items.at(index);
      const productId = Number(control.get('productId')?.value ?? 0);
      const quantity = Number(control.get('quantity')?.value ?? 0);
      const available = this.getAvailableStock(index);
      const productName = this.products.find(entry => entry.id === productId)?.name || `Item ${index + 1}`;

      if (quantity > available) {
        this.errorMessage = `${productName} only has ${available} available in the selected location.`;
        this.refreshUi();
        return;
      }
    }

    this.submitting = true;
    this.refreshUi();

    this.inventoryService
      .createWalkInSale({
        patientName: String(raw.patientName || ''),
        patientId: String(raw.patientId || ''),
        notes: String(raw.notes || ''),
        paymentMethod,
        amountPaid: Number(amountPaid.toFixed(2)),
        items: lineItems
      })
      .pipe(
        timeout(10000),
        finalize(() => {
          this.submitting = false;
          this.refreshUi();
        })
      )
      .subscribe({
        next: result => {
          this.successMessage =
            `Saved successfully. Walk-in sale posted. Ref: ${result.saleNo} | Patient ID: ${result.patientId} | Change: ` +
            `${formatPeso(result.changeAmount)}`;
          this.resetForm();
          this.salePosted.emit(result);
          this.runLoad('input-change', true);
          this.refreshUi();
        },
        error: (error: unknown) => {
          this.errorMessage = this.extractErrorMessage(
            error,
            'Failed to post walk-in sale.',
            'Request timed out while posting walk-in sale. Please retry.'
          );
          this.refreshUi();
        }
      });
  }

  private runLoad(reason: 'init' | 'input-change' | 'retry', preserveSuccessMessage = false): void {
    this.loadSub?.unsubscribe();
    const loadId = ++this.currentLoadId;

    this.loading = true;
    this.loadingMessage =
      reason === 'retry'
        ? 'Connection issue. Retrying products, locations, and patient ID...'
        : 'Loading products, locations, and patient ID...';
    this.errorMessage = '';
    if (!preserveSuccessMessage) {
      this.successMessage = '';
    }
    this.refreshUi();

    this.loadSub = forkJoin({
      references: this.transactionReferenceService.load({
        onRetry: () => {
          if (loadId !== this.currentLoadId) {
            return;
          }
          this.loadingMessage = 'Connection issue. Retrying once...';
          this.refreshUi();
        }
      }),
      nextPatientId: this.inventoryService.getNextWalkInPatientId()
    })
      .pipe(
        finalize(() => {
          if (loadId !== this.currentLoadId) {
            return;
          }
          this.loading = false;
          this.loadingMessage = 'Loading products, locations, and patient ID...';
          this.refreshUi();
        })
      )
      .subscribe({
        next: ({ references, nextPatientId }) => {
          if (loadId !== this.currentLoadId) {
            return;
          }

          this.products = references.products;
          this.locations = references.locations;
          this.form.get('patientId')?.setValue(nextPatientId);
          this.resetItemRows();
          this.updatePaymentSummary();
          this.refreshUi();
        },
        error: (error: unknown) => {
          if (loadId !== this.currentLoadId) {
            return;
          }

          this.successMessage = '';
          this.errorMessage = this.extractErrorMessage(
            error,
            'Unable to load products, locations, and patient ID. Please retry.',
            'Request timed out while loading products, locations, and patient ID. Check API and database connection.'
          );
          this.resetItemRows();
          this.form.get('patientId')?.setValue('');
          this.updatePaymentSummary();
          this.refreshUi();
        }
      });
  }

  private createItemGroup(productId: number | null, locationId: number | null): FormGroup {
    return this.fb.group({
      productId: [productId ?? '', Validators.required],
      locationId: [locationId ?? '', Validators.required],
      quantity: [1, [Validators.required, Validators.min(1)]]
    });
  }

  private resetItemRows(): void {
    this.availabilitySubs.forEach(subscription => subscription?.unsubscribe());
    this.availabilitySubs = [];
    this.availableStocks = [];
    this.stockRowLoading = [];
    this.stockRequestIds = [];
    this.items.clear();
    this.addItem();
  }

  private resetForm(): void {
    this.form.patchValue({
      patientName: '',
      notes: '',
      paymentMethod: 'cash',
      amountPaid: 0
    });
    this.resetItemRows();
    this.updatePaymentSummary();
  }

  private toTransactionItems(controls: AbstractControl[]): InventoryTransactionItemInput[] {
    return controls
      .map(control => {
        const value = control.getRawValue() as {
          productId: number | string;
          locationId: number | string;
          quantity: number | string;
        };
        const productId = Number(value.productId);
        const locationId = Number(value.locationId);
        const quantity = Number(value.quantity);
        return { productId, locationId, quantity };
      })
      .filter(item => Number.isInteger(item.productId) && item.productId > 0)
      .filter(item => Number.isInteger(item.locationId) && item.locationId > 0)
      .filter(item => Number.isInteger(item.quantity) && item.quantity > 0);
  }

  private updatePaymentSummary(): void {
    const total = this.items.controls.reduce((sum, control) => {
      const value = control.getRawValue() as {
        productId: number | string;
        quantity: number | string;
      };
      const productId = Number(value.productId);
      const quantity = Number(value.quantity);
      if (!Number.isInteger(productId) || productId <= 0 || !Number.isFinite(quantity) || quantity <= 0) {
        return sum;
      }

      const product = this.products.find(entry => entry.id === productId);
      const unitPrice = Number(product?.price ?? 0);
      return sum + unitPrice * quantity;
    }, 0);

    this.estimatedTotal = Number(total.toFixed(2));
    const paid = Number(this.form.get('amountPaid')?.value ?? 0);
    this.estimatedChange = Number((Math.max(0, (Number.isFinite(paid) ? paid : 0) - this.estimatedTotal)).toFixed(2));
  }

  refreshItemAvailability(index: number): void {
    const control = this.items.at(index);
    if (!control) {
      return;
    }

    const productId = Number(control.get('productId')?.value ?? 0);
    const locationId = Number(control.get('locationId')?.value ?? 0);

    this.availabilitySubs[index]?.unsubscribe();
    const requestId = ++this.nextStockRequestId;
    this.stockRequestIds[index] = requestId;

    if (!Number.isInteger(productId) || productId <= 0 || !Number.isInteger(locationId) || locationId <= 0) {
      this.availableStocks[index] = 0;
      this.stockRowLoading[index] = false;
      if (this.errorMessage === WalkInSaleComponent.STOCK_REFRESH_ERROR_MESSAGE) {
        this.errorMessage = '';
      }
      this.refreshUi();
      return;
    }

    this.availableStocks[index] = 0;
    this.stockRowLoading[index] = true;
    if (this.errorMessage === WalkInSaleComponent.STOCK_REFRESH_ERROR_MESSAGE) {
      this.errorMessage = '';
    }
    this.refreshUi();

    this.availabilitySubs[index] = this.productService
      .getById(productId, locationId)
      .pipe(
        timeout(6000),
        finalize(() => {
          if (this.stockRequestIds[index] !== requestId) {
            return;
          }
          this.stockRowLoading[index] = false;
          this.refreshUi();
        })
      )
      .subscribe({
        next: product => {
          if (this.stockRequestIds[index] !== requestId) {
            return;
          }
          this.availableStocks[index] = Math.max(0, Number(product.qtyAvailable ?? 0));
          this.refreshUi();
        },
        error: () => {
          if (this.stockRequestIds[index] !== requestId) {
            return;
          }
          this.availableStocks[index] = 0;
          this.errorMessage = WalkInSaleComponent.STOCK_REFRESH_ERROR_MESSAGE;
          this.refreshUi();
        }
      });
  }

  private refreshAllItemAvailability(): void {
    this.items.controls.forEach((_control, index) => this.refreshItemAvailability(index));
  }

  private extractErrorMessage(error: unknown, fallback: string, timeoutMessage: string): string {
    if (typeof error === 'object' && error !== null && 'name' in error && (error as { name: string }).name === 'TimeoutError') {
      return timeoutMessage;
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
