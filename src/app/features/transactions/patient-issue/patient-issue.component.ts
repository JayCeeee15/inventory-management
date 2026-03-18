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
import { Subscription, finalize, timeout } from 'rxjs';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { Product } from '../../../shared/models/product.model';
import {
  InventoryLocation,
  PatientIssueResult,
  InventoryService,
  InventoryTransactionItemInput
} from '../../../core/services/inventory.service';
import { TransactionReferenceService } from '../../../core/services/transaction-reference.service';

@Component({
  selector: 'app-patient-issue',
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
  templateUrl: './patient-issue.component.html',
  styleUrls: ['./patient-issue.component.css']
})
export class PatientIssueComponent implements OnInit, OnChanges, OnDestroy {
  private loadSub?: Subscription;
  private currentLoadId = 0;
  private initialized = false;
  private destroyed = false;

  @Input() embeddedMode = false;
  @Input() reloadToken = 0;
  @Output() issuePosted = new EventEmitter<PatientIssueResult>();

  loading = false;
  loadingMessage = 'Loading products and locations...';
  submitting = false;
  errorMessage = '';
  successMessage = '';

  products: Product[] = [];
  locations: InventoryLocation[] = [];

  form: FormGroup;

  constructor(
    private fb: FormBuilder,
    private inventoryService: InventoryService,
    private transactionReferenceService: TransactionReferenceService,
    private cdr: ChangeDetectorRef
  ) {
    this.form = this.fb.group({
      patientName: ['', [Validators.required, Validators.minLength(2)]],
      patientId: [''],
      department: ['', [Validators.required]],
      notes: [''],
      items: this.fb.array([])
    });
  }

  ngOnInit(): void {
    this.initialized = true;
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
  }

  get items(): FormArray<FormGroup> {
    return this.form.get('items') as FormArray<FormGroup>;
  }

  addItem(): void {
    this.items.push(this.createItemGroup(this.products[0]?.id ?? null, this.locations[0]?.id ?? null));
  }

  removeItem(index: number): void {
    if (this.items.length <= 1) {
      return;
    }
    this.items.removeAt(index);
  }

  retryReferenceData(): void {
    this.runLoad('retry');
  }

  getAvailableStock(index: number): number {
    const control = this.items.at(index);
    const productId = Number(control?.get('productId')?.value ?? 0);
    if (!productId) {
      return 0;
    }
    const product = this.products.find(entry => entry.id === productId);
    return product?.qtyAvailable ?? 0;
  }

  onSubmit(): void {
    if (this.form.invalid || this.submitting) {
      this.form.markAllAsTouched();
      this.refreshUi();
      return;
    }

    const lineItems = this.toTransactionItems(this.items.controls);
    if (lineItems.length === 0) {
      this.errorMessage = 'At least one valid item is required.';
      this.refreshUi();
      return;
    }

    this.submitting = true;
    this.errorMessage = '';
    this.successMessage = '';
    this.refreshUi();

    const raw = this.form.getRawValue();
    this.inventoryService
      .createPatientIssue({
        patientName: String(raw.patientName || ''),
        patientId: String(raw.patientId || ''),
        department: String(raw.department || ''),
        notes: String(raw.notes || ''),
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
          this.successMessage = `Saved successfully. Patient issue posted. Reference: ${result.issueNo}`;
          this.resetForm();
          this.issuePosted.emit(result);
          this.runLoad('input-change', true);
          this.refreshUi();
        },
        error: (error: unknown) => {
          this.errorMessage = this.extractErrorMessage(
            error,
            'Failed to post patient issue.',
            'Request timed out while posting patient issue. Please retry.'
          );
          this.refreshUi();
        }
      });
  }

  private runLoad(
    reason: 'init' | 'input-change' | 'retry',
    preserveSuccessMessage = false
  ): void {
    this.loadSub?.unsubscribe();
    const loadId = ++this.currentLoadId;

    this.loading = true;
    this.loadingMessage =
      reason === 'retry'
        ? 'Connection issue. Retrying products and locations...'
        : 'Loading products and locations...';
    this.errorMessage = '';
    if (!preserveSuccessMessage) {
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
          this.resetItemRows();
          this.refreshUi();
        },
        error: (error: unknown) => {
          if (loadId !== this.currentLoadId) {
            return;
          }

          this.errorMessage = this.extractErrorMessage(error, 'Unable to load products and locations. Please retry.');
          this.resetItemRows();
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
    this.items.clear();
    this.addItem();
  }

  private resetForm(): void {
    this.form.patchValue({
      patientName: '',
      patientId: '',
      department: '',
      notes: ''
    });
    this.resetItemRows();
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

  private extractErrorMessage(error: unknown, fallback: string, timeoutMessage?: string): string {
    if (typeof error === 'object' && error !== null && 'name' in error && (error as { name: string }).name === 'TimeoutError') {
      return timeoutMessage ?? 'Request timed out while loading products and locations. Check API and database connection.';
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
