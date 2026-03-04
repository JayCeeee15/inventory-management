export type StockMovementType =
  | 'receive'
  | 'issue'
  | 'transfer_in'
  | 'transfer_out'
  | 'return'
  | 'adjustment';

export interface Item {
  id: number;
  code: string;
  name: string;
  categoryId: number;
  unitId: number;
  barcode?: string;
  controlled: boolean;
  minLevel: number;
  maxLevel: number;
  reorderPoint: number;
  active: boolean;
}

export interface Category {
  id: number;
  name: string;
  description?: string;
}

export interface Unit {
  id: number;
  code: string;
  name: string;
}

export interface Location {
  id: number;
  code: string;
  name: string;
  type: 'warehouse' | 'department' | 'bin';
  parentLocationId?: number;
  active: boolean;
}

export interface Supplier {
  id: number;
  name: string;
  contactPerson?: string;
  email?: string;
  phone?: string;
  address?: string;
  active: boolean;
}

export interface PurchaseOrder {
  id: number;
  poNumber: string;
  supplierId: number;
  status: 'draft' | 'approved' | 'partial' | 'received' | 'cancelled';
  orderDate: string;
  expectedDate?: string;
  remarks?: string;
}

export interface Receiving {
  id: number;
  receiptNumber: string;
  purchaseOrderId?: number;
  supplierId: number;
  locationId: number;
  receivedDate: string;
  attachmentUrl?: string;
}

export interface StockBatch {
  id: number;
  itemId: number;
  locationId: number;
  lotNumber: string;
  expiryDate?: string;
  quantityOnHand: number;
  unitCost: number;
  receivedDate: string;
}

export interface StockLedger {
  id: number;
  itemId: number;
  locationId: number;
  movementType: StockMovementType;
  referenceType: 'receiving' | 'requisition' | 'transfer' | 'adjustment' | 'return' | 'manual';
  referenceId: number;
  quantityIn: number;
  quantityOut: number;
  balanceAfter: number;
  movedAt: string;
  movedByUserId: number;
}

export interface Requisition {
  id: number;
  requestNumber: string;
  fromDepartmentId: number;
  toLocationId: number;
  status: 'draft' | 'submitted' | 'approved' | 'issued' | 'rejected' | 'cancelled';
  requestedByUserId: number;
  requestedAt: string;
  remarks?: string;
}

export interface RequisitionApproval {
  id: number;
  requisitionId: number;
  approverUserId: number;
  status: 'pending' | 'approved' | 'rejected';
  decisionAt?: string;
  comments?: string;
}

export interface Issuance {
  id: number;
  issueNumber: string;
  requisitionId: number;
  issuedByUserId: number;
  issuedAt: string;
  notes?: string;
}

export interface StockCount {
  id: number;
  countNumber: string;
  locationId: number;
  countDate: string;
  status: 'draft' | 'in_review' | 'posted';
  varianceTotal: number;
}

export interface Adjustment {
  id: number;
  itemId: number;
  locationId: number;
  quantityDelta: number;
  reasonCode: string;
  remarks?: string;
  adjustedByUserId: number;
  adjustedAt: string;
}

export interface AuditLog {
  id: number;
  eventType:
    | 'create'
    | 'update'
    | 'delete'
    | 'issue'
    | 'receive'
    | 'transfer'
    | 'adjust'
    | 'login'
    | 'logout'
    | 'export'
    | 'print';
  entityType: string;
  entityId?: number;
  actorUserId: number;
  actionAt: string;
  metadata?: Record<string, unknown>;
}

export interface User {
  id: number;
  username: string;
  fullName: string;
  email: string;
  roleIds: number[];
  active: boolean;
}

export interface Role {
  id: number;
  code: string;
  name: string;
  permissionIds: number[];
}

export interface Permission {
  id: number;
  code: string;
  name: string;
  description?: string;
}
