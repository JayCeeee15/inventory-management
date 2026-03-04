import { Component, Input, OnInit } from '@angular/core';
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
import { finalize, forkJoin } from 'rxjs';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { Product } from '../../../shared/models/product.model';
import { ProductService } from '../../../core/services/product.service';
import {
  InventoryLocation,
  InventoryService,
  InventoryTransactionItemInput
} from '../../../core/services/inventory.service';

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
export class WalkInSaleComponent implements OnInit {
  @Input() embeddedMode = false;

  loading = false;
  submitting = false;
  errorMessage = '';
  successMessage = '';

  products: Product[] = [];
  locations: InventoryLocation[] = [];

  form: FormGroup;

  constructor(
    private fb: FormBuilder,
    private productService: ProductService,
    private inventoryService: InventoryService
  ) {
    this.form = this.fb.group({
      patientName: [''],
      patientId: [''],
      notes: [''],
      items: this.fb.array([])
    });
  }

  ngOnInit(): void {
    this.loadReferenceData();
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
      return;
    }

    const lineItems = this.toTransactionItems(this.items.controls);
    if (lineItems.length === 0) {
      this.errorMessage = 'At least one valid item is required.';
      return;
    }

    this.submitting = true;
    this.errorMessage = '';
    this.successMessage = '';

    const raw = this.form.getRawValue();
    this.inventoryService
      .createWalkInSale({
        patientName: String(raw.patientName || ''),
        patientId: String(raw.patientId || ''),
        notes: String(raw.notes || ''),
        items: lineItems
      })
      .pipe(finalize(() => (this.submitting = false)))
      .subscribe({
        next: result => {
          this.successMessage = `Walk-in sale posted successfully. Reference: ${result.saleNo}`;
          this.resetForm();
        },
        error: (error: unknown) => {
          this.errorMessage = this.extractErrorMessage(error, 'Failed to post walk-in sale.');
        }
      });
  }

  private loadReferenceData(): void {
    this.loading = true;
    this.errorMessage = '';

    forkJoin({
      products: this.productService.getAll({ limit: 250 }),
      locations: this.inventoryService.getLocations()
    })
      .pipe(finalize(() => (this.loading = false)))
      .subscribe({
        next: ({ products, locations }) => {
          this.products = products.filter(product => product.isActive);
          this.locations = locations.filter(location => location.isActive);
          this.resetItemRows();
        },
        error: (error: unknown) => {
          this.errorMessage = this.extractErrorMessage(error, 'Failed to load transaction references.');
          this.resetItemRows();
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
