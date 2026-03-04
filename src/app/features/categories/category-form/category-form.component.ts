import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { CategoryService } from '../../../core/services/category.service';
import { CategoryFormData } from '../../../shared/models/category.model';

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
        <div class="state" *ngIf="loading">Loading category details...</div>
        <div class="state error" *ngIf="!loading && errorMessage">{{ errorMessage }}</div>

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
    `
  ]
})
export class CategoryFormComponent implements OnInit {
  @Input() embeddedMode = false;
  @Input() editCategoryId: number | null = null;
  @Output() formCompleted = new EventEmitter<void>();

  isEditMode = false;
  categoryId: number | null = null;
  loading = false;
  saving = false;
  errorMessage = '';
  form: FormGroup;

  constructor(
    private fb: FormBuilder,
    private route: ActivatedRoute,
    private router: Router,
    private categoryService: CategoryService
  ) {
    this.form = this.fb.group({
      name: ['', [Validators.required, Validators.minLength(2)]],
      description: ['', [Validators.required, Validators.minLength(4)]]
    });
  }

  ngOnInit(): void {
    const routeIdParam = this.route.snapshot.paramMap.get('id');
    const routeId = routeIdParam ? Number(routeIdParam) : null;
    const id = this.editCategoryId ?? routeId;

    if (id && !Number.isNaN(id)) {
      this.isEditMode = true;
      this.categoryId = id;
      this.loadCategory(id);
    }
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
        }
      });
  }

  private handleSaveSuccess(): void {
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

  private loadCategory(id: number): void {
    this.loading = true;
    this.errorMessage = '';

    this.categoryService
      .getById(id)
      .pipe(finalize(() => (this.loading = false)))
      .subscribe({
        next: category => {
          this.form.patchValue({
            name: category.name,
            description: category.description
          });
        },
        error: () => {
          this.errorMessage = 'Failed to load category details.';
        }
      });
  }
}
