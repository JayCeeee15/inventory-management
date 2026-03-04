import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface InventoryLocation {
  id: number;
  code: string;
  name: string;
  locationType: string;
  isActive: boolean;
}

export interface StockMovement {
  id: number;
  productId: number;
  productName: string;
  locationId: number | null;
  locationName: string | null;
  movementType: string;
  quantity: number;
  unitCost: number | null;
  referenceType: string;
  referenceId: number | null;
  notes: string;
  createdBy: { id: number; username: string } | null;
  createdAt: string;
}

export interface DashboardSummary {
  totalProducts: number;
  totalCategories: number;
  lowStockItems: number;
  stockMovementsLast7Days: number;
}

export interface StockMovementQuery {
  page?: number;
  limit?: number;
  productId?: number;
  locationId?: number;
  movementType?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface StockMovementsPage {
  movements: StockMovement[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

export interface InventoryTransactionItemInput {
  productId: number;
  locationId: number;
  quantity: number;
  unitPrice?: number;
}

export interface WalkInSaleInput {
  patientName?: string;
  patientId?: string;
  notes?: string;
  items: InventoryTransactionItemInput[];
}

export interface WalkInSaleResult {
  id: number;
  saleNo: string;
  saleChannel: string;
  totalAmount: number;
  itemCount: number;
  status: string;
}

export interface PatientIssueInput {
  patientName: string;
  patientId?: string;
  department: string;
  notes?: string;
  items: InventoryTransactionItemInput[];
}

export interface PatientIssueResult {
  id: number;
  issueNo: string;
  patientName: string;
  department: string;
  itemCount: number;
  status: string;
}

interface LocationsResponse {
  locations: unknown[];
}

interface MovementsResponse {
  movements: unknown[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

interface SummaryResponse {
  summary: {
    totalProducts: number;
    totalCategories: number;
    lowStockItems: number;
    stockMovementsLast7Days: number;
  };
}

interface SaleResponse {
  sale: {
    id: number;
    saleNo: string;
    saleChannel: string;
    totalAmount: number;
    itemCount: number;
    status: string;
  };
}

interface PatientIssueResponse {
  patientIssue: {
    id: number;
    issueNo: string;
    patientName: string;
    department: string;
    itemCount: number;
    status: string;
  };
}

@Injectable({
  providedIn: 'root'
})
export class InventoryService {
  private readonly BASE_URL = `${environment.apiUrl}/inventory`;

  constructor(private http: HttpClient) {}

  getLocations(includeInactive = false): Observable<InventoryLocation[]> {
    let params = new HttpParams();
    if (includeInactive) {
      params = params.set('includeInactive', 'true');
    }

    return this.http.get<LocationsResponse>(`${this.BASE_URL}/locations`, { params }).pipe(
      map(response =>
        Array.isArray(response?.locations) ? response.locations.map((row: unknown) => this.mapLocation(row)) : []
      )
    );
  }

  getStockMovements(options: StockMovementQuery = {}): Observable<StockMovement[]> {
    return this.getStockMovementsPage(options).pipe(map(result => result.movements));
  }

  getStockMovementsPage(options: StockMovementQuery = {}): Observable<StockMovementsPage> {
    let params = new HttpParams();
    if (options.page) {
      params = params.set('page', String(options.page));
    }
    if (options.limit) {
      params = params.set('limit', String(options.limit));
    }
    if (options.productId) {
      params = params.set('productId', String(options.productId));
    }
    if (options.locationId) {
      params = params.set('locationId', String(options.locationId));
    }
    if (options.movementType) {
      params = params.set('movementType', options.movementType);
    }
    if (options.dateFrom) {
      params = params.set('dateFrom', options.dateFrom);
    }
    if (options.dateTo) {
      params = params.set('dateTo', options.dateTo);
    }

    return this.http
      .get<MovementsResponse>(`${this.BASE_URL}/stock/movements`, { params })
      .pipe(
        map(response => ({
          page: Number(response?.page ?? 1),
          limit: Number(response?.limit ?? 20),
          total: Number(response?.total ?? 0),
          hasMore: Boolean(response?.hasMore ?? false),
          movements: Array.isArray(response?.movements) ? response.movements.map(row => this.mapMovement(row)) : []
        }))
      );
  }

  getDashboardSummary(): Observable<DashboardSummary> {
    return this.http.get<SummaryResponse>(`${this.BASE_URL}/dashboard/summary`).pipe(
      map(response => ({
        totalProducts: Number(response?.summary?.totalProducts ?? 0),
        totalCategories: Number(response?.summary?.totalCategories ?? 0),
        lowStockItems: Number(response?.summary?.lowStockItems ?? 0),
        stockMovementsLast7Days: Number(response?.summary?.stockMovementsLast7Days ?? 0)
      }))
    );
  }

  createWalkInSale(input: WalkInSaleInput): Observable<WalkInSaleResult> {
    const payload = {
      saleChannel: 'walk_in',
      patientName: input.patientName?.trim() || undefined,
      patientId: input.patientId?.trim() || undefined,
      notes: input.notes?.trim() || undefined,
      items: input.items.map(item => ({
        productId: item.productId,
        locationId: item.locationId,
        quantity: item.quantity,
        unitPrice: item.unitPrice
      }))
    };

    return this.http.post<SaleResponse>(`${this.BASE_URL}/sales`, payload).pipe(
      map(response => ({
        id: Number(response?.sale?.id ?? 0),
        saleNo: String(response?.sale?.saleNo ?? ''),
        saleChannel: String(response?.sale?.saleChannel ?? ''),
        totalAmount: Number(response?.sale?.totalAmount ?? 0),
        itemCount: Number(response?.sale?.itemCount ?? 0),
        status: String(response?.sale?.status ?? '')
      }))
    );
  }

  createPatientIssue(input: PatientIssueInput): Observable<PatientIssueResult> {
    const payload = {
      patientName: input.patientName.trim(),
      patientId: input.patientId?.trim() || undefined,
      department: input.department.trim(),
      notes: input.notes?.trim() || undefined,
      items: input.items.map(item => ({
        productId: item.productId,
        locationId: item.locationId,
        quantity: item.quantity
      }))
    };

    return this.http.post<PatientIssueResponse>(`${this.BASE_URL}/patient-issues`, payload).pipe(
      map(response => ({
        id: Number(response?.patientIssue?.id ?? 0),
        issueNo: String(response?.patientIssue?.issueNo ?? ''),
        patientName: String(response?.patientIssue?.patientName ?? ''),
        department: String(response?.patientIssue?.department ?? ''),
        itemCount: Number(response?.patientIssue?.itemCount ?? 0),
        status: String(response?.patientIssue?.status ?? '')
      }))
    );
  }

  private mapLocation(row: unknown): InventoryLocation {
    const value = (row || {}) as Record<string, unknown>;

    return {
      id: Number(value['id'] ?? 0),
      code: String(value['code'] ?? ''),
      name: String(value['name'] ?? ''),
      locationType: String(value['locationType'] ?? value['location_type'] ?? ''),
      isActive: Boolean(value['isActive'] ?? value['is_active'] ?? true)
    };
  }

  private mapMovement(row: unknown): StockMovement {
    const value = (row || {}) as Record<string, unknown>;
    const createdBy = (value['createdBy'] || {}) as Record<string, unknown>;

    return {
      id: Number(value['id'] ?? 0),
      productId: Number(value['productId'] ?? value['product_id'] ?? 0),
      productName: String(value['productName'] ?? value['product_name'] ?? ''),
      locationId:
        value['locationId'] !== undefined || value['location_id'] !== undefined
          ? Number(value['locationId'] ?? value['location_id'] ?? 0)
          : null,
      locationName: value['locationName']
        ? String(value['locationName'])
        : value['location_name']
          ? String(value['location_name'])
          : null,
      movementType: String(value['movementType'] ?? value['movement_type'] ?? ''),
      quantity: Number(value['quantity'] ?? 0),
      unitCost:
        value['unitCost'] !== undefined || value['unit_cost'] !== undefined
          ? Number(value['unitCost'] ?? value['unit_cost'] ?? 0)
          : null,
      referenceType: String(value['referenceType'] ?? value['reference_type'] ?? ''),
      referenceId:
        value['referenceId'] !== undefined || value['reference_id'] !== undefined
          ? Number(value['referenceId'] ?? value['reference_id'] ?? 0)
          : null,
      notes: String(value['notes'] ?? ''),
      createdBy:
        createdBy && Object.keys(createdBy).length > 0
          ? {
              id: Number(createdBy['id'] ?? 0),
              username: String(createdBy['username'] ?? '')
            }
          : null,
      createdAt: String(value['createdAt'] ?? value['created_at'] ?? '')
    };
  }
}
