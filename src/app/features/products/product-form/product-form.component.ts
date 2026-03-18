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
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Subscription, finalize, forkJoin, of, retry, switchMap, timeout } from 'rxjs';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { ProductService } from '../../../core/services/product.service';
import { ProductCreateInput, ProductUpdateInput } from '../../../shared/models/product.model';
import { CategoryService } from '../../../core/services/category.service';
import { Category } from '../../../shared/models/category.model';
import { InventoryLocation, InventoryService } from '../../../core/services/inventory.service';

interface ProductFormCompletedEvent {
  mode: 'create' | 'edit';
  productName: string;
}

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
export class ProductFormComponent implements OnInit, OnChanges, OnDestroy {
  private static readonly LOAD_TIMEOUT_MS = 8000;
  readonly unitOptions = ['Box', 'Pieces', 'Packs'] as const;
  private loadSub?: Subscription;
  private currentLoadId = 0;
  private initialized = false;
  private destroyed = false;

  @Input() embeddedMode = false;
  @Input() editProductId: number | null = null;
  @Input() reloadToken = 0;
  @Input() showEmbeddedCancel = false;
  @Input() drawerMode = false;
  @Output() formCompleted = new EventEmitter<ProductFormCompletedEvent>();
  @Output() cancelRequested = new EventEmitter<void>();

  isEditMode = false;
  productId: number | null = null;
  loading = false;
  loadingMessage = 'Loading inventory item details...';
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
    private inventoryService: InventoryService,
    private cdr: ChangeDetectorRef
  ) {
    this.form = this.fb.group({
      sku: ['', [Validators.required, Validators.minLength(2)]],
      name: ['', [Validators.required, Validators.minLength(2)]],
      categoryId: [null, [Validators.required]],
      description: [''],
      unit: ['Box', [Validators.required]],
      price: [0, [Validators.required, Validators.min(0)]],
      reorderLevel: [0, [Validators.required, Validators.min(0)]],
      controlled: ['false', [Validators.required]],
      initialQuantity: [0, [Validators.min(0)]],
      locationId: [null]
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

    if (changes['editProductId'] || changes['reloadToken']) {
      this.runLoad('input-change');
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.loadSub?.unsubscribe();
  }

  retryLoadFormData(): void {
    this.runLoad('retry');
  }

  requestCancel(): void {
    this.cancelRequested.emit();
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
    const unit = this.normalizeUnit(raw.unit);

    if (!categoryId || !raw.sku || !raw.name) {
      this.errorMessage = 'Please complete required fields.';
      return;
    }

    if (!this.unitOptions.includes(unit)) {
      this.errorMessage = 'Unit must be Box, Pieces, or Packs.';
      return;
    }

    this.saving = true;
    this.errorMessage = '';
    this.refreshUi();

    if (this.isEditMode && this.productId !== null) {
      const updatePayload: ProductUpdateInput = {
        categoryId,
        sku: String(raw.sku),
        name: String(raw.name),
        description: String(raw.description ?? ''),
        unit,
        price: Number(raw.price),
        reorderLevel: Number(raw.reorderLevel),
        controlled,
        isActive: true
      };

      this.productService
        .update(this.productId, updatePayload)
        .pipe(
          finalize(() => {
            this.saving = false;
            this.refreshUi();
          })
        )
        .subscribe({
          next: () => this.handleSaveSuccess(),
          error: (error: unknown) => {
            this.errorMessage = this.extractSaveErrorMessage(
              error,
              'Failed to update inventory item. Check API and permissions.'
            );
            this.refreshUi();
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
      unit,
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
      .pipe(
        finalize(() => {
          this.saving = false;
          this.refreshUi();
        })
      )
      .subscribe({
        next: () => this.handleSaveSuccess(),
        error: (error: unknown) => {
          this.errorMessage = this.extractSaveErrorMessage(
            error,
            'Failed to create inventory item. Check API and permissions.'
          );
          this.refreshUi();
        }
      });
  }

  private runLoad(reason: 'init' | 'input-change' | 'retry'): void {
    this.syncProductContext();
    this.loadSub?.unsubscribe();
    const loadId = ++this.currentLoadId;

    this.loading = true;
    this.loadingMessage =
      reason === 'retry'
        ? 'Connection issue. Retrying inventory item details...'
        : 'Loading inventory item details...';
    this.errorMessage = '';
    this.refreshUi();

    const references$ = forkJoin({
      categories: this.categoryService.getAll(),
      locations: this.inventoryService.getLocations()
    }).pipe(
      timeout(ProductFormComponent.LOAD_TIMEOUT_MS),
      retry({ count: 1, delay: 250 })
    );

    this.loadSub = references$
      .pipe(
        switchMap(({ categories, locations }) => {
          if (loadId !== this.currentLoadId) {
            return of(null);
          }

          this.categories = categories.filter(category => category.isActive);
          this.locations = locations.filter(location => location.isActive);

          if (this.locations.length > 0 && !this.form.value.locationId) {
            this.form.patchValue({ locationId: this.locations[0].id });
          }

          if (!this.isEditMode || this.productId === null) {
            return of(null);
          }

          return this.productService
            .getById(this.productId)
            .pipe(timeout(ProductFormComponent.LOAD_TIMEOUT_MS), retry({ count: 1, delay: 250 }));
        }),
        finalize(() => {
          if (loadId !== this.currentLoadId) {
            return;
          }

          this.loading = false;
          this.loadingMessage = 'Loading inventory item details...';
          this.refreshUi();
        })
      )
      .subscribe({
        next: product => {
          if (loadId !== this.currentLoadId) {
            return;
          }

          if (!product) {
            this.refreshUi();
            return;
          }

          this.form.patchValue({
            sku: product.sku,
            name: product.name,
            categoryId: product.categoryId,
            description: product.description,
            unit: this.normalizeUnit(product.unit),
            price: product.price,
            reorderLevel: product.reorderLevel,
            controlled: product.controlled ? 'true' : 'false',
            initialQuantity: 0
          });
          this.refreshUi();
        },
        error: (error: unknown) => {
          if (loadId !== this.currentLoadId) {
            return;
          }

          if (
            typeof error === 'object' &&
            error !== null &&
            'name' in error &&
            (error as { name: string }).name === 'TimeoutError'
          ) {
            this.errorMessage = 'Unable to load inventory item details. Please retry.';
          } else {
            this.errorMessage = 'Unable to load inventory item details. Please retry.';
          }
          this.refreshUi();
        }
      });
  }

  private syncProductContext(): void {
    const routeIdParam = this.route.snapshot.paramMap.get('id');
    const routeId = routeIdParam !== null ? Number(routeIdParam) : null;
    const routeResolvedId = routeId !== null && !Number.isNaN(routeId) ? routeId : null;
    const resolvedId = this.editProductId ?? routeResolvedId;

    if (resolvedId !== null && resolvedId > 0) {
      this.isEditMode = true;
      this.productId = resolvedId;
      return;
    }

    this.isEditMode = false;
    this.productId = null;
  }

  private refreshUi(): void {
    if (this.destroyed) {
      return;
    }

    try {
      this.cdr.detectChanges();
    } catch {
      // No-op: component can be mid-destroy during fast section switches.
    }
  }

  private handleSaveSuccess(): void {
    const productName = String(this.form.get('name')?.value ?? '').trim();

    if (this.embeddedMode) {
      this.formCompleted.emit({
        mode: this.isEditMode ? 'edit' : 'create',
        productName
      });

      if (!this.isEditMode) {
        this.form.reset({
          sku: '',
          name: '',
          categoryId: null,
          description: '',
          unit: 'Box',
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

  private extractSaveErrorMessage(error: unknown, fallback: string): string {
    if (!(error instanceof HttpErrorResponse)) {
      return fallback;
    }

    const payload = (error.error || {}) as { message?: string };
    if (typeof payload.message === 'string' && payload.message.trim()) {
      return payload.message;
    }

    if (error.status === 403) {
      return 'Your account does not have permission to save this inventory item.';
    }

    return fallback;
  }

  private normalizeUnit(value: unknown): 'Box' | 'Pieces' | 'Packs' {
    const normalized = String(value ?? '')
      .trim()
      .toLowerCase();

    switch (normalized) {
      case 'box':
        return 'Box';
      case 'piece':
      case 'pieces':
        return 'Pieces';
      case 'pack':
      case 'packs':
        return 'Packs';
      default:
        return 'Box';
    }
  }
}
