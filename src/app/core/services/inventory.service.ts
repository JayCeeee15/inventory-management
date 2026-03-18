import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, catchError, forkJoin, map, of, switchMap, throwError } from 'rxjs';
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
  referenceNo: string | null;
  patientId: string | null;
  patientName: string | null;
  notes: string;
  createdBy: { id: number; username: string } | null;
  createdAt: string;
}

export interface DashboardSummary {
  totalProducts: number;
  totalCategories: number;
  stockLeft: number;
  lowStockItems: number;
  outOfStockItems: number;
  salesToday: number;
  transactionsToday: number;
  stockMovementsLast7Days: number;
}

export interface StockGraphPoint {
  productId: number;
  productName: string;
  categoryName: string;
  qtyOnHand: number;
}

export interface StockMovementQuery {
  page?: number;
  limit?: number;
  productId?: number;
  locationId?: number;
  movementType?: string;
  patientId?: string;
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

export interface SaleTransactionDetailItem {
  id: number;
  productId: number;
  productName: string;
  sku: string;
  locationId: number | null;
  locationName: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface SaleTransactionDetail {
  id: number;
  saleNo: string;
  saleChannel: string;
  patientId: string | null;
  patientName: string | null;
  totalAmount: number;
  paymentMethod: string;
  amountPaid: number;
  changeAmount: number;
  status: string;
  notes: string;
  createdAt: string;
  createdBy: { id: number; username: string; fullName: string } | null;
  items: SaleTransactionDetailItem[];
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
  paymentMethod: 'cash' | 'card';
  amountPaid: number;
  items: InventoryTransactionItemInput[];
}

export interface WalkInSaleResult {
  id: number;
  saleNo: string;
  saleChannel: string;
  patientId: string;
  totalAmount: number;
  paymentMethod: 'cash' | 'card';
  amountPaid: number;
  changeAmount: number;
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

export interface StockReceiveInput {
  productId: number;
  locationId: number;
  quantity: number;
  unitCost?: number | null;
  notes?: string;
}

export interface StockReceiveResult {
  productId: number;
  locationId: number;
  qtyOnHand: number;
  qtyReserved: number;
  qtyAvailable: number;
}

export interface SaleResetResult {
  success: boolean;
  nextPatientId: string;
  deletedSales: number;
  deletedSaleItems: number;
  deletedMovementLogs: number;
  deletedPatients?: number;
  deletedPatientIssues?: number;
  deletedIssueItems?: number;
  deletedReceiveLogs?: number;
  deletedAdjustmentLogs?: number;
  deletedSaleId?: number;
  saleNo?: string;
  remainingTransactions?: number;
}

export interface TransactionDeleteResult {
  success: boolean;
  deletedMovementId: number;
  deletedMovementType: string;
  deletedMovementLogs: number;
  deletedSales?: number;
  deletedSaleItems?: number;
  deletedPatientIssues?: number;
  deletedIssueItems?: number;
  deletedPatients?: number;
  referenceNo?: string;
  remainingTransactions?: number;
  nextPatientId?: string;
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
    stockLeft: number;
    lowStockItems: number;
    outOfStockItems: number;
    salesToday: number;
    transactionsToday: number;
    stockMovementsLast7Days: number;
  };
}

interface StockGraphResponse {
  generatedAt?: string;
  products: unknown[];
}

interface ProductsSnapshotResponse {
  products: unknown[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

interface SaleResponse {
  sale: {
    id: number;
    saleNo: string;
    saleChannel: string;
    patientId?: string;
    totalAmount: number;
    paymentMethod: string;
    amountPaid: number;
    changeAmount: number;
    itemCount: number;
    status: string;
  };
}

interface NextPatientIdResponse {
  patientId?: string;
  nextPatientNumber?: number;
}

interface SaleDetailResponse {
  sale: {
    id: number;
    saleNo: string;
    saleChannel: string;
    patientId?: string | null;
    patientName?: string | null;
    totalAmount: number;
    paymentMethod: string;
    amountPaid: number;
    changeAmount: number;
    status: string;
    notes?: string;
    createdAt: string;
    createdBy?: {
      id: number;
      username: string;
      fullName: string;
    } | null;
    items?: Array<{
      id: number;
      productId: number;
      productName: string;
      sku: string;
      locationId?: number | null;
      locationName?: string | null;
      quantity: number;
      unitPrice: number;
      lineTotal: number;
    }>;
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

interface SaleResetResponse {
  success: boolean;
  nextPatientId?: string;
  deletedSales?: number;
  deletedSaleItems?: number;
  deletedMovementLogs?: number;
  deletedPatients?: number;
  deletedPatientIssues?: number;
  deletedIssueItems?: number;
  deletedReceiveLogs?: number;
  deletedAdjustmentLogs?: number;
  deletedSaleId?: number;
  saleNo?: string;
  remainingTransactions?: number;
}

interface TransactionDeleteResponse {
  success: boolean;
  deletedMovementId?: number;
  deletedMovementType?: string;
  deletedMovementLogs?: number;
  deletedSales?: number;
  deletedSaleItems?: number;
  deletedPatientIssues?: number;
  deletedIssueItems?: number;
  deletedPatients?: number;
  referenceNo?: string;
  remainingTransactions?: number;
  nextPatientId?: string;
}

interface StockReceiveResponse {
  stock?: {
    productId?: number;
    locationId?: number;
    qtyOnHand?: number;
    qtyReserved?: number;
    qtyAvailable?: number;
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
    if (options.patientId) {
      params = params.set('patientId', options.patientId.trim());
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
        stockLeft: Number(response?.summary?.stockLeft ?? 0),
        lowStockItems: Number(response?.summary?.lowStockItems ?? 0),
        outOfStockItems: Number(response?.summary?.outOfStockItems ?? 0),
        salesToday: Number(response?.summary?.salesToday ?? 0),
        transactionsToday: Number(response?.summary?.transactionsToday ?? 0),
        stockMovementsLast7Days: Number(response?.summary?.stockMovementsLast7Days ?? 0)
      }))
    );
  }

  getSaleTransactionDetails(saleId: number): Observable<SaleTransactionDetail> {
    return this.http.get<SaleDetailResponse>(`${this.BASE_URL}/sales/${saleId}/details`).pipe(
      map(response => {
        const sale = response?.sale;
        return {
          id: Number(sale?.id ?? 0),
          saleNo: String(sale?.saleNo ?? ''),
          saleChannel: String(sale?.saleChannel ?? ''),
          patientId: sale?.patientId ? String(sale.patientId) : null,
          patientName: sale?.patientName ? String(sale.patientName) : null,
          totalAmount: Number(sale?.totalAmount ?? 0),
          paymentMethod: String(sale?.paymentMethod ?? 'cash'),
          amountPaid: Number(sale?.amountPaid ?? 0),
          changeAmount: Number(sale?.changeAmount ?? 0),
          status: String(sale?.status ?? ''),
          notes: String(sale?.notes ?? ''),
          createdAt: String(sale?.createdAt ?? ''),
          createdBy: sale?.createdBy
            ? {
                id: Number(sale.createdBy.id ?? 0),
                username: String(sale.createdBy.username ?? ''),
                fullName: String(sale.createdBy.fullName ?? '')
              }
            : null,
          items: Array.isArray(sale?.items)
            ? sale.items.map(item => ({
                id: Number(item.id ?? 0),
                productId: Number(item.productId ?? 0),
                productName: String(item.productName ?? ''),
                sku: String(item.sku ?? ''),
                locationId:
                  item.locationId !== undefined && item.locationId !== null
                    ? Number(item.locationId)
                    : null,
                locationName: item.locationName ? String(item.locationName) : null,
                quantity: Number(item.quantity ?? 0),
                unitPrice: Number(item.unitPrice ?? 0),
                lineTotal: Number(item.lineTotal ?? 0)
              }))
            : []
        };
      })
    );
  }

  getDashboardStockGraph(limit = 6): Observable<StockGraphPoint[]> {
    const safeLimit = Math.max(1, Math.min(50, Math.trunc(limit) || 6));
    const params = new HttpParams().set('limit', String(safeLimit));

    return this.http
      .get<StockGraphResponse>(`${this.BASE_URL}/dashboard/stock-graph`, { params })
      .pipe(
        map(response =>
          Array.isArray(response?.products)
            ? response.products.map(row => this.mapStockGraphPoint(row))
            : []
        ),
        catchError(error =>
          this.getStockGraphFallback(safeLimit).pipe(
            catchError(() => throwError(() => error))
          )
        )
      );
  }

  getNextWalkInPatientId(): Observable<string> {
    return this.http.get<NextPatientIdResponse>(`${this.BASE_URL}/patients/next-id`).pipe(
      map(response => {
        const patientId = String(response?.patientId ?? '').trim();
        return patientId || 'PT-1';
      })
    );
  }

  createWalkInSale(input: WalkInSaleInput): Observable<WalkInSaleResult> {
    const payload = {
      saleChannel: 'walk_in',
      patientName: input.patientName?.trim() || undefined,
      patientId: input.patientId?.trim() || undefined,
      notes: input.notes?.trim() || undefined,
      paymentMethod: input.paymentMethod,
      amountPaid: input.amountPaid,
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
        patientId: String(response?.sale?.patientId ?? ''),
        totalAmount: Number(response?.sale?.totalAmount ?? 0),
        paymentMethod:
          String(response?.sale?.paymentMethod ?? '').toLowerCase() === 'card'
            ? 'card'
            : 'cash',
        amountPaid: Number(response?.sale?.amountPaid ?? 0),
        changeAmount: Number(response?.sale?.changeAmount ?? 0),
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

  receiveStock(input: StockReceiveInput): Observable<StockReceiveResult> {
    const payload = {
      productId: input.productId,
      locationId: input.locationId,
      quantity: input.quantity,
      unitCost: input.unitCost ?? undefined,
      notes: input.notes?.trim() || undefined
    };

    return this.http.post<StockReceiveResponse>(`${this.BASE_URL}/stock/receive`, payload).pipe(
      map(response => ({
        productId: Number(response?.stock?.productId ?? 0),
        locationId: Number(response?.stock?.locationId ?? 0),
        qtyOnHand: Number(response?.stock?.qtyOnHand ?? 0),
        qtyReserved: Number(response?.stock?.qtyReserved ?? 0),
        qtyAvailable: Number(response?.stock?.qtyAvailable ?? 0)
      }))
    );
  }

  deleteSaleTransaction(saleId: number): Observable<SaleResetResult> {
    return this.http.delete<SaleResetResponse>(`${this.BASE_URL}/sales/${saleId}`).pipe(
      map(response => ({
        success: Boolean(response?.success ?? false),
        nextPatientId: String(response?.nextPatientId ?? 'PT-1'),
        deletedSales: Number(response?.deletedSales ?? 1),
        deletedSaleItems: Number(response?.deletedSaleItems ?? 0),
        deletedMovementLogs: Number(response?.deletedMovementLogs ?? 0),
        deletedPatients: response?.deletedPatients !== undefined ? Number(response.deletedPatients) : undefined,
        deletedSaleId: response?.deletedSaleId !== undefined ? Number(response.deletedSaleId) : undefined,
        saleNo: response?.saleNo ? String(response.saleNo) : undefined
      }))
    );
  }

  deleteTransactionRecord(movementId: number): Observable<TransactionDeleteResult> {
    return this.http.delete<TransactionDeleteResponse>(`${this.BASE_URL}/transactions/${movementId}`).pipe(
      map(response => ({
        success: Boolean(response?.success ?? false),
        deletedMovementId: Number(response?.deletedMovementId ?? movementId),
        deletedMovementType: String(response?.deletedMovementType ?? ''),
        deletedMovementLogs: Number(response?.deletedMovementLogs ?? 0),
        deletedSales: response?.deletedSales !== undefined ? Number(response.deletedSales) : undefined,
        deletedSaleItems: response?.deletedSaleItems !== undefined ? Number(response.deletedSaleItems) : undefined,
        deletedPatientIssues:
          response?.deletedPatientIssues !== undefined ? Number(response.deletedPatientIssues) : undefined,
        deletedIssueItems: response?.deletedIssueItems !== undefined ? Number(response.deletedIssueItems) : undefined,
        deletedPatients: response?.deletedPatients !== undefined ? Number(response.deletedPatients) : undefined,
        referenceNo: response?.referenceNo ? String(response.referenceNo) : undefined,
        remainingTransactions:
          response?.remainingTransactions !== undefined ? Number(response.remainingTransactions) : undefined,
        nextPatientId: response?.nextPatientId ? String(response.nextPatientId) : undefined
      }))
    );
  }

  clearAllSaleTransactions(): Observable<SaleResetResult> {
    return this.http.delete<SaleResetResponse>(`${this.BASE_URL}/sales/reset/all`).pipe(
      map(response => ({
        success: Boolean(response?.success ?? false),
        nextPatientId: String(response?.nextPatientId ?? 'PT-1'),
        deletedSales: Number(response?.deletedSales ?? 0),
        deletedSaleItems: Number(response?.deletedSaleItems ?? 0),
        deletedMovementLogs: Number(response?.deletedMovementLogs ?? 0),
        deletedPatients: response?.deletedPatients !== undefined ? Number(response.deletedPatients) : undefined,
        deletedPatientIssues:
          response?.deletedPatientIssues !== undefined ? Number(response.deletedPatientIssues) : undefined,
        deletedIssueItems: response?.deletedIssueItems !== undefined ? Number(response.deletedIssueItems) : undefined,
        deletedReceiveLogs:
          response?.deletedReceiveLogs !== undefined ? Number(response.deletedReceiveLogs) : undefined,
        deletedAdjustmentLogs:
          response?.deletedAdjustmentLogs !== undefined ? Number(response.deletedAdjustmentLogs) : undefined,
        deletedSaleId: response?.deletedSaleId !== undefined ? Number(response.deletedSaleId) : undefined,
        saleNo: response?.saleNo ? String(response.saleNo) : undefined,
        remainingTransactions:
          response?.remainingTransactions !== undefined ? Number(response.remainingTransactions) : undefined
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
    const locationIdValue = value['locationId'] ?? value['location_id'];
    const unitCostValue = value['unitCost'] ?? value['unit_cost'];
    const referenceIdValue = value['referenceId'] ?? value['reference_id'];

    return {
      id: Number(value['id'] ?? 0),
      productId: Number(value['productId'] ?? value['product_id'] ?? 0),
      productName: String(value['productName'] ?? value['product_name'] ?? ''),
      locationId:
        locationIdValue === undefined || locationIdValue === null || locationIdValue === ''
          ? null
          : Number(locationIdValue),
      locationName: value['locationName']
        ? String(value['locationName'])
        : value['location_name']
          ? String(value['location_name'])
          : null,
      movementType: String(value['movementType'] ?? value['movement_type'] ?? ''),
      quantity: Number(value['quantity'] ?? 0),
      unitCost:
        unitCostValue === undefined || unitCostValue === null || unitCostValue === ''
          ? null
          : Number(unitCostValue),
      referenceType: String(value['referenceType'] ?? value['reference_type'] ?? ''),
      referenceId:
        referenceIdValue === undefined || referenceIdValue === null || referenceIdValue === ''
          ? null
          : Number(referenceIdValue),
      referenceNo: value['referenceNo']
        ? String(value['referenceNo'])
        : value['reference_no']
          ? String(value['reference_no'])
          : null,
      patientId: value['patientId']
        ? String(value['patientId'])
        : value['patient_id']
          ? String(value['patient_id'])
          : null,
      patientName: value['patientName']
        ? String(value['patientName'])
        : value['patient_name']
          ? String(value['patient_name'])
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

  private mapStockGraphPoint(row: unknown): StockGraphPoint {
    const value = (row || {}) as Record<string, unknown>;

    return {
      productId: Number(value['productId'] ?? value['product_id'] ?? 0),
      productName: String(value['productName'] ?? value['product_name'] ?? ''),
      categoryName: String(value['categoryName'] ?? value['category_name'] ?? 'General'),
      qtyOnHand: Number(value['qtyOnHand'] ?? value['qty_on_hand'] ?? 0)
    };
  }

  private getStockGraphFallback(limit: number): Observable<StockGraphPoint[]> {
    const pageSize = 100;
    const buildParams = (page: number) =>
      new HttpParams()
        .set('page', String(page))
        .set('limit', String(pageSize));

    return this.http
      .get<ProductsSnapshotResponse>(`${this.BASE_URL}/products`, { params: buildParams(1) })
      .pipe(
        switchMap(firstPage => {
          const firstRows = Array.isArray(firstPage?.products) ? firstPage.products : [];
          const total = Number(firstPage?.total ?? firstRows.length);
          const totalPages = Math.max(1, Math.ceil(total / pageSize));

          if (totalPages === 1) {
            return of(this.mapProductsToStockGraph(firstRows, limit));
          }

          const pageRequests = Array.from({ length: totalPages - 1 }, (_value, index) =>
            this.http.get<ProductsSnapshotResponse>(`${this.BASE_URL}/products`, {
              params: buildParams(index + 2)
            })
          );

          return forkJoin(pageRequests).pipe(
            map(remainingPages => {
              const remainingRows = remainingPages.flatMap(page =>
                Array.isArray(page?.products) ? page.products : []
              );
              return this.mapProductsToStockGraph([...firstRows, ...remainingRows], limit);
            })
          );
        })
      );
  }

  private mapProductsToStockGraph(rows: unknown[], limit: number): StockGraphPoint[] {
    return rows
      .map(row => {
        const value = (row || {}) as Record<string, unknown>;
        const category = (value['category'] || {}) as Record<string, unknown>;

        return {
          productId: Number(value['id'] ?? 0),
          productName: String(value['name'] ?? ''),
          categoryName: String(value['categoryName'] ?? value['category_name'] ?? category['name'] ?? 'General'),
          qtyOnHand: Number(value['qtyOnHand'] ?? value['qty_on_hand'] ?? 0)
        };
      })
      .sort((left, right) => {
        if (right.qtyOnHand !== left.qtyOnHand) {
          return right.qtyOnHand - left.qtyOnHand;
        }
        return left.productName.localeCompare(right.productName);
      })
      .slice(0, limit);
  }
}
