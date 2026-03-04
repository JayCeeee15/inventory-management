import { Routes } from '@angular/router';
import { LoginComponent } from './features/auth/login/login.component';
import { authGuard } from './core/guards/auth.guard';
import { navigationDelayGuard } from './core/guards/navigation-delay.guard';

export const routes: Routes = [
  {
    path: '',
    canActivate: [navigationDelayGuard],
    loadComponent: () => import('./features/home/home.component').then(m => m.HomeComponent)
  },
  {
    path: 'about',
    canActivate: [navigationDelayGuard],
    loadComponent: () => import('./features/about/about.component').then(m => m.AboutComponent)
  },
  {
    path: 'signup',
    canActivate: [navigationDelayGuard],
    loadComponent: () => import('./features/auth/signup/signup.component').then(m => m.SignupComponent)
  },
  {
    path: 'login',
    canActivate: [navigationDelayGuard],
    component: LoginComponent
  },
  {
    path: 'dashboard',
    canActivate: [authGuard, navigationDelayGuard],
    loadComponent: () => import('./features/dashboard/dashboard.component').then(m => m.DashboardComponent)
  },
  {
    path: 'employee-dashboard',
    canActivate: [authGuard, navigationDelayGuard],
    loadComponent: () =>
      import('./features/employee-dashboard/employee-dashboard.component').then(
        m => m.EmployeeDashboardComponent
      )
  },
  {
    path: 'transactions/walk-in',
    canActivate: [authGuard, navigationDelayGuard],
    loadComponent: () =>
      import('./features/transactions/walk-in-sale/walk-in-sale.component').then(m => m.WalkInSaleComponent)
  },
  {
    path: 'transactions/patient-issue',
    canActivate: [authGuard, navigationDelayGuard],
    loadComponent: () =>
      import('./features/transactions/patient-issue/patient-issue.component').then(m => m.PatientIssueComponent)
  },
  {
    path: 'transactions/history',
    canActivate: [authGuard, navigationDelayGuard],
    loadComponent: () =>
      import('./features/transactions/transaction-history/transaction-history.component').then(
        m => m.TransactionHistoryComponent
      )
  },
  {
    path: 'products',
    canActivate: [authGuard, navigationDelayGuard],
    loadComponent: () =>
      import('./features/products/product-list/product-list.component').then(m => m.ProductListComponent)
  },
  {
    path: 'products/new',
    canActivate: [authGuard, navigationDelayGuard],
    loadComponent: () =>
      import('./features/products/product-form/product-form.component').then(m => m.ProductFormComponent)
  },
  {
    path: 'products/edit/:id',
    canActivate: [authGuard, navigationDelayGuard],
    loadComponent: () =>
      import('./features/products/product-form/product-form.component').then(m => m.ProductFormComponent)
  },
  {
    path: 'categories',
    canActivate: [authGuard, navigationDelayGuard],
    loadComponent: () =>
      import('./features/categories/category-list/category-list.component').then(m => m.CategoryListComponent)
  },
  {
    path: 'categories/new',
    canActivate: [authGuard, navigationDelayGuard],
    loadComponent: () =>
      import('./features/categories/category-form/category-form.component').then(m => m.CategoryFormComponent)
  },
  {
    path: 'categories/edit/:id',
    canActivate: [authGuard, navigationDelayGuard],
    loadComponent: () =>
      import('./features/categories/category-form/category-form.component').then(m => m.CategoryFormComponent)
  },
  {
    path: '**',
    redirectTo: ''
  }
];
