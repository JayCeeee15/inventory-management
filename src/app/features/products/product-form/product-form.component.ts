import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize, forkJoin, of, switchMap } from 'rxjs';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { ProductService } from '../../../core/services/product.service';
import { ProductCreateInput, ProductUpdateInput } from '../../../shared/models/product.model';
import { CategoryService } from '../../../core/services/category.service';
import { Category } from '../../../shared/models/category.model';
import { InventoryLocation, InventoryService } from '../../../core/services/inventory.service';

@Component({
  selector: 'app-product-form',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    ReactiveFormsModule,
    MatCardModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule
  ],
  templateUrl: './product-form.component.html',
  styleUrls: ['./product-form.component.css']
})
export class ProductFormComponent implements OnInit {
  @Input() embeddedMode = false;
  @Input() editProductId: number | null = null;
  @Output() formCompleted = new EventEmitter<void>();

  isEditMode = false;
  productId: number | null = null;
  loading = false;
  saving = false;
  errorMessage = '';

  categories: Category[] = [];
  locations: InventoryLocation[] = [];

  form: FormGroup;

  constructor(
    private fb: FormBuilder,
    private route: ActivatedRoute,
    private router: Router,
    private productService: ProductService,
    private categoryService: CategoryService,
    private inventoryService: InventoryService
  ) {
    this.form = this.fb.group({
      sku: ['', [Validators.required, Validators.minLength(2)]],
      name: ['', [Validators.required, Validators.minLength(2)]],
      categoryId: [null, [Validators.required]],
      description: [''],
      unit: ['unit', [Validators.required]],
      price: [0, [Validators.required, Validators.min(0)]],
      reorderLevel: [0, [Validators.required, Validators.min(0)]],
      controlled: ['false', [Validators.required]],
      initialQuantity: [0, [Validators.min(0)]],
      locationId: [null]
    });
  }

  ngOnInit(): void {
    const routeIdParam = this.route.snapshot.paramMap.get('id');
    const routeId = routeIdParam ? Number(routeIdParam) : null;
    const id = this.editProductId ?? routeId;

    if (id && !Number.isNaN(id)) {
      this.isEditMode = true;
      this.productId = id;
    }

    this.loadFormData();
  }

  onSubmit(): void {
    if (this.form.invalid || this.saving) {
      this.form.markAllAsTouched();
      return;
    }

    const raw = this.form.getRawValue();
    const controlled = String(raw.controlled) === 'true';
    const initialQuantity = Number(raw.initialQuantity ?? 0);
    const categoryId = Number(raw.categoryId ?? 0);
    const locationId = raw.locationId ? Number(raw.locationId) : null;

    if (!categoryId || !raw.sku || !raw.name || !raw.unit) {
      this.errorMessage = 'Please complete required fields.';
      return;
    }

    this.saving = true;
    this.errorMessage = '';

    if (this.isEditMode && this.productId !== null) {
      const updatePayload: ProductUpdateInput = {
        categoryId,
        sku: String(raw.sku),
        name: String(raw.name),
        description: String(raw.description ?? ''),
        unit: String(raw.unit),
        price: Number(raw.price),
        reorderLevel: Number(raw.reorderLevel),
        controlled,
        isActive: true
      };

      this.productService
        .update(this.productId, updatePayload)
        .pipe(finalize(() => (this.saving = false)))
        .subscribe({
          next: () => this.handleSaveSuccess(),
          error: () => {
            this.errorMessage = 'Failed to update inventory item. Check API and permissions.';
          }
        });
      return;
    }

    if (initialQuantity > 0 && !locationId) {
      this.saving = false;
      this.errorMessage = 'Select a location when setting initial quantity.';
      return;
    }

    const createPayload: ProductCreateInput = {
      categoryId,
      sku: String(raw.sku),
      name: String(raw.name),
      description: String(raw.description ?? ''),
      unit: String(raw.unit),
      price: Number(raw.price),
      reorderLevel: Number(raw.reorderLevel),
      controlled,
      initialStocks:
        initialQuantity > 0 && locationId
          ? [
              {
                locationId,
                quantity: initialQuantity,
                unitCost: Number(raw.price)
              }
            ]
          : []
    };

    this.productService
      .create(createPayload)
      .pipe(finalize(() => (this.saving = false)))
      .subscribe({
        next: () => this.handleSaveSuccess(),
        error: () => {
          this.errorMessage = 'Failed to create inventory item. Check API and permissions.';
        }
      });
  }

  private loadFormData(): void {
    this.loading = true;
    this.errorMessage = '';

    forkJoin({
      categories: this.categoryService.getAll(),
      locations: this.inventoryService.getLocations()
    })
      .pipe(
        switchMap(({ categories, locations }) => {
          this.categories = categories.filter(category => category.isActive);
          this.locations = locations.filter(location => location.isActive);

          if (this.locations.length > 0 && !this.form.value.locationId) {
            this.form.patchValue({ locationId: this.locations[0].id });
          }

          if (!this.isEditMode || this.productId === null) {
            return of(null);
          }

          return this.productService.getById(this.productId);
        }),
        finalize(() => (this.loading = false))
      )
      .subscribe({
        next: product => {
          if (!product) {
            return;
          }

          this.form.patchValue({
            sku: product.sku,
            name: product.name,
            categoryId: product.categoryId,
            description: product.description,
            unit: product.unit,
            price: product.price,
            reorderLevel: product.reorderLevel,
            controlled: product.controlled ? 'true' : 'false',
            initialQuantity: 0
          });
        },
        error: () => {
          this.errorMessage = 'Failed to load product form data.';
        }
      });
  }

  private handleSaveSuccess(): void {
    if (this.embeddedMode) {
      this.formCompleted.emit();

      if (!this.isEditMode) {
        this.form.reset({
          sku: '',
          name: '',
          categoryId: null,
          description: '',
          unit: 'unit',
          price: 0,
          reorderLevel: 0,
          controlled: 'false',
          initialQuantity: 0,
          locationId: this.locations[0]?.id ?? null
        });
      }

      return;
    }

    this.router.navigate(['/products']);
  }
}
