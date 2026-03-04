import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { finalize, forkJoin } from 'rxjs';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { AuthService } from '../../core/services/auth.service';
import { InventoryService, StockMovement } from '../../core/services/inventory.service';
import { ProductService } from '../../core/services/product.service';
import { Product } from '../../shared/models/product.model';
import { WalkInSaleComponent } from '../transactions/walk-in-sale/walk-in-sale.component';
import { PatientIssueComponent } from '../transactions/patient-issue/patient-issue.component';
import { TransactionHistoryComponent } from '../transactions/transaction-history/transaction-history.component';
import { ProductListComponent } from '../products/product-list/product-list.component';
import { ProductFormComponent } from '../products/product-form/product-form.component';
import { CategoryListComponent } from '../categories/category-list/category-list.component';
import { CategoryFormComponent } from '../categories/category-form/category-form.component';

interface ActivityItem {
  action: string;
  detail: string;
  time: string;
}

interface ProductItem {
  id: number;
  name: string;
  category: string;
  quantity: number;
  price: number;
  dateAdded: string;
}

interface CalendarDay {
  value: number;
  date: Date;
  inCurrentMonth: boolean;
  isToday: boolean;
  stockTotal: number;
  products: ProductItem[];
}

type RangeMode = 'day' | 'week' | 'month';

type AdminSection =
  | 'overview'
  | 'products'
  | 'productCreate'
  | 'productEdit'
  | 'categories'
  | 'categoryCreate'
  | 'categoryEdit'
  | 'walkin'
  | 'issue'
  | 'history';

interface RangeProductSummary {
  name: string;
  total: number;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatButtonModule,
    WalkInSaleComponent,
    PatientIssueComponent,
    TransactionHistoryComponent,
    ProductListComponent,
    ProductFormComponent,
    CategoryListComponent,
    CategoryFormComponent
  ],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.css']
})
export class DashboardComponent implements OnInit {
  loading = false;
  errorMessage = '';

  sideNavOpen = true;
  activeSection: AdminSection = 'overview';
  selectedProductId: number | null = null;
  selectedCategoryId: number | null = null;

  displayName = 'Administrator';
  roleLabel = 'Admin';
  avatarInitials = 'AD';

  readonly todayLabel = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  }).format(new Date());

  readonly navItems = [
    { icon: 'home', label: 'Overview', section: 'overview' as const, helper: 'System snapshot and stock calendar' },
    { icon: 'inventory_2', label: 'Item Master', section: 'products' as const, helper: 'View, edit, and archive items' },
    { icon: 'add_box', label: 'Add Item', section: 'productCreate' as const, helper: 'Create a new inventory item' },
    {
      icon: 'category',
      label: 'Categories',
      section: 'categories' as const,
      helper: 'Maintain category and location groups'
    },
    { icon: 'playlist_add', label: 'Add Category', section: 'categoryCreate' as const, helper: 'Create new category records' },
    { icon: 'point_of_sale', label: 'Walk-in Sale', section: 'walkin' as const, helper: 'Process counter transactions' },
    { icon: 'medication', label: 'Patient Issue', section: 'issue' as const, helper: 'Dispense to patients and units' },
    {
      icon: 'history',
      label: 'Transaction History',
      section: 'history' as const,
      helper: 'Audit stock movements and exports'
    }
  ] as const;

  readonly quickActions = [
    {
      title: 'Create Inventory Item',
      subtitle: 'Register a new medicine, supply, or equipment record',
      section: 'productCreate' as const
    },
    {
      title: 'Create Category',
      subtitle: 'Set up a new stock classification for products',
      section: 'categoryCreate' as const
    },
    {
      title: 'Review Transaction History',
      subtitle: 'Filter and export movement logs for auditing',
      section: 'history' as const
    }
  ] as const;

  totalItems = 0;
  lowStockItems = 0;
  totalCategories = 0;

  recentProducts: ProductItem[] = [];
  recentActivities: ActivityItem[] = [];

  activityPageSize = 3;
  currentActivityPage = 1;

  weekdayHeaders = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  monthLabel = '';
  calendarWeeks: CalendarDay[][] = [];

  selectedRange: RangeMode = 'day';
  selectedDate = new Date();
  rangeLabel = '';
  rangeStockTotal = 0;
  rangeProductSummary: RangeProductSummary[] = [];

  private viewedMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  constructor(
    private authService: AuthService,
    private productService: ProductService,
    private inventoryService: InventoryService
  ) {}

  ngOnInit(): void {
    this.applyCurrentUserProfile();
    this.loadDashboardData();
  }

  get paginatedActivities(): ActivityItem[] {
    const start = (this.currentActivityPage - 1) * this.activityPageSize;
    return this.recentActivities.slice(start, start + this.activityPageSize);
  }

  get totalActivityPages(): number {
    return Math.max(1, Math.ceil(this.recentActivities.length / this.activityPageSize));
  }

  toggleSideNav(): void {
    this.sideNavOpen = !this.sideNavOpen;
  }

  switchSection(section: AdminSection): void {
    this.activeSection = section;
  }

  openProductCreate(): void {
    this.selectedProductId = null;
    this.switchSection('productCreate');
  }

  openProductEdit(productId: number): void {
    this.selectedProductId = productId;
    this.switchSection('productEdit');
  }

  openCategoryCreate(): void {
    this.selectedCategoryId = null;
    this.switchSection('categoryCreate');
  }

  openCategoryEdit(categoryId: number): void {
    this.selectedCategoryId = categoryId;
    this.switchSection('categoryEdit');
  }

  onProductFormCompleted(): void {
    this.selectedProductId = null;
    this.switchSection('products');
  }

  onCategoryFormCompleted(): void {
    this.selectedCategoryId = null;
    this.switchSection('categories');
  }

  prevActivityPage(): void {
    if (this.currentActivityPage > 1) {
      this.currentActivityPage--;
    }
  }

  nextActivityPage(): void {
    if (this.currentActivityPage < this.totalActivityPages) {
      this.currentActivityPage++;
    }
  }

  logout(): void {
    this.authService.logout();
  }

  prevMonth(): void {
    this.viewedMonth = new Date(this.viewedMonth.getFullYear(), this.viewedMonth.getMonth() - 1, 1);
    this.selectedDate = new Date(this.viewedMonth.getFullYear(), this.viewedMonth.getMonth(), 1);
    this.buildCalendar(this.viewedMonth);
    this.updateRangeMetrics();
  }

  nextMonth(): void {
    this.viewedMonth = new Date(this.viewedMonth.getFullYear(), this.viewedMonth.getMonth() + 1, 1);
    this.selectedDate = new Date(this.viewedMonth.getFullYear(), this.viewedMonth.getMonth(), 1);
    this.buildCalendar(this.viewedMonth);
    this.updateRangeMetrics();
  }

  setRange(mode: RangeMode): void {
    this.selectedRange = mode;
    this.updateRangeMetrics();
  }

  selectDay(day: CalendarDay): void {
    this.selectedDate = new Date(day.date);
    this.selectedRange = 'day';

    if (!day.inCurrentMonth) {
      this.viewedMonth = new Date(day.date.getFullYear(), day.date.getMonth(), 1);
      this.buildCalendar(this.viewedMonth);
    }

    this.updateRangeMetrics();
  }

  private applyCurrentUserProfile(): void {
    const currentUser = this.authService.currentUser();
    if (!currentUser) {
      return;
    }

    const username = currentUser.username?.trim() || 'admin';
    const fullName = currentUser.fullName?.trim() || username;

    this.displayName = fullName;
    this.roleLabel = currentUser.role === 'admin' ? 'Administrator' : 'Employee';

    const initials = fullName
      .split(/\s+/)
      .map(part => part[0] || '')
      .join('')
      .slice(0, 2)
      .toUpperCase();

    this.avatarInitials = initials || fullName.slice(0, 2).toUpperCase();
  }

  private loadDashboardData(): void {
    this.loading = true;
    this.errorMessage = '';

    forkJoin({
      summary: this.inventoryService.getDashboardSummary(),
      products: this.productService.getAll({ limit: 200 }),
      movements: this.inventoryService.getStockMovements({ limit: 120 })
    })
      .pipe(finalize(() => (this.loading = false)))
      .subscribe({
        next: ({ summary, products, movements }) => {
          this.totalItems = summary.totalProducts;
          this.lowStockItems = summary.lowStockItems;
          this.totalCategories = summary.totalCategories;

          this.recentActivities = this.mapActivities(movements);
          this.recentProducts = this.mapCalendarItems(products, movements);

          this.currentActivityPage = 1;
          this.buildCalendar(this.viewedMonth);
          this.updateRangeMetrics();
        },
        error: () => {
          this.errorMessage = 'Failed to load dashboard data from API.';
          this.recentActivities = [];
          this.recentProducts = [];
          this.buildCalendar(this.viewedMonth);
          this.updateRangeMetrics();
        }
      });
  }

  private mapActivities(movements: StockMovement[]): ActivityItem[] {
    return movements.slice(0, 36).map(movement => {
      const quantity = Math.abs(movement.quantity);
      const location = movement.locationName ? ` at ${movement.locationName}` : '';

      return {
        action: this.getMovementAction(movement.movementType),
        detail: `${movement.productName} ${quantity} units${location}`,
        time: this.formatRelativeTime(movement.createdAt)
      };
    });
  }

  private mapCalendarItems(products: Product[], movements: StockMovement[]): ProductItem[] {
    const productsById = new Map<number, Product>(products.map(product => [product.id, product]));

    return movements.map((movement, index) => {
      const linkedProduct = productsById.get(movement.productId);
      const fallbackCategory = movement.locationName || 'General';

      return {
        id: movement.id || movement.productId || index + 1,
        name: movement.productName,
        category: linkedProduct?.categoryName || fallbackCategory,
        quantity: Math.abs(movement.quantity),
        price: movement.unitCost ?? linkedProduct?.price ?? 0,
        dateAdded: this.toIsoDate(movement.createdAt)
      };
    });
  }

  private getMovementAction(movementType: string): string {
    const normalizedType = movementType.toUpperCase();

    if (normalizedType === 'RECEIVE') {
      return 'Stock received';
    }
    if (normalizedType === 'SALE_WALKIN') {
      return 'Walk-in sale';
    }
    if (normalizedType === 'SALE_ONLINE') {
      return 'Online sale';
    }
    if (normalizedType === 'PATIENT_ISSUE') {
      return 'Patient issue';
    }
    if (normalizedType === 'ADJUSTMENT_IN' || normalizedType === 'ADJUSTMENT_OUT') {
      return 'Stock adjustment';
    }

    return 'Stock movement';
  }

  private formatRelativeTime(isoDate: string): string {
    const date = new Date(isoDate);
    if (Number.isNaN(date.getTime())) {
      return 'Unknown time';
    }

    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMinutes = Math.floor(diffMs / 60000);

    if (diffMinutes < 1) {
      return 'Just now';
    }

    if (diffMinutes < 60) {
      return `${diffMinutes} min ago`;
    }

    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) {
      return `${diffHours} hr ago`;
    }

    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) {
      return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    }

    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  private toIsoDate(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      const today = new Date();
      const todayMonth = String(today.getMonth() + 1).padStart(2, '0');
      const todayDay = String(today.getDate()).padStart(2, '0');
      return `${today.getFullYear()}-${todayMonth}-${todayDay}`;
    }

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private buildCalendar(referenceMonth: Date): void {
    const year = referenceMonth.getFullYear();
    const month = referenceMonth.getMonth();

    this.monthLabel = referenceMonth.toLocaleString('en-US', {
      month: 'long',
      year: 'numeric'
    });

    const monthStart = new Date(year, month, 1);
    const firstVisibleDate = new Date(monthStart);
    firstVisibleDate.setDate(1 - monthStart.getDay());

    const today = new Date();
    const days: CalendarDay[] = [];

    for (let i = 0; i < 42; i++) {
      const date = new Date(firstVisibleDate);
      date.setDate(firstVisibleDate.getDate() + i);

      const products = this.getProductsByDate(date);
      const stockTotal = products.reduce((sum, product) => sum + product.quantity, 0);

      days.push({
        value: date.getDate(),
        date,
        inCurrentMonth: date.getMonth() === month,
        isToday: this.isSameDay(date, today),
        stockTotal,
        products
      });
    }

    this.calendarWeeks = [];
    for (let i = 0; i < days.length; i += 7) {
      this.calendarWeeks.push(days.slice(i, i + 7));
    }
  }

  private updateRangeMetrics(): void {
    const { start, end } = this.getRangeBounds(this.selectedDate, this.selectedRange);

    const rangeProducts = this.recentProducts.filter(product => {
      const productDate = this.parseISODate(product.dateAdded);
      return productDate >= start && productDate <= end;
    });

    this.rangeStockTotal = rangeProducts.reduce((sum, product) => sum + product.quantity, 0);

    const summaryMap = new Map<string, number>();
    for (const product of rangeProducts) {
      summaryMap.set(product.name, (summaryMap.get(product.name) ?? 0) + product.quantity);
    }

    this.rangeProductSummary = Array.from(summaryMap.entries())
      .map(([name, total]) => ({ name, total }))
      .sort((a, b) => b.total - a.total);

    this.rangeLabel = this.formatRangeLabel(start, end, this.selectedRange);
  }

  private getRangeBounds(anchorDate: Date, mode: RangeMode): { start: Date; end: Date } {
    const date = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), anchorDate.getDate());

    if (mode === 'day') {
      return { start: date, end: date };
    }

    if (mode === 'week') {
      const start = new Date(date);
      start.setDate(date.getDate() - date.getDay());
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      return { start, end };
    }

    const start = new Date(date.getFullYear(), date.getMonth(), 1);
    const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    return { start, end };
  }

  private formatRangeLabel(start: Date, end: Date, mode: RangeMode): string {
    const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };

    if (mode === 'day') {
      return start.toLocaleDateString('en-US', opts);
    }

    if (mode === 'week') {
      return `${start.toLocaleDateString('en-US', opts)} - ${end.toLocaleDateString('en-US', opts)}`;
    }

    return start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }

  private getProductsByDate(targetDate: Date): ProductItem[] {
    return this.recentProducts.filter(product => this.isSameDay(this.parseISODate(product.dateAdded), targetDate));
  }

  private isSameDay(a: Date, b: Date): boolean {
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
  }

  private parseISODate(value: string): Date {
    return new Date(`${value}T00:00:00`);
  }
}
