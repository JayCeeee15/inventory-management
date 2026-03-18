import { Injectable, signal } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, catchError, map, tap, throwError } from 'rxjs';
import {
  Product,
  ProductCreateInput,
  ProductQuery,
  ProductUpdateInput
} from '../../shared/models/product.model';
import { environment } from '../../../environments/environment';

interface ProductsResponse {
  products: unknown[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

interface ProductResponse {
  product: unknown;
}

const PRODUCT_UNIT_OPTIONS = ['Box', 'Pieces', 'Packs'] as const;
type ProductUnitOption = (typeof PRODUCT_UNIT_OPTIONS)[number];

@Injectable({
  providedIn: 'root'
})
export class ProductService {
  private readonly API_URL = `${environment.apiUrl}/inventory/products`;

  private productsSignal = signal<Product[]>([]);
  public products = this.productsSignal.asReadonly();

  private loadingSignal = signal<boolean>(false);
  public loading = this.loadingSignal.asReadonly();

  constructor(private http: HttpClient) {}

  getAll(query: ProductQuery = {}): Observable<Product[]> {
    this.loadingSignal.set(true);

    let params = new HttpParams();
    if (query.page) {
      params = params.set('page', String(query.page));
    }
    if (query.limit) {
      params = params.set('limit', String(query.limit));
    }
    if (query.search) {
      params = params.set('search', query.search.trim());
    }
    if (query.categoryId) {
      params = params.set('categoryId', String(query.categoryId));
    }
    if (query.locationId) {
      params = params.set('locationId', String(query.locationId));
    }
    if (query.includeInactive) {
      params = params.set('includeInactive', 'true');
    }

    return this.http.get<ProductsResponse>(this.API_URL, { params }).pipe(
      map(response => (Array.isArray(response?.products) ? response.products.map(row => this.mapProduct(row)) : [])),
      tap(products => {
        this.productsSignal.set(products);
        this.loadingSignal.set(false);
      }),
      catchError(error => {
        this.loadingSignal.set(false);
        return throwError(() => error);
      })
    );
  }

  getById(id: number, locationId?: number): Observable<Product> {
    let params = new HttpParams();
    if (locationId) {
      params = params.set('locationId', String(locationId));
    }

    return this.http.get<ProductResponse>(`${this.API_URL}/${id}`, { params }).pipe(
      map(response => this.mapProduct(response?.product)),
      catchError(error => throwError(() => error))
    );
  }

  create(product: ProductCreateInput): Observable<Product> {
    this.loadingSignal.set(true);

    return this.http.post<ProductResponse>(this.API_URL, this.toCreatePayload(product)).pipe(
      map(response => this.mapProduct(response?.product)),
      tap(newProduct => {
        this.productsSignal.update(products => [...products, newProduct]);
        this.loadingSignal.set(false);
      }),
      catchError(error => {
        this.loadingSignal.set(false);
        return throwError(() => error);
      })
    );
  }

  update(id: number, product: ProductUpdateInput): Observable<Product> {
    this.loadingSignal.set(true);

    return this.http.put<ProductResponse>(`${this.API_URL}/${id}`, this.toUpdatePayload(product)).pipe(
      map(response => this.mapProduct(response?.product)),
      tap(updatedProduct => {
        this.productsSignal.update(products =>
          products.map(existing => (existing.id === id ? updatedProduct : existing))
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
        this.productsSignal.update(products => products.filter(product => product.id !== id));
        this.loadingSignal.set(false);
      }),
      catchError(error => {
        this.loadingSignal.set(false);
        return throwError(() => error);
      })
    );
  }

  getLowStockProducts(threshold = 0): Product[] {
    return this.productsSignal().filter(product => product.qtyAvailable <= Math.max(product.reorderLevel, threshold));
  }

  searchProducts(term: string): Product[] {
    if (!term) {
      return this.productsSignal();
    }

    const normalizedTerm = term.toLowerCase();
    return this.productsSignal().filter(product => {
      return (
        product.name.toLowerCase().includes(normalizedTerm) ||
        product.sku.toLowerCase().includes(normalizedTerm) ||
        product.categoryName.toLowerCase().includes(normalizedTerm)
      );
    });
  }

  private toCreatePayload(product: ProductCreateInput): Record<string, unknown> {
    return {
      categoryId: product.categoryId,
      sku: product.sku.trim(),
      name: product.name.trim(),
      description: product.description?.trim() || '',
      unit: this.normalizeUnit(product.unit),
      price: product.price,
      reorderLevel: product.reorderLevel,
      controlled: product.controlled,
      initialStocks: product.initialStocks ?? []
    };
  }

  private toUpdatePayload(product: ProductUpdateInput): Record<string, unknown> {
    return {
      categoryId: product.categoryId,
      sku: product.sku.trim(),
      name: product.name.trim(),
      description: product.description?.trim() || '',
      unit: this.normalizeUnit(product.unit),
      price: product.price,
      reorderLevel: product.reorderLevel,
      controlled: product.controlled,
      isActive: product.isActive
    };
  }

  private mapProduct(row: unknown): Product {
    const value = (row || {}) as Record<string, unknown>;
    const category = (value['category'] || {}) as Record<string, unknown>;

    const categoryId = Number(value['categoryId'] ?? value['category_id'] ?? category['id'] ?? 0);
    const categoryName = String(value['categoryName'] ?? value['category_name'] ?? category['name'] ?? '');

    return {
      id: Number(value['id'] ?? 0),
      sku: String(value['sku'] ?? ''),
      name: String(value['name'] ?? ''),
      description: String(value['description'] ?? ''),
      unit: this.normalizeUnit(value['unit']),
      price: Number(value['price'] ?? 0),
      reorderLevel: Number(value['reorderLevel'] ?? value['reorder_level'] ?? 0),
      controlled: Boolean(value['controlled'] ?? value['controlled_flag'] ?? false),
      isActive: Boolean(value['isActive'] ?? value['is_active'] ?? true),
      categoryId,
      categoryName,
      qtyOnHand: Number(value['qtyOnHand'] ?? value['qty_on_hand'] ?? 0),
      qtyReserved: Number(value['qtyReserved'] ?? value['qty_reserved'] ?? 0),
      qtyAvailable: Number(value['qtyAvailable'] ?? value['qty_available'] ?? 0)
    };
  }

  private normalizeUnit(value: unknown): ProductUnitOption {
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
