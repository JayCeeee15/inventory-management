import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize, forkJoin } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { AuthService } from '../../core/services/auth.service';
import { InventoryService, StockMovement } from '../../core/services/inventory.service';
import { WalkInSaleComponent } from '../transactions/walk-in-sale/walk-in-sale.component';
import { PatientIssueComponent } from '../transactions/patient-issue/patient-issue.component';
import { TransactionHistoryComponent } from '../transactions/transaction-history/transaction-history.component';
import { ProductListComponent } from '../products/product-list/product-list.component';
import { CategoryListComponent } from '../categories/category-list/category-list.component';

type EmployeeSection = 'overview' | 'walkin' | 'issue' | 'history' | 'products' | 'categories';

@Component({
  selector: 'app-employee-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    WalkInSaleComponent,
    PatientIssueComponent,
    TransactionHistoryComponent,
    ProductListComponent,
    CategoryListComponent
  ],
  templateUrl: './employee-dashboard.component.html',
  styleUrls: ['./employee-dashboard.component.css']
})
export class EmployeeDashboardComponent implements OnInit {
  loading = false;
  errorMessage = '';
  sideNavOpen = true;
  activeSection: EmployeeSection = 'overview';

  readonly todayLabel = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  }).format(new Date());

  readonly navItems = [
    { icon: 'home', label: 'Overview', section: 'overview' as const, helper: 'Daily stock status' },
    { icon: 'point_of_sale', label: 'Walk-in Sale', section: 'walkin' as const, helper: 'Process patient purchases' },
    { icon: 'medication', label: 'Patient Issue', section: 'issue' as const, helper: 'Issue stock to departments' },
    { icon: 'history', label: 'History', section: 'history' as const, helper: 'Search and export transactions' },
    { icon: 'inventory_2', label: 'Item Master', section: 'products' as const, helper: 'View product records' },
    { icon: 'category', label: 'Categories', section: 'categories' as const, helper: 'Manage item groups' }
  ] as const;

  readonly quickActions = [
    {
      title: 'Create Walk-in Sale',
      subtitle: 'Deduct stock for in-person patient purchases',
      section: 'walkin' as const
    },
    {
      title: 'Issue to Patient',
      subtitle: 'Record dispensing to patient or department',
      section: 'issue' as const
    },
    {
      title: 'Open Transaction History',
      subtitle: 'Filter by date, type, product, and location',
      section: 'history' as const
    }
  ] as const;

  displayName = 'Staff Member';
  roleLabel = 'Employee';
  avatarInitials = 'ST';
  accountUsername = '';
  accountEmail = '';

  profileEditorOpen = false;
  profileSaving = false;
  profileErrorMessage = '';
  profileSuccessMessage = '';

  totalProducts = 0;
  lowStockItems = 0;
  weeklyMovements = 0;
  totalCategories = 0;
  recentMovements: StockMovement[] = [];

  readonly profileForm: FormGroup<{
    fullName: FormControl<string>;
    email: FormControl<string>;
    username: FormControl<string>;
  }>;

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private inventoryService: InventoryService
  ) {
    this.profileForm = this.fb.nonNullable.group({
      fullName: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(120)]],
      email: ['', [Validators.required, Validators.email, Validators.maxLength(120)]],
      username: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(50)]]
    });
  }

  ngOnInit(): void {
    this.applyCurrentUserProfile();
    this.loadDashboardData();
  }

  toggleSideNav(): void {
    this.sideNavOpen = !this.sideNavOpen;
  }

  switchSection(section: EmployeeSection): void {
    this.activeSection = section;
  }

  openProfileEditor(): void {
    this.fillProfileFormFromCurrentUser();
    this.profileErrorMessage = '';
    this.profileSuccessMessage = '';
    this.profileEditorOpen = true;
  }

  closeProfileEditor(): void {
    this.profileEditorOpen = false;
    this.profileSaving = false;
    this.profileErrorMessage = '';
    this.profileSuccessMessage = '';
  }

  saveProfile(): void {
    if (this.profileForm.invalid || this.profileSaving) {
      this.profileForm.markAllAsTouched();
      return;
    }

    this.profileSaving = true;
    this.profileErrorMessage = '';
    this.profileSuccessMessage = '';

    const raw = this.profileForm.getRawValue();
    this.authService
      .updateProfile({
        fullName: raw.fullName,
        email: raw.email,
        username: raw.username
      })
      .pipe(finalize(() => (this.profileSaving = false)))
      .subscribe({
        next: () => {
          this.applyCurrentUserProfile();
          this.fillProfileFormFromCurrentUser();
          this.profileSuccessMessage = 'Profile updated successfully.';
        },
        error: (error: unknown) => {
          const code = error instanceof Error ? error.message : '';
          if (code === 'USERNAME_EXISTS') {
            this.profileErrorMessage = 'Username is already in use.';
            return;
          }
          if (code === 'EMAIL_EXISTS') {
            this.profileErrorMessage = 'Email is already in use.';
            return;
          }
          if (code === 'INVALID_PROFILE') {
            this.profileErrorMessage = 'Please provide valid full name, email, and username.';
            return;
          }

          this.profileErrorMessage = 'Unable to update profile right now. Please try again.';
        }
      });
  }

  logout(): void {
    this.authService.logout();
  }

  formatMovementType(value: string): string {
    const normalized = value.trim().toUpperCase();
    if (normalized === 'SALE_WALKIN') {
      return 'Walk-in Sale';
    }
    if (normalized === 'SALE_ONLINE') {
      return 'Online Sale';
    }
    if (normalized === 'PATIENT_ISSUE') {
      return 'Patient Issue';
    }
    if (normalized === 'ADJUSTMENT_IN') {
      return 'Adjustment In';
    }
    if (normalized === 'ADJUSTMENT_OUT') {
      return 'Adjustment Out';
    }
    if (normalized === 'RECEIVE') {
      return 'Stock Receive';
    }
    return normalized.replace(/_/g, ' ');
  }

  formatRelativeTime(isoDate: string): string {
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

  trackByMovementId(_index: number, movement: StockMovement): number {
    return movement.id;
  }

  private applyCurrentUserProfile(): void {
    const currentUser = this.authService.currentUser();
    if (!currentUser) {
      return;
    }

    const username = currentUser.username?.trim() || 'staff';
    const fullName = currentUser.fullName?.trim() || username;
    this.displayName = fullName;
    this.roleLabel = currentUser.role === 'admin' ? 'Administrator' : 'Employee';
    this.accountUsername = username;
    this.accountEmail = currentUser.email?.trim() || '';

    const initials = fullName
      .split(/\s+/)
      .map(part => part[0] || '')
      .join('')
      .slice(0, 2)
      .toUpperCase();
    this.avatarInitials = initials || fullName.slice(0, 2).toUpperCase();
  }

  private fillProfileFormFromCurrentUser(): void {
    const currentUser = this.authService.currentUser();
    if (!currentUser) {
      return;
    }

    this.profileForm.setValue({
      fullName: currentUser.fullName?.trim() || currentUser.username?.trim() || '',
      email: currentUser.email?.trim() || '',
      username: currentUser.username?.trim() || ''
    });
  }

  private loadDashboardData(): void {
    this.loading = true;
    this.errorMessage = '';

    forkJoin({
      summary: this.inventoryService.getDashboardSummary(),
      movements: this.inventoryService.getStockMovements({ limit: 6 })
    })
      .pipe(finalize(() => (this.loading = false)))
      .subscribe({
        next: ({ summary, movements }) => {
          this.totalProducts = summary.totalProducts;
          this.lowStockItems = summary.lowStockItems;
          this.weeklyMovements = summary.stockMovementsLast7Days;
          this.totalCategories = summary.totalCategories;
          this.recentMovements = movements;
        },
        error: () => {
          this.errorMessage = 'Failed to load employee dashboard data.';
          this.totalProducts = 0;
          this.lowStockItems = 0;
          this.weeklyMovements = 0;
          this.totalCategories = 0;
          this.recentMovements = [];
        }
      });
  }
}
