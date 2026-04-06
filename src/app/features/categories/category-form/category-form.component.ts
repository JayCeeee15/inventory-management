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
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Subscription, finalize, retry, timeout, timer } from 'rxjs';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { CategoryService } from '../../../core/services/category.service';
import { CategoryFormData } from '../../../shared/models/category.model';
import { AppRefreshService } from '../../../core/services/app-refresh.service';

@Component({
  selector: 'app-category-form',
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
  template: `
    <div class="category-form-page">
      <header class="form-header">
        <div>
          <h1>{{ isEditMode ? 'Edit Category' : 'Add Category' }}</h1>
          <p>{{ isEditMode ? 'Update category details.' : 'Create category for hospital inventory routing.' }}</p>
        </div>
        <button *ngIf="!embeddedMode" mat-stroked-button routerLink="/categories">Back to Categories</button>
      </header>

      <mat-card class="form-card">
        <div class="state-panel" *ngIf="loading || errorMessage">
          <div class="state" *ngIf="loading">{{ loadingMessage }}</div>
          <div class="state error" *ngIf="!loading && errorMessage">{{ errorMessage }}</div>
          <button mat-stroked-button type="button" class="retry-btn" (click)="retryLoadCategory()" [disabled]="loading">
            Retry
          </button>
        </div>

        <form *ngIf="!loading" [formGroup]="form" (ngSubmit)="onSubmit()" class="category-form">
          <mat-form-field appearance="outline">
            <mat-label>Category Name</mat-label>
            <input matInput formControlName="name" />
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Description</mat-label>
            <textarea matInput rows="4" formControlName="description"></textarea>
          </mat-form-field>

          <div class="form-actions">
            <button *ngIf="!embeddedMode" mat-stroked-button type="button" routerLink="/categories">Cancel</button>
            <button mat-flat-button color="primary" type="submit" [disabled]="form.invalid || saving">
              {{ saving ? 'Saving...' : isEditMode ? 'Update Category' : 'Create Category' }}
            </button>
          </div>
        </form>
      </mat-card>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .category-form-page {
        padding: 20px;
        background: linear-gradient(180deg, #fffefe 0%, #fff4f6 100%);
        min-height: 100vh;
      }

      .form-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 16px;
        margin-bottom: 12px;
      }

      .form-header h1 {
        margin: 0;
        color: #61111d;
      }

      .form-header p {
        margin: 4px 0 0;
        color: #7a3b44;
      }

      .form-card {
        padding: 12px;
        border: 1px solid #f0c4cb;
        box-shadow: 0 10px 24px rgba(127, 29, 45, 0.09);
      }

      .category-form {
        display: grid;
        gap: 12px;
      }

      .form-actions {
        display: flex;
        justify-content: flex-end;
        gap: 10px;
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
export class CategoryFormComponent implements OnInit, OnChanges, OnDestroy {
  private static readonly LOAD_TIMEOUT_MS = 8000;
  private loadSub?: Subscription;
  private currentLoadId = 0;
  private initialized = false;
  private destroyed = false;

  @Input() embeddedMode = false;
  @Input() editCategoryId: number | null = null;
  @Input() reloadToken = 0;
  @Output() formCompleted = new EventEmitter<void>();

  isEditMode = false;
  categoryId: number | null = null;
  loading = false;
  loadingMessage = 'Loading category details...';
  saving = false;
  errorMessage = '';
  form: FormGroup;

  constructor(
    private fb: FormBuilder,
    private route: ActivatedRoute,
    private router: Router,
    private categoryService: CategoryService,
    private appRefreshService: AppRefreshService,
    private cdr: ChangeDetectorRef
  ) {
    this.form = this.fb.group({
      name: ['', [Validators.required, Validators.minLength(2)]],
      description: ['', [Validators.required, Validators.minLength(4)]]
    });
  }

  ngOnInit(): void {
    this.initialized = true;
    this.syncCategoryContext();
    if (this.isEditMode && this.categoryId !== null) {
      this.runLoad('init');
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.initialized) {
      return;
    }

    if (changes['editCategoryId'] || changes['reloadToken']) {
      this.syncCategoryContext();
      if (this.isEditMode && this.categoryId !== null) {
        this.runLoad('input-change');
      } else if (changes['reloadToken']) {
        this.errorMessage = '';
        this.form.reset({
          name: '',
          description: ''
        });
        this.refreshUi();
      }
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.loadSub?.unsubscribe();
  }

  retryLoadCategory(): void {
    if (this.categoryId === null) {
      return;
    }

    this.runLoad('retry');
  }

  onSubmit(): void {
    if (this.form.invalid || this.saving) {
      this.form.markAllAsTouched();
      return;
    }

    const raw = this.form.getRawValue();
    if (!raw.name || !raw.description) {
      return;
    }

    this.saving = true;
    this.errorMessage = '';

    const payload: CategoryFormData = {
      name: raw.name.trim(),
      description: raw.description.trim()
    };

    if (this.isEditMode && this.categoryId !== null) {
      this.categoryService
        .update(this.categoryId, payload)
        .pipe(finalize(() => (this.saving = false)))
        .subscribe({
          next: () => this.handleSaveSuccess(),
          error: () => {
            this.errorMessage = 'Failed to update category.';
            this.refreshUi();
          }
        });
      return;
    }

    this.categoryService
      .create(payload)
      .pipe(finalize(() => (this.saving = false)))
      .subscribe({
        next: () => this.handleSaveSuccess(),
        error: () => {
          this.errorMessage = 'Failed to create category.';
          this.refreshUi();
        }
      });
  }

  private runLoad(reason: 'init' | 'input-change' | 'retry'): void {
    if (!this.isEditMode || this.categoryId === null) {
      this.loading = false;
      this.loadingMessage = 'Loading category details...';
      this.errorMessage = '';
      this.refreshUi();
      return;
    }

    this.loadSub?.unsubscribe();
    const loadId = ++this.currentLoadId;

    this.loading = true;
    this.loadingMessage =
      reason === 'retry' ? 'Connection issue. Retrying category details...' : 'Loading category details...';
    this.errorMessage = '';
    this.refreshUi();

    this.loadSub = this.categoryService
      .getById(this.categoryId)
      .pipe(
        timeout(CategoryFormComponent.LOAD_TIMEOUT_MS),
        retry({
          count: 1,
          delay: () => {
            if (loadId !== this.currentLoadId) {
              return timer(0);
            }
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
          this.loadingMessage = 'Loading category details...';
          this.refreshUi();
        })
      )
      .subscribe({
        next: category => {
          if (loadId !== this.currentLoadId) {
            return;
          }
          this.form.patchValue({
            name: category.name,
            description: category.description
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
            this.errorMessage = 'Unable to load category details. Please retry.';
          } else {
            this.errorMessage = 'Failed to load category details.';
          }
          this.refreshUi();
        }
      });
  }

  private syncCategoryContext(): void {
    const routeIdParam = this.route.snapshot.paramMap.get('id');
    const routeId = routeIdParam ? Number(routeIdParam) : null;
    const normalizedRouteId = routeId !== null && !Number.isNaN(routeId) ? routeId : null;
    const id = this.editCategoryId ?? normalizedRouteId;

    if (id === null || id <= 0) {
      this.isEditMode = false;
      this.categoryId = null;
      return;
    }

    this.isEditMode = true;
    this.categoryId = id;
  }

  private handleSaveSuccess(): void {
    this.appRefreshService.request(
      this.isEditMode ? 'category-updated' : 'category-created',
      ['dashboard', 'categories', 'products', 'shop']
    );

    if (this.embeddedMode) {
      this.formCompleted.emit();

      if (!this.isEditMode) {
        this.form.reset({
          name: '',
          description: ''
        });
      }

      return;
    }

    this.router.navigate(['/categories']);
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
