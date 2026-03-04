import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { ProductService } from '../../../core/services/product.service';
import { Product } from '../../../shared/models/product.model';

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
    MatFormFieldModule
  ],
  templateUrl: './product-list.component.html',
  styleUrls: ['./product-list.component.css']
})
export class ProductListComponent implements OnInit {
  @Input() embeddedMode = false;
  @Output() createRequested = new EventEmitter<void>();
  @Output() editRequested = new EventEmitter<number>();

  products: Product[] = [];
  filteredProducts: Product[] = [];

  searchTerm = '';
  categoryFilter = 'all';

  categories: string[] = [];
  loading = false;
  errorMessage = '';

  constructor(private productService: ProductService) {}

  ngOnInit(): void {
    this.loadProducts();
  }

  loadProducts(): void {
    this.loading = true;
    this.errorMessage = '';

    this.productService
      .getAll({ limit: 200 })
      .pipe(finalize(() => (this.loading = false)))
      .subscribe({
        next: products => {
          this.products = products;
          this.categories = Array.from(new Set(products.map(p => p.categoryName))).sort((a, b) =>
            a.localeCompare(b)
          );
          this.applyFilters();
        },
        error: () => {
          this.errorMessage = 'Failed to load inventory items. Please make sure API server is running.';
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
  }

  clearFilters(): void {
    this.searchTerm = '';
    this.categoryFilter = 'all';
    this.applyFilters();
  }

  requestCreate(): void {
    this.createRequested.emit();
  }

  requestEdit(productId: number): void {
    this.editRequested.emit(productId);
  }

  deleteProduct(product: Product): void {
    const confirmed = confirm(`Delete inventory item "${product.name}"?`);
    if (!confirmed) {
      return;
    }

    this.productService.delete(product.id).subscribe({
      next: () => {
        this.products = this.products.filter(p => p.id !== product.id);
        this.applyFilters();
      },
      error: () => {
        this.errorMessage = 'Failed to delete inventory item.';
      }
    });
  }

  isLowStock(product: Product): boolean {
    return product.qtyAvailable <= product.reorderLevel;
  }

  trackByProductId(_: number, product: Product): number {
    return product.id;
  }
}
