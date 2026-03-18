import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { map, Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface ShopLocation {
  id: number;
  code: string;
  name: string;
  locationType: string;
}

export interface ShopCategory {
  id: number;
  name: string;
  description: string;
  productCount: number;
}

export interface ShopProduct {
  id: number;
  sku: string;
  name: string;
  description: string;
  unit: string;
  price: number;
  categoryId: number;
  categoryName: string;
  locationId: number | null;
  locationName: string | null;
  qtyOnHand: number;
  qtyReserved: number;
  qtyAvailable: number;
}

export interface ShopCatalogQuery {
  page?: number;
  limit?: number;
  search?: string;
  categoryId?: number | null;
  locationId?: number | null;
}

export interface ShopCatalogPage {
  products: ShopProduct[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
  appliedLocation: ShopLocation | null;
}

export interface CustomerOrderItemInput {
  productId: number;
  locationId: number;
  quantity: number;
}

export interface CustomerOrderInput {
  customerName: string;
  mobileNumber: string;
  fulfillmentMethod: 'pickup' | 'delivery';
  deliveryAddress?: string;
  notes?: string;
  items: CustomerOrderItemInput[];
}

export interface CustomerOrderResult {
  id: number;
  orderNo: string;
  customerName: string;
  mobileNumber: string;
  fulfillmentMethod: 'pickup' | 'delivery';
  totalAmount: number;
  itemCount: number;
  status: string;
}

export interface AdminOrderSummary {
  id: number;
  orderNo: string;
  customerName: string;
  mobileNumber: string;
  fulfillmentMethod: 'pickup' | 'delivery';
  deliveryAddress: string;
  notes: string;
  totalAmount: number;
  status: string;
  itemCount: number;
  totalQuantity: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminOrderItem {
  id: number;
  productId: number;
  productName: string;
  sku: string;
  locationId: number;
  locationName: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface AdminOrderDetail {
  id: number;
  orderNo: string;
  customerName: string;
  mobileNumber: string;
  fulfillmentMethod: 'pickup' | 'delivery';
  deliveryAddress: string;
  notes: string;
  totalAmount: number;
  status: string;
  createdAt: string;
  updatedAt: string;
  items: AdminOrderItem[];
}

export type AdminOrderStatusAction = 'approve' | 'fulfill' | 'cancel';

interface LocationsResponse {
  locations: unknown[];
}

interface CategoriesResponse {
  categories: unknown[];
}

interface PublicProductsResponse {
  products: unknown[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
  appliedLocation?: unknown;
}

interface OrderResponse {
  order: unknown;
}

interface OrdersResponse {
  orders: unknown[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class ShopService {
  private readonly BASE_URL = `${environment.apiUrl}/shop`;

  constructor(private http: HttpClient) {}

  getPublicLocations(): Observable<ShopLocation[]> {
    return this.http.get<LocationsResponse>(`${this.BASE_URL}/public/locations`).pipe(
      map(response => (Array.isArray(response?.locations) ? response.locations.map(row => this.mapLocation(row)) : []))
    );
  }

  getPublicCategories(): Observable<ShopCategory[]> {
    return this.http.get<CategoriesResponse>(`${this.BASE_URL}/public/categories`).pipe(
      map(response =>
        Array.isArray(response?.categories) ? response.categories.map(row => this.mapCategory(row)) : []
      )
    );
  }

  getPublicProducts(query: ShopCatalogQuery = {}): Observable<ShopCatalogPage> {
    let params = new HttpParams();
    if (query.page) {
      params = params.set('page', String(query.page));
    }
    if (query.limit) {
      params = params.set('limit', String(query.limit));
    }
    if (query.search?.trim()) {
      params = params.set('search', query.search.trim());
    }
    if (query.categoryId) {
      params = params.set('categoryId', String(query.categoryId));
    }
    if (query.locationId) {
      params = params.set('locationId', String(query.locationId));
    }

    return this.http.get<PublicProductsResponse>(`${this.BASE_URL}/public/products`, { params }).pipe(
      map(response => ({
        products: Array.isArray(response?.products) ? response.products.map(row => this.mapProduct(row)) : [],
        page: Number(response?.page ?? 1),
        limit: Number(response?.limit ?? 12),
        total: Number(response?.total ?? 0),
        hasMore: Boolean(response?.hasMore ?? false),
        appliedLocation: response?.appliedLocation ? this.mapLocation(response.appliedLocation) : null
      }))
    );
  }

  createPublicOrder(input: CustomerOrderInput): Observable<CustomerOrderResult> {
    return this.http.post<OrderResponse>(`${this.BASE_URL}/public/orders`, input).pipe(
      map(response => this.mapCustomerOrderResult(response?.order))
    );
  }

  getAdminOrders(options: { page?: number; limit?: number; status?: string; search?: string } = {}): Observable<{
    orders: AdminOrderSummary[];
    page: number;
    limit: number;
    total: number;
    hasMore: boolean;
  }> {
    let params = new HttpParams();
    if (options.page) {
      params = params.set('page', String(options.page));
    }
    if (options.limit) {
      params = params.set('limit', String(options.limit));
    }
    if (options.status?.trim()) {
      params = params.set('status', options.status.trim());
    }
    if (options.search?.trim()) {
      params = params.set('search', options.search.trim());
    }

    return this.http.get<OrdersResponse>(`${this.BASE_URL}/orders`, { params }).pipe(
      map(response => ({
        orders: Array.isArray(response?.orders) ? response.orders.map(row => this.mapOrderSummary(row)) : [],
        page: Number(response?.page ?? 1),
        limit: Number(response?.limit ?? 10),
        total: Number(response?.total ?? 0),
        hasMore: Boolean(response?.hasMore ?? false)
      }))
    );
  }

  getAdminOrderDetail(orderId: number): Observable<AdminOrderDetail> {
    return this.http.get<OrderResponse>(`${this.BASE_URL}/orders/${orderId}`).pipe(
      map(response => this.mapOrderDetail(response?.order))
    );
  }

  updateOrderStatus(orderId: number, action: AdminOrderStatusAction): Observable<AdminOrderSummary> {
    return this.http.patch<OrderResponse>(`${this.BASE_URL}/orders/${orderId}/status`, { action }).pipe(
      map(response => this.mapOrderSummary(response?.order))
    );
  }

  private mapLocation(row: unknown): ShopLocation {
    const value = (row || {}) as Record<string, unknown>;
    return {
      id: Number(value['id'] ?? 0),
      code: String(value['code'] ?? ''),
      name: String(value['name'] ?? ''),
      locationType: String(value['locationType'] ?? value['location_type'] ?? '')
    };
  }

  private mapCategory(row: unknown): ShopCategory {
    const value = (row || {}) as Record<string, unknown>;
    return {
      id: Number(value['id'] ?? 0),
      name: String(value['name'] ?? ''),
      description: String(value['description'] ?? ''),
      productCount: Number(value['productCount'] ?? value['product_count'] ?? 0)
    };
  }

  private mapProduct(row: unknown): ShopProduct {
    const value = (row || {}) as Record<string, unknown>;
    return {
      id: Number(value['id'] ?? 0),
      sku: String(value['sku'] ?? ''),
      name: String(value['name'] ?? ''),
      description: String(value['description'] ?? ''),
      unit: String(value['unit'] ?? ''),
      price: Number(value['price'] ?? 0),
      categoryId: Number(value['categoryId'] ?? value['category_id'] ?? 0),
      categoryName: String(value['categoryName'] ?? value['category_name'] ?? ''),
      locationId:
        value['locationId'] !== undefined && value['locationId'] !== null
          ? Number(value['locationId'])
          : value['location_id'] !== undefined && value['location_id'] !== null
            ? Number(value['location_id'])
            : null,
      locationName: value['locationName']
        ? String(value['locationName'])
        : value['location_name']
          ? String(value['location_name'])
          : null,
      qtyOnHand: Number(value['qtyOnHand'] ?? value['qty_on_hand'] ?? 0),
      qtyReserved: Number(value['qtyReserved'] ?? value['qty_reserved'] ?? 0),
      qtyAvailable: Number(value['qtyAvailable'] ?? value['qty_available'] ?? 0)
    };
  }

  private mapOrderSummary(row: unknown): AdminOrderSummary {
    const value = (row || {}) as Record<string, unknown>;
    return {
      id: Number(value['id'] ?? 0),
      orderNo: String(value['orderNo'] ?? value['order_no'] ?? ''),
      customerName: String(value['customerName'] ?? value['customer_name'] ?? ''),
      mobileNumber: String(value['mobileNumber'] ?? value['mobile_number'] ?? ''),
      fulfillmentMethod: this.mapFulfillmentMethod(value['fulfillmentMethod'] ?? value['fulfillment_method']),
      deliveryAddress: String(value['deliveryAddress'] ?? value['delivery_address'] ?? ''),
      notes: String(value['notes'] ?? ''),
      totalAmount: Number(value['totalAmount'] ?? value['total_amount'] ?? 0),
      status: String(value['status'] ?? ''),
      itemCount: Number(value['itemCount'] ?? value['item_count'] ?? 0),
      totalQuantity: Number(value['totalQuantity'] ?? value['total_quantity'] ?? 0),
      createdAt: String(value['createdAt'] ?? value['created_at'] ?? ''),
      updatedAt: String(value['updatedAt'] ?? value['updated_at'] ?? '')
    };
  }

  private mapOrderDetail(row: unknown): AdminOrderDetail {
    const value = (row || {}) as Record<string, unknown>;
    const items = Array.isArray(value['items']) ? value['items'] : [];

    return {
      id: Number(value['id'] ?? 0),
      orderNo: String(value['orderNo'] ?? value['order_no'] ?? ''),
      customerName: String(value['customerName'] ?? value['customer_name'] ?? ''),
      mobileNumber: String(value['mobileNumber'] ?? value['mobile_number'] ?? ''),
      fulfillmentMethod: this.mapFulfillmentMethod(value['fulfillmentMethod'] ?? value['fulfillment_method']),
      deliveryAddress: String(value['deliveryAddress'] ?? value['delivery_address'] ?? ''),
      notes: String(value['notes'] ?? ''),
      totalAmount: Number(value['totalAmount'] ?? value['total_amount'] ?? 0),
      status: String(value['status'] ?? ''),
      createdAt: String(value['createdAt'] ?? value['created_at'] ?? ''),
      updatedAt: String(value['updatedAt'] ?? value['updated_at'] ?? ''),
      items: items.map(item => {
        const itemValue = (item || {}) as Record<string, unknown>;
        return {
          id: Number(itemValue['id'] ?? 0),
          productId: Number(itemValue['productId'] ?? itemValue['product_id'] ?? 0),
          productName: String(itemValue['productName'] ?? itemValue['product_name'] ?? ''),
          sku: String(itemValue['sku'] ?? ''),
          locationId: Number(itemValue['locationId'] ?? itemValue['location_id'] ?? 0),
          locationName: String(itemValue['locationName'] ?? itemValue['location_name'] ?? ''),
          quantity: Number(itemValue['quantity'] ?? 0),
          unitPrice: Number(itemValue['unitPrice'] ?? itemValue['unit_price'] ?? 0),
          lineTotal: Number(itemValue['lineTotal'] ?? itemValue['line_total'] ?? 0)
        };
      })
    };
  }

  private mapCustomerOrderResult(row: unknown): CustomerOrderResult {
    const value = (row || {}) as Record<string, unknown>;
    return {
      id: Number(value['id'] ?? 0),
      orderNo: String(value['orderNo'] ?? value['order_no'] ?? ''),
      customerName: String(value['customerName'] ?? value['customer_name'] ?? ''),
      mobileNumber: String(value['mobileNumber'] ?? value['mobile_number'] ?? ''),
      fulfillmentMethod: this.mapFulfillmentMethod(value['fulfillmentMethod'] ?? value['fulfillment_method']),
      totalAmount: Number(value['totalAmount'] ?? value['total_amount'] ?? 0),
      itemCount: Number(value['itemCount'] ?? value['item_count'] ?? 0),
      status: String(value['status'] ?? '')
    };
  }

  private mapFulfillmentMethod(value: unknown): 'pickup' | 'delivery' {
    return String(value ?? '').toLowerCase() === 'delivery' ? 'delivery' : 'pickup';
  }
}
