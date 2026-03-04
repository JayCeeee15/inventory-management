import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { CategoryService } from '../../../core/services/category.service';
import { Category } from '../../../shared/models/category.model';

@Component({
  selector: 'app-category-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    MatCardModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule
  ],
  template: `
    <div class="category-page">
      <header class="page-header">
        <div>
          <h1>Location & Category Management</h1>
          <p>Configure hospital storage groups, departments, and item classifications.</p>
        </div>
        <button *ngIf="embeddedMode" mat-flat-button color="primary" type="button" (click)="requestCreate()">
          Add Category
        </button>
        <button *ngIf="!embeddedMode" mat-flat-button color="primary" routerLink="/categories/new">Add Category</button>
      </header>

      <mat-card class="filters-card">
        <mat-form-field appearance="outline" class="filter-field">
          <mat-label>Search categories</mat-label>
          <input
            matInput
            [(ngModel)]="searchTerm"
            (ngModelChange)="applyFilter()"
            placeholder="Name or description"
          />
        </mat-form-field>
      </mat-card>

      <mat-card class="table-card">
        <div class="state" *ngIf="loading">Loading categories...</div>
        <div class="state error" *ngIf="!loading && errorMessage">{{ errorMessage }}</div>

        <div class="table-wrap" *ngIf="!loading && !errorMessage">
          <table class="categories-table" *ngIf="filteredCategories.length > 0; else emptyState">
            <thead>
              <tr>
                <th>Name</th>
                <th>Description</th>
                <th class="actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let category of filteredCategories">
                <td>{{ category.name }}</td>
                <td>{{ category.description }}</td>
                <td class="actions">
                  <button
                    *ngIf="embeddedMode"
                    mat-stroked-button
                    color="primary"
                    type="button"
                    (click)="requestEdit(category.id)"
                  >
                    Edit
                  </button>
                  <button
                    *ngIf="!embeddedMode"
                    mat-stroked-button
                    color="primary"
                    [routerLink]="['/categories/edit', category.id]"
                  >
                    Edit
                  </button>
                  <button mat-stroked-button color="warn" type="button" (click)="deleteCategory(category)">Delete</button>
                </td>
              </tr>
            </tbody>
          </table>
          <ng-template #emptyState>
            <div class="state">No categories found.</div>
          </ng-template>
        </div>
      </mat-card>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .category-page {
        padding: 20px;
        background: linear-gradient(180deg, #fffefe 0%, #fff4f6 100%);
        min-height: 100vh;
      }

      .page-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 16px;
        margin-bottom: 12px;
      }

      .page-header h1 {
        margin: 0;
        color: #61111d;
      }

      .page-header p {
        margin: 4px 0 0;
        color: #7a3b44;
      }

      .filters-card {
        margin-bottom: 12px;
        padding: 12px;
        border: 1px solid #f0c4cb;
      }

      .filter-field {
        width: min(100%, 360px);
      }

      .table-card {
        padding: 12px;
        border: 1px solid #f0c4cb;
      }

      .table-wrap {
        overflow-x: auto;
      }

      .categories-table {
        width: 100%;
        border-collapse: collapse;
      }

      .categories-table th,
      .categories-table td {
        text-align: left;
        padding: 10px;
        border-bottom: 1px solid #f0c4cb;
      }

      .actions {
        width: 220px;
        white-space: nowrap;
      }

      .actions button {
        margin-right: 8px;
      }

      .state {
        padding: 12px;
        color: #7a3b44;
      }

      .error {
        color: #b91c1c;
      }
    `
  ]
})
export class CategoryListComponent implements OnInit {
  @Input() embeddedMode = false;
  @Output() createRequested = new EventEmitter<void>();
  @Output() editRequested = new EventEmitter<number>();

  categories: Category[] = [];
  filteredCategories: Category[] = [];
  loading = false;
  errorMessage = '';
  searchTerm = '';

  constructor(private categoryService: CategoryService) {}

  ngOnInit(): void {
    this.loadCategories();
  }

  loadCategories(): void {
    this.loading = true;
    this.errorMessage = '';

    this.categoryService
      .getAll()
      .pipe(finalize(() => (this.loading = false)))
      .subscribe({
        next: categories => {
          this.categories = categories;
          this.applyFilter();
        },
        error: () => {
          this.errorMessage = 'Failed to load categories.';
        }
      });
  }

  applyFilter(): void {
    const term = this.searchTerm.trim().toLowerCase();
    this.filteredCategories = this.categories.filter(category => {
      if (!term) {
        return true;
      }

      return (
        category.name.toLowerCase().includes(term) ||
        category.description.toLowerCase().includes(term)
      );
    });
  }

  requestCreate(): void {
    this.createRequested.emit();
  }

  requestEdit(categoryId: number): void {
    this.editRequested.emit(categoryId);
  }

  deleteCategory(category: Category): void {
    const confirmed = confirm(`Delete category "${category.name}"?`);
    if (!confirmed) {
      return;
    }

    this.categoryService.delete(category.id).subscribe({
      next: () => {
        this.categories = this.categories.filter(c => c.id !== category.id);
        this.applyFilter();
      },
      error: () => {
        this.errorMessage = 'Failed to delete category.';
      }
    });
  }
}
