import { Injectable } from '@angular/core';
import { forkJoin, map, Observable, retry, timeout, timer } from 'rxjs';
import { Product } from '../../shared/models/product.model';
import { InventoryLocation, InventoryService } from './inventory.service';
import { ProductService } from './product.service';

export interface TransactionReferenceData {
  products: Product[];
  locations: InventoryLocation[];
}

export interface TransactionReferenceLoadOptions {
  productLimit?: number;
  timeoutMs?: number;
  retryCount?: number;
  retryDelayMs?: number;
  onRetry?: () => void;
}

@Injectable({
  providedIn: 'root'
})
export class TransactionReferenceService {
  private static readonly DEFAULT_PRODUCT_LIMIT = 250;
  private static readonly DEFAULT_TIMEOUT_MS = 8000;
  private static readonly DEFAULT_RETRY_COUNT = 1;
  private static readonly DEFAULT_RETRY_DELAY_MS = 250;

  constructor(
    private productService: ProductService,
    private inventoryService: InventoryService
  ) {}

  load(options: TransactionReferenceLoadOptions = {}): Observable<TransactionReferenceData> {
    const productLimit = options.productLimit ?? TransactionReferenceService.DEFAULT_PRODUCT_LIMIT;
    const timeoutMs = options.timeoutMs ?? TransactionReferenceService.DEFAULT_TIMEOUT_MS;
    const retryCount = options.retryCount ?? TransactionReferenceService.DEFAULT_RETRY_COUNT;
    const retryDelayMs = options.retryDelayMs ?? TransactionReferenceService.DEFAULT_RETRY_DELAY_MS;

    return forkJoin({
      products: this.productService.getAll({ limit: productLimit }),
      locations: this.inventoryService.getLocations()
    }).pipe(
      timeout(timeoutMs),
      retry({
        count: retryCount,
        delay: (_error, _retryIndex) => {
          options.onRetry?.();
          return timer(retryDelayMs);
        }
      }),
      map(({ products, locations }) => ({
        products: products.filter(product => product.isActive),
        locations: locations.filter(location => location.isActive)
      }))
    );
  }
}
