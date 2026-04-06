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
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Subscription, finalize, retry, timeout, timer } from 'rxjs';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { ProductService } from '../../../core/services/product.service';
import { Product } from '../../../shared/models/product.model';
import { ProductFormComponent } from '../product-form/product-form.component';
import { AppRefreshService } from '../../../core/services/app-refresh.service';

interface ProductEditorCompletedEvent {
  mode: 'create' | 'edit';
  productName: string;
}

@Component({
  selector: 'app-product-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    MatCardModule,
    MatButtonModule,
    MatInputModule,
    MatFormFieldModule,
    ProductFormComponent
  ],
  templateUrl: './product-list.component.html',
  styleUrls: ['./product-list.component.css']
})
export class ProductListComponent implements OnInit, OnChanges, OnDestroy {
  private static readonly LOAD_TIMEOUT_MS = 8000;
  private static readonly PAGE_SIZE = 10;
  private loadSub?: Subscription;
  private currentLoadId = 0;
  private initialized = false;
  private destroyed = false;
  private autoRetryUsed = false;

  @Input() embeddedMode = false;
  @Input() reloadToken = 0;
  @Input() useDrawerEditor = false;
  @Input() canManage = true;
  @Output() createRequested = new EventEmitter<void>();
  @Output() editRequested = new EventEmitter<number>();

  products: Product[] = [];
  filteredProducts: Product[] = [];

  searchTerm = '';
  categoryFilter = 'all';
  currentPage = 1;

  categories: string[] = [];
  loading = false;
  loadingMessage = 'Loading products...';
  errorMessage = '';
  successMessage = '';
  editorDrawerOpen = false;
  editorMode: 'create' | 'edit' = 'create';
  selectedProductId: number | null = null;
  editorReloadToken = 0;

  constructor(
    private productService: ProductService,
    private appRefreshService: AppRefreshService,
    private cdr: ChangeDetectorRef
  ) {}

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

  loadProducts(): void {
    this.runLoad('retry');
  }

  get paginatedProducts(): Product[] {
    const start = (this.currentPage - 1) * ProductListComponent.PAGE_SIZE;
    return this.filteredProducts.slice(start, start + ProductListComponent.PAGE_SIZE);
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.filteredProducts.length / ProductListComponent.PAGE_SIZE));
  }

  get startItem(): number {
    if (this.filteredProducts.length === 0) {
      return 0;
    }

    return (this.currentPage - 1) * ProductListComponent.PAGE_SIZE + 1;
  }

  get endItem(): number {
    return Math.min(this.currentPage * ProductListComponent.PAGE_SIZE, this.filteredProducts.length);
  }

  prevPage(): void {
    if (this.currentPage <= 1 || this.loading) {
      return;
    }

    this.currentPage -= 1;
  }

  nextPage(): void {
    if (this.currentPage >= this.totalPages || this.loading) {
      return;
    }

    this.currentPage += 1;
  }

  private runLoad(reason: 'init' | 'input-change' | 'retry'): void {
    this.loadSub?.unsubscribe();
    const loadId = ++this.currentLoadId;

    this.autoRetryUsed = false;
    this.loading = true;
    this.loadingMessage = reason === 'retry' ? 'Connection issue. Retrying products...' : 'Loading products...';
    this.errorMessage = '';
    this.refreshUi();

    this.loadSub = this.productService
      .getAll({ limit: 200 })
      .pipe(
        timeout(ProductListComponent.LOAD_TIMEOUT_MS),
        retry({
          count: 1,
          delay: (_error, _retryCount) => {
            if (loadId !== this.currentLoadId) {
              return timer(0);
            }
            this.autoRetryUsed = true;
            this.loadingMessage = 'Connection issue. Retrying once...';
            this.refreshUi();
            return timer(250);
          }
        }),
        finalize(() => {
          if (loadId !== this.currentLoadId) {
            return;
          }
          this.loading = false;
          this.loadingMessage = 'Loading products...';
          this.refreshUi();
        })
      )
      .subscribe({
        next: products => {
          if (loadId !== this.currentLoadId) {
            return;
          }

          this.products = products;
          this.categories = Array.from(new Set(products.map(p => p.categoryName))).sort((a, b) =>
            a.localeCompare(b)
          );
          this.applyFilters();
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
            this.errorMessage = 'Unable to load products. Please retry.';
            this.refreshUi();
            return;
          }

          this.errorMessage = this.autoRetryUsed
            ? 'Unable to load products after retry. Please retry.'
            : 'Unable to load products. Please retry.';
          this.refreshUi();
        }
      });
  }

  applyFilters(): void {
    const term = this.searchTerm.trim().toLowerCase();

    this.filteredProducts = this.products.filter(product => {
      const matchesTerm =
        !term ||
        product.name.toLowerCase().includes(term) ||
        product.sku.toLowerCase().includes(term) ||
        product.categoryName.toLowerCase().includes(term);

      const matchesCategory = this.categoryFilter === 'all' || product.categoryName === this.categoryFilter;

      return matchesTerm && matchesCategory;
    });

    if (this.currentPage > this.totalPages) {
      this.currentPage = this.totalPages;
    }
  }

  clearFilters(): void {
    this.searchTerm = '';
    this.categoryFilter = 'all';
    this.currentPage = 1;
    this.applyFilters();
  }

  requestCreate(): void {
    if (!this.canManage) {
      return;
    }

    this.successMessage = '';
    if (this.embeddedMode && this.useDrawerEditor) {
      this.openCreateDrawer();
      return;
    }

    this.createRequested.emit();
  }

  requestEdit(productId: number): void {
    if (!this.canManage) {
      return;
    }

    this.successMessage = '';
    if (this.embeddedMode && this.useDrawerEditor) {
      this.openEditDrawer(productId);
      return;
    }

    this.editRequested.emit(productId);
  }

  deleteProduct(product: Product): void {
    if (!this.canManage) {
      return;
    }

    const confirmed = confirm(`Delete inventory item "${product.name}"?`);
    if (!confirmed) {
      return;
    }

    this.productService.delete(product.id).subscribe({
      next: () => {
        this.products = this.products.filter(p => p.id !== product.id);
        this.applyFilters();
        this.successMessage = `"${product.name}" was removed.`;
        this.appRefreshService.request('product-deleted', ['dashboard', 'inventory', 'products', 'shop']);
        this.refreshUi();
      },
      error: () => {
        this.errorMessage = 'Failed to delete inventory item.';
        this.refreshUi();
      }
    });
  }

  isLowStock(product: Product): boolean {
    return product.qtyAvailable <= product.reorderLevel;
  }

  trackByProductId(_: number, product: Product): number {
    return product.id;
  }

  closeEditorDrawer(): void {
    this.editorDrawerOpen = false;
    this.editorMode = 'create';
    this.selectedProductId = null;
    this.refreshUi();
  }

  handleEditorCompleted(event?: ProductEditorCompletedEvent): void {
    const mode = event?.mode ?? this.editorMode;
    const productName = event?.productName?.trim();

    this.successMessage =
      mode === 'edit'
        ? `${productName || 'Inventory item'} saved to the database.`
        : `${productName || 'Inventory item'} created and saved to the database.`;
    this.closeEditorDrawer();
    this.runLoad('input-change');
  }

  private openCreateDrawer(): void {
    this.editorMode = 'create';
    this.selectedProductId = null;
    this.editorReloadToken++;
    this.editorDrawerOpen = true;
    this.refreshUi();
  }

  private openEditDrawer(productId: number): void {
    this.editorMode = 'edit';
    this.selectedProductId = productId;
    this.editorReloadToken++;
    this.editorDrawerOpen = true;
    this.refreshUi();
  }

  private refreshUi(): void {
    if (this.destroyed) {
      return;
    }

    try {
      this.cdr.detectChanges();
    } catch {
      // No-op: component may be unmounting while async callback completes.
    }
  }
}
