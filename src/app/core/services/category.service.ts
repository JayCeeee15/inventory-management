import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, map, tap, throwError } from 'rxjs';
import { Category, CategoryFormData } from '../../shared/models/category.model';
import { environment } from '../../../environments/environment';

interface CategoriesResponse {
  categories: unknown[];
}

interface CategoryResponse {
  category: unknown;
}

@Injectable({
  providedIn: 'root'
})
export class CategoryService {
  private readonly API_URL = `${environment.apiUrl}/inventory/categories`;

  private categoriesSignal = signal<Category[]>([]);
  public categories = this.categoriesSignal.asReadonly();

  private loadingSignal = signal<boolean>(false);
  public loading = this.loadingSignal.asReadonly();

  constructor(private http: HttpClient) {}

  getAll(includeInactive = false): Observable<Category[]> {
    this.loadingSignal.set(true);

    return this.http
      .get<CategoriesResponse>(this.API_URL, {
        params: includeInactive ? { includeInactive: 'true' } : {}
      })
      .pipe(
        map(response => (Array.isArray(response?.categories) ? response.categories.map(row => this.mapCategory(row)) : [])),
        tap(categories => {
          this.categoriesSignal.set(categories);
          this.loadingSignal.set(false);
        }),
        catchError(error => {
          this.loadingSignal.set(false);
          return throwError(() => error);
        })
      );
  }

  getById(id: number): Observable<Category> {
    return this.http.get<CategoryResponse>(`${this.API_URL}/${id}`).pipe(
      map(response => this.mapCategory(response?.category)),
      catchError(error => throwError(() => error))
    );
  }

  create(category: CategoryFormData): Observable<Category> {
    this.loadingSignal.set(true);

    return this.http
      .post<CategoryResponse>(this.API_URL, {
        name: category.name.trim(),
        description: category.description.trim()
      })
      .pipe(
        map(response => this.mapCategory(response?.category)),
        tap(newCategory => {
          this.categoriesSignal.update(categories => [...categories, newCategory]);
          this.loadingSignal.set(false);
        }),
        catchError(error => {
          this.loadingSignal.set(false);
          return throwError(() => error);
        })
      );
  }

  update(id: number, category: CategoryFormData): Observable<Category> {
    this.loadingSignal.set(true);

    return this.http
      .put<CategoryResponse>(`${this.API_URL}/${id}`, {
        name: category.name.trim(),
        description: category.description.trim(),
        isActive: category.isActive ?? true
      })
      .pipe(
        map(response => this.mapCategory(response?.category)),
        tap(updatedCategory => {
          this.categoriesSignal.update(categories =>
            categories.map(existing => (existing.id === id ? updatedCategory : existing))
          );
          this.loadingSignal.set(false);
        }),
        catchError(error => {
          this.loadingSignal.set(false);
          return throwError(() => error);
        })
      );
  }

  delete(id: number): Observable<void> {
    this.loadingSignal.set(true);

    return this.http.delete<{ success: boolean }>(`${this.API_URL}/${id}`).pipe(
      map(() => undefined),
      tap(() => {
        this.categoriesSignal.update(categories => categories.filter(c => c.id !== id));
        this.loadingSignal.set(false);
      }),
      catchError(error => {
        this.loadingSignal.set(false);
        return throwError(() => error);
      })
    );
  }

  searchCategories(term: string): Category[] {
    if (!term) {
      return this.categoriesSignal();
    }

    const normalizedTerm = term.toLowerCase();
    return this.categoriesSignal().filter(category => {
      return (
        category.name.toLowerCase().includes(normalizedTerm) ||
        category.description.toLowerCase().includes(normalizedTerm)
      );
    });
  }

  private mapCategory(row: unknown): Category {
    const value = (row || {}) as Record<string, unknown>;

    return {
      id: Number(value['id'] ?? 0),
      name: String(value['name'] ?? ''),
      description: String(value['description'] ?? ''),
      isActive: Boolean(value['isActive'] ?? value['is_active'] ?? true),
      productCount: Number(value['productCount'] ?? value['product_count'] ?? 0),
      createdAt: value['createdAt'] ? String(value['createdAt']) : undefined,
      updatedAt: value['updatedAt'] ? String(value['updatedAt']) : undefined
    };
  }
}
