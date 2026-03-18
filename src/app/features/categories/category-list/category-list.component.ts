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
          <p>
            {{
              canManage
                ? 'Configure hospital storage groups, departments, and item classifications.'
                : 'Review hospital storage groups, departments, and item classifications.'
            }}
          </p>
        </div>
        <button *ngIf="embeddedMode && canManage" mat-flat-button color="primary" type="button" (click)="requestCreate()">
          Add Category
        </button>
        <button *ngIf="!embeddedMode && canManage" mat-flat-button color="primary" routerLink="/categories/new">Add Category</button>
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
        <div class="state-panel" *ngIf="loading || errorMessage">
          <div class="state" *ngIf="loading">{{ loadingMessage }}</div>
          <div class="state error" *ngIf="!loading && errorMessage">{{ errorMessage }}</div>
          <button mat-stroked-button type="button" class="retry-btn" (click)="loadCategories()" [disabled]="loading">
            Retry
          </button>
        </div>

        <div class="table-wrap" *ngIf="!loading && !errorMessage">
          <table class="categories-table" *ngIf="filteredCategories.length > 0; else emptyState">
            <thead>
              <tr>
                <th>Name</th>
                <th>Description</th>
                <th *ngIf="canManage" class="actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let category of filteredCategories; trackBy: trackByCategoryId">
                <td>{{ category.name }}</td>
                <td>{{ category.description }}</td>
                <td *ngIf="canManage" class="actions">
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

      .state-panel {
        padding: 8px 12px;
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
      }

      .state-panel .state {
        padding: 0;
      }

      .retry-btn {
        min-width: auto;
        height: 30px;
        padding: 0 10px;
        font-size: 0.75rem;
        line-height: 1;
      }
    `
  ]
})
export class CategoryListComponent implements OnInit, OnChanges, OnDestroy {
  private static readonly LOAD_TIMEOUT_MS = 8000;
  private loadSub?: Subscription;
  private currentLoadId = 0;
  private initialized = false;
  private destroyed = false;
  private autoRetryUsed = false;

  @Input() embeddedMode = false;
  @Input() reloadToken = 0;
  @Input() canManage = true;
  @Output() createRequested = new EventEmitter<void>();
  @Output() editRequested = new EventEmitter<number>();

  categories: Category[] = [];
  filteredCategories: Category[] = [];
  loading = false;
  loadingMessage = 'Loading categories...';
  errorMessage = '';
  searchTerm = '';

  constructor(
    private categoryService: CategoryService,
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

  loadCategories(): void {
    this.runLoad('retry');
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
    if (!this.canManage) {
      return;
    }

    this.createRequested.emit();
  }

  requestEdit(categoryId: number): void {
    if (!this.canManage) {
      return;
    }

    this.editRequested.emit(categoryId);
  }

  deleteCategory(category: Category): void {
    if (!this.canManage) {
      return;
    }

    const confirmed = confirm(`Delete category "${category.name}"?`);
    if (!confirmed) {
      return;
    }

    this.categoryService.delete(category.id).subscribe({
      next: () => {
        this.runLoad('input-change');
      },
      error: () => {
        this.errorMessage = 'Failed to delete category.';
        this.refreshUi();
      }
    });
  }

  trackByCategoryId(_: number, category: Category): number {
    return category.id;
  }

  private runLoad(reason: 'init' | 'input-change' | 'retry'): void {
    this.loadSub?.unsubscribe();
    const loadId = ++this.currentLoadId;

    this.autoRetryUsed = false;
    this.loading = true;
    this.loadingMessage = reason === 'retry' ? 'Connection issue. Retrying categories...' : 'Loading categories...';
    this.errorMessage = '';
    this.refreshUi();

    this.loadSub = this.categoryService
      .getAll()
      .pipe(
        timeout(CategoryListComponent.LOAD_TIMEOUT_MS),
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
          this.loadingMessage = 'Loading categories...';
          this.refreshUi();
        })
      )
      .subscribe({
        next: categories => {
          if (loadId !== this.currentLoadId) {
            return;
          }

          this.categories = categories;
          this.applyFilter();
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
            this.errorMessage = 'Unable to load categories. Please retry.';
            this.refreshUi();
            return;
          }

          this.errorMessage = this.autoRetryUsed
            ? 'Unable to load categories after retry. Please retry.'
            : 'Unable to load categories. Please retry.';
          this.refreshUi();
        }
      });
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
