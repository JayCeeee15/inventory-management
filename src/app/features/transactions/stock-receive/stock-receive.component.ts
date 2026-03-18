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
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Subscription, finalize, timeout } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { Product } from '../../../shared/models/product.model';
import { ProductService } from '../../../core/services/product.service';
import {
  InventoryLocation,
  InventoryService,
  StockReceiveResult
} from '../../../core/services/inventory.service';
import { TransactionReferenceService } from '../../../core/services/transaction-reference.service';

@Component({
  selector: 'app-stock-receive',
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
  templateUrl: './stock-receive.component.html',
  styleUrls: ['./stock-receive.component.css']
})
export class StockReceiveComponent implements OnInit, OnChanges, OnDestroy {
  private loadSub?: Subscription;
  private stockSub?: Subscription;
  private formChangeSub?: Subscription;
  private currentLoadId = 0;
  private initialized = false;
  private destroyed = false;

  @Input() embeddedMode = false;
  @Input() reloadToken = 0;
  @Output() receivePosted = new EventEmitter<StockReceiveResult>();

  loading = false;
  loadingMessage = 'Loading products and locations...';
  submitting = false;
  stockLoading = false;
  errorMessage = '';
  successMessage = '';

  products: Product[] = [];
  locations: InventoryLocation[] = [];
  currentQtyOnHand = 0;
  currentQtyAvailable = 0;
  projectedQtyOnHand = 0;
  projectedQtyAvailable = 0;

  readonly form: FormGroup;

  constructor(
    private fb: FormBuilder,
    private productService: ProductService,
    private inventoryService: InventoryService,
    private transactionReferenceService: TransactionReferenceService,
    private cdr: ChangeDetectorRef
  ) {
    this.form = this.fb.group({
      productId: ['', Validators.required],
      locationId: ['', Validators.required],
      quantity: [1, [Validators.required, Validators.min(1)]],
      unitCost: [0, [Validators.min(0)]],
      notes: ['']
    });
  }

  ngOnInit(): void {
    this.initialized = true;
    this.formChangeSub = this.form.valueChanges.subscribe(() => this.updateProjectedStock());
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
    this.stockSub?.unsubscribe();
    this.formChangeSub?.unsubscribe();
  }

  retryReferenceData(): void {
    this.runLoad('retry');
  }

  refreshCurrentStock(): void {
    this.loadCurrentStock();
  }

  onProductSelectionChange(): void {
    const productId = Number(this.form.get('productId')?.value ?? 0);
    const product = this.products.find(entry => entry.id === productId);
    if (product) {
      this.form.patchValue({ unitCost: product.price }, { emitEvent: false });
    }
    this.loadCurrentStock();
    this.updateProjectedStock();
  }

  onLocationSelectionChange(): void {
    this.loadCurrentStock();
    this.updateProjectedStock();
  }

  onSubmit(): void {
    this.errorMessage = '';
    this.successMessage = '';

    if (this.form.invalid || this.submitting || this.stockLoading) {
      this.form.markAllAsTouched();
      if (this.stockLoading) {
        this.errorMessage = 'Refreshing current stock. Please wait a moment.';
      }
      this.refreshUi();
      return;
    }

    const raw = this.form.getRawValue();
    const productId = Number(raw.productId ?? 0);
    const locationId = Number(raw.locationId ?? 0);
    const quantity = Number(raw.quantity ?? 0);
    const unitCost = raw.unitCost === '' || raw.unitCost === null ? null : Number(raw.unitCost);

    if (!productId || !locationId || !Number.isInteger(quantity) || quantity <= 0) {
      this.errorMessage = 'Select an item, location, and valid receive quantity.';
      this.refreshUi();
      return;
    }

    if (unitCost !== null && (!Number.isFinite(unitCost) || unitCost < 0)) {
      this.errorMessage = 'Unit cost must be zero or greater.';
      this.refreshUi();
      return;
    }

    this.submitting = true;
    this.refreshUi();

    this.inventoryService
      .receiveStock({
        productId,
        locationId,
        quantity,
        unitCost,
        notes: String(raw.notes || '')
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
          const productName = this.products.find(entry => entry.id === productId)?.name || 'Item';
          const locationName = this.locations.find(entry => entry.id === locationId)?.name || 'selected location';

          this.currentQtyOnHand = result.qtyOnHand;
          this.currentQtyAvailable = result.qtyAvailable;
          this.projectedQtyOnHand = result.qtyOnHand;
          this.projectedQtyAvailable = result.qtyAvailable;
          this.successMessage =
            `Saved successfully. Stock received. ${productName} was saved to ${locationName}. ` +
            `On hand is now ${result.qtyOnHand}.`;
          this.form.patchValue(
            {
              quantity: 1,
              notes: '',
              unitCost: this.products.find(entry => entry.id === productId)?.price ?? unitCost ?? 0
            },
            { emitEvent: false }
          );
          this.receivePosted.emit(result);
          this.refreshUi();
        },
        error: (error: unknown) => {
          this.errorMessage = this.extractErrorMessage(
            error,
            'Failed to post stock receiving.',
            'Request timed out while posting stock receiving. Please retry.'
          );
          this.refreshUi();
        }
      });
  }

  private runLoad(reason: 'init' | 'input-change' | 'retry'): void {
    this.loadSub?.unsubscribe();
    const loadId = ++this.currentLoadId;

    this.loading = true;
    this.loadingMessage =
      reason === 'retry'
        ? 'Connection issue. Retrying products and locations...'
        : 'Loading products and locations...';
    this.errorMessage = '';
    if (reason !== 'input-change') {
      this.successMessage = '';
    }
    this.refreshUi();

    this.loadSub = this.transactionReferenceService
      .load({
        onRetry: () => {
          if (loadId !== this.currentLoadId) {
            return;
          }
          this.loadingMessage = 'Connection issue. Retrying once...';
          this.refreshUi();
        }
      })
      .pipe(
        finalize(() => {
          if (loadId !== this.currentLoadId) {
            return;
          }
          this.loading = false;
          this.loadingMessage = 'Loading products and locations...';
          this.refreshUi();
        })
      )
      .subscribe({
        next: ({ products, locations }) => {
          if (loadId !== this.currentLoadId) {
            return;
          }

          this.products = products;
          this.locations = locations;

          const selectedProductId = Number(this.form.get('productId')?.value ?? 0);
          const selectedLocationId = Number(this.form.get('locationId')?.value ?? 0);
          const defaultProductId =
            this.products.some(product => product.id === selectedProductId) ? selectedProductId : this.products[0]?.id ?? '';
          const defaultLocationId =
            this.locations.some(location => location.id === selectedLocationId)
              ? selectedLocationId
              : this.locations[0]?.id ?? '';
          const defaultUnitCost =
            this.products.find(product => product.id === Number(defaultProductId))?.price ?? Number(this.form.get('unitCost')?.value ?? 0);

          this.form.patchValue(
            {
              productId: defaultProductId,
              locationId: defaultLocationId,
              quantity: Number(this.form.get('quantity')?.value ?? 1) || 1,
              unitCost: defaultUnitCost
            },
            { emitEvent: false }
          );

          this.loadCurrentStock();
          this.updateProjectedStock();
          this.refreshUi();
        },
        error: (error: unknown) => {
          if (loadId !== this.currentLoadId) {
            return;
          }

          this.products = [];
          this.locations = [];
          this.currentQtyOnHand = 0;
          this.currentQtyAvailable = 0;
          this.projectedQtyOnHand = 0;
          this.projectedQtyAvailable = 0;
          this.errorMessage = this.extractErrorMessage(
            error,
            'Unable to load products and locations. Please retry.'
          );
          this.refreshUi();
        }
      });
  }

  private loadCurrentStock(): void {
    const productId = Number(this.form.get('productId')?.value ?? 0);
    const locationId = Number(this.form.get('locationId')?.value ?? 0);

    this.stockSub?.unsubscribe();

    if (!productId || !locationId) {
      this.currentQtyOnHand = 0;
      this.currentQtyAvailable = 0;
      this.projectedQtyOnHand = 0;
      this.projectedQtyAvailable = 0;
      this.stockLoading = false;
      this.refreshUi();
      return;
    }

    this.stockLoading = true;
    this.refreshUi();

    this.stockSub = this.productService
      .getById(productId, locationId)
      .pipe(
        timeout(6000),
        finalize(() => {
          this.stockLoading = false;
          this.refreshUi();
        })
      )
      .subscribe({
        next: product => {
          this.currentQtyOnHand = Number(product.qtyOnHand ?? 0);
          this.currentQtyAvailable = Number(product.qtyAvailable ?? 0);
          this.updateProjectedStock();
          this.refreshUi();
        },
        error: () => {
          this.currentQtyOnHand = 0;
          this.currentQtyAvailable = 0;
          this.projectedQtyOnHand = 0;
          this.projectedQtyAvailable = 0;
          this.errorMessage = 'Unable to refresh current stock for the selected item and location.';
          this.refreshUi();
        }
      });
  }

  private updateProjectedStock(): void {
    const quantity = Number(this.form.get('quantity')?.value ?? 0);
    const safeQuantity = Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
    this.projectedQtyOnHand = this.currentQtyOnHand + safeQuantity;
    this.projectedQtyAvailable = this.currentQtyAvailable + safeQuantity;
  }

  private extractErrorMessage(error: unknown, fallback: string, timeoutMessage?: string): string {
    if (
      typeof error === 'object' &&
      error !== null &&
      'name' in error &&
      (error as { name: string }).name === 'TimeoutError'
    ) {
      return timeoutMessage ?? 'Request timed out while loading products and locations. Check API and database.';
    }

    if (!(error instanceof HttpErrorResponse)) {
      return fallback;
    }

    const payload = (error.error || {}) as { message?: string };
    if (typeof payload.message === 'string' && payload.message.trim()) {
      return payload.message;
    }

    if (error.status === 403) {
      return 'Only admin accounts can receive stock into inventory.';
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
