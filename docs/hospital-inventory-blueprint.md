# Hospital Inventory Management Blueprint (Angular)

This project is now aligned to a **Hospital Inventory Management System** direction.
Use this file as the implementation spec for the next development phases.

## 1) App structure

### Recommended workspace layout

```text
src/
  app/
    core/
      guards/
      interceptors/
      services/
      directives/
    shared/
      components/
      directives/
      pipes/
      models/
    layouts/
      admin-layout/
      auth-layout/
    features/
      auth/
      dashboard/
      item-master/
      locations/
      suppliers/
      purchasing/
      receiving/
      stock-management/
      requisitions/
      stock-count/
      reports/
      administration/
```

### Routing strategy

- Use `loadComponent`/`loadChildren` lazy loading per feature.
- Keep admin features under one protected layout route.
- Attach route metadata:
  - `data.permission`
  - `data.auditContext`
  - `data.breadcrumb`

### State management recommendation

- Recommended approach for this codebase: **Angular Signals + service facades**.
- Why:
  - Existing app already uses signals in services.
  - Lower complexity than NgRx for current size.
  - Easy incremental migration.
- Move to NgRx only if you need:
  - Complex cross-module workflows.
  - Offline queueing.
  - Time-travel debugging.

### Auth strategy

- JWT access token + refresh token.
- Store access token in memory/session and refresh token in secure HTTP-only cookie.
- Use interceptors for:
  - Bearer token injection.
  - 401 refresh-and-retry once.
- Keep user claims:
  - `sub`, `username`, `roles`, `permissions`, `locationScope`.

## 2) Core modules (screens, routes, components)

## Auth

- Routes:
  - `/login`
  - `/forgot-password`
- Components:
  - `LoginComponent`
  - `ForgotPasswordComponent`
- Wireframe:
  - Header logo + system title
  - Credential form
  - Forgot password link
- Forms:
  - Login: username, password
  - Forgot password: email
- Validation:
  - Required fields
  - Email format
  - Account lock message on repeated failure

## Dashboard

- Routes:
  - `/dashboard`
- Components:
  - `DashboardComponent`
  - `KpiCardComponent`
  - `AlertsPanelComponent`
- Wireframe:
  - Top KPI cards
  - Expiring soon panel
  - Stockout risk panel
  - Recent movement timeline
- Main data tiles:
  - total SKUs, low stock count, expiring in 30 days, pending requisitions

## Item Master

- Routes:
  - `/items`
  - `/items/new`
  - `/items/:id/edit`
- Components:
  - `ItemListComponent`
  - `ItemFormComponent`
  - `ItemDetailComponent`
- Forms:
  - code, name, category, unit, barcode, controlled flag, min/max/reorder
- Table columns:
  - code, name, category, unit, controlled, stock on hand, status, actions
- Validation:
  - unique code
  - required name/category/unit
  - min <= reorder <= max

## Warehouse/Location

- Routes:
  - `/locations`
  - `/locations/new`
  - `/locations/:id/edit`
- Components:
  - `LocationListComponent`
  - `LocationFormComponent`
- Forms:
  - code, name, type, parent location, active
- Table columns:
  - code, name, type, parent, active
- Validation:
  - unique code
  - valid parent only for bins/departments

## Suppliers

- Routes:
  - `/suppliers`
  - `/suppliers/new`
  - `/suppliers/:id/edit`
- Components:
  - `SupplierListComponent`
  - `SupplierFormComponent`
- Forms:
  - name, contact person, email, phone, address, active
- Table columns:
  - supplier, contact, email, phone, status
- Validation:
  - required name
  - valid email format

## Purchasing

- Routes:
  - `/purchasing/po`
  - `/purchasing/po/new`
  - `/purchasing/po/:id`
- Components:
  - `PurchaseOrderListComponent`
  - `PurchaseOrderFormComponent`
  - `PurchaseOrderDetailComponent`
- Forms:
  - supplier, order date, expected date, items lines, remarks
- Table columns:
  - PO number, supplier, status, order date, expected date, actions
- Validation:
  - at least one line item
  - quantity > 0, cost >= 0

## Receiving (batch/lot + expiry + attachments)

- Routes:
  - `/receiving`
  - `/receiving/new`
  - `/receiving/:id`
- Components:
  - `ReceivingListComponent`
  - `ReceivingFormComponent`
  - `ReceivingDetailComponent`
- Forms:
  - receipt number, PO/supplier, location, received date, attachment
  - line item batch rows: item, lot, expiry, qty, unit cost
- Table columns:
  - receipt no, supplier, date, location, total lines
- Validation:
  - lot number required for controlled items
  - expiry cannot be before received date

## Stock Management

- Routes:
  - `/stock/on-hand`
  - `/stock/transfers`
  - `/stock/returns`
  - `/stock/adjustments`
- Components:
  - `StockOnHandComponent`
  - `TransferFormComponent`
  - `ReturnFormComponent`
  - `AdjustmentFormComponent`
- Forms:
  - transfer source/destination/items
  - return reason and reference
  - adjustment with reason code
- Table columns:
  - item, location, batch, expiry, qty, reserved, available
- Validation:
  - transfer qty <= available qty
  - adjustment reason mandatory

## Requisition / Issuance

- Routes:
  - `/requisitions`
  - `/requisitions/new`
  - `/requisitions/:id`
  - `/issuance/:id/print`
- Components:
  - `RequisitionListComponent`
  - `RequisitionFormComponent`
  - `RequisitionApprovalComponent`
  - `IssuanceSlipComponent`
- Forms:
  - requesting dept, requested items, urgency, notes
- Table columns:
  - request no, department, status, requested by, requested at
- Validation:
  - at least one item
  - approvals required before issuance

## Stock Count (Cycle Count)

- Routes:
  - `/stock-count`
  - `/stock-count/new`
  - `/stock-count/:id/review`
- Components:
  - `StockCountListComponent`
  - `StockCountSheetComponent`
  - `VarianceReviewComponent`
- Forms:
  - location, count date, item lines with system qty vs counted qty
- Table columns:
  - count no, location, status, variance total, posted by
- Validation:
  - cannot post without review status

## Reports

- Routes:
  - `/reports/expiring-soon`
  - `/reports/stockout-risk`
  - `/reports/consumption`
  - `/reports/movement-ledger`
- Components:
  - `ExpiringSoonReportComponent`
  - `StockoutRiskReportComponent`
  - `ConsumptionReportComponent`
  - `MovementLedgerReportComponent`
- Validation:
  - date range required
  - department/location filter validation

## Administration

- Routes:
  - `/admin/users`
  - `/admin/roles`
  - `/admin/audit-trail`
  - `/admin/settings`
- Components:
  - `UserListComponent`
  - `RoleMatrixComponent`
  - `AuditTrailComponent`
  - `SystemSettingsComponent`
- Forms:
  - user profile + role assignment
  - role permissions matrix
  - min/max levels and notification thresholds
- Validation:
  - role and permission consistency
  - required notification configuration

## 3) UI requirements

- UI stack: Angular Material.
- Reusable table requirements:
  - server-side pagination
  - sorting
  - column filters
  - global search
  - empty and loading states
- Reusable modal form:
  - dynamic title
  - submit/cancel slots
  - dirty-state close confirmation
- Use snackbar toasts and confirmation dialogs globally.

## 4) Data models

- Implemented file:
  - `src/app/shared/models/hospital-inventory.models.ts`
- Included interfaces:
  - `Item, Category, Unit, Location, Supplier, PurchaseOrder, Receiving, StockBatch, StockLedger, Requisition, RequisitionApproval, Issuance, StockCount, Adjustment, AuditLog, User, Role, Permission`

## 5) Security & audit

- Route guards:
  - `AuthGuard` for authentication
  - `PermissionGuard` for route-level permission checks
- UI authorization:
  - `HasPermissionDirective` for element-level actions (create/edit/delete/export)
- Audit events to capture:
  - create/update/delete
  - issue/receive/transfer/adjust
  - login/logout
  - export/print

## 6) Implementation snippets

### AuthGuard

```ts
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const authGuard = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.isAuthenticated() ? true : router.parseUrl('/login');
};
```

### PermissionDirective

```ts
import { Directive, Input, TemplateRef, ViewContainerRef, effect, inject } from '@angular/core';
import { AuthService } from '../services/auth.service';

@Directive({
  selector: '[appHasPermission]',
  standalone: true
})
export class HasPermissionDirective {
  private readonly tpl = inject(TemplateRef<unknown>);
  private readonly vcr = inject(ViewContainerRef);
  private readonly auth = inject(AuthService);
  private permissionCode = '';

  @Input({ required: true }) set appHasPermission(value: string) {
    this.permissionCode = value;
    this.render();
  }

  constructor() {
    effect(() => this.render());
  }

  private render(): void {
    const allowed = this.auth.currentUser()?.role === 'admin';
    this.vcr.clear();
    if (allowed || this.permissionCode.length === 0) {
      this.vcr.createEmbeddedView(this.tpl);
    }
  }
}
```

### ReusableTableComponent (server-side)

```ts
export interface TableQuery {
  pageIndex: number;
  pageSize: number;
  sortField?: string;
  sortDirection?: 'asc' | 'desc';
  search?: string;
  filters?: Record<string, string | number | boolean>;
}

export interface TablePage<T> {
  items: T[];
  total: number;
}
```

### Receiving form (batch + expiry)

```ts
this.form = this.fb.group({
  receiptNumber: ['', Validators.required],
  supplierId: [null, Validators.required],
  locationId: [null, Validators.required],
  receivedDate: ['', Validators.required],
  lines: this.fb.array([
    this.fb.group({
      itemId: [null, Validators.required],
      lotNumber: ['', Validators.required],
      expiryDate: ['', Validators.required],
      quantity: [0, [Validators.required, Validators.min(1)]],
      unitCost: [0, [Validators.required, Validators.min(0)]]
    })
  ])
});
```

### Stock ledger viewer page query

```ts
loadLedger(itemId: number, locationId: number, start: string, end: string): void {
  const params = { itemId, locationId, start, end, page: 1, pageSize: 20 };
  this.stockService.getLedger(params).subscribe(page => {
    this.rows = page.items;
    this.total = page.total;
  });
}
```

