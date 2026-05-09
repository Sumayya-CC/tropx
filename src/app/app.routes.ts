import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { roleGuard } from './core/guards/role.guard';

export const routes: Routes = [
  // ── Public ──────────────────────────────────────────────────────────────
  {
    path: '',
    loadComponent: () =>
      import('./features/public/home/home.component').then(m => m.HomeComponent),
  },
  {
    path: 'login',
    loadComponent: () =>
      import('./features/public/login/login.component').then(m => m.LoginComponent),
  },
  {
    path: 'forgot-password',
    loadComponent: () =>
      import('./features/public/forgot-password/forgot-password.component').then(
        m => m.ForgotPasswordComponent
      ),
  },
  {
    path: 'request-access',
    loadComponent: () =>
      import('./features/public/request-access/request-access.component').then(
        m => m.RequestAccessComponent
      ),
  },

  // ── Customer (auth required, role: customer) ─────────────────────────
  {
    path: 'customer',
    canActivate: [authGuard],
    canActivateChild: [roleGuard],
    data: { roles: ['customer'] },
    children: [
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./features/customer/dashboard/customer-dashboard.component').then(
            m => m.CustomerDashboardComponent
          ),
      },
      {
        path: 'catalog',
        loadComponent: () =>
          import('./features/customer/catalog/catalog.component').then(m => m.CatalogComponent),
      },
      {
        path: 'cart',
        loadComponent: () =>
          import('./features/customer/cart/cart.component').then(m => m.CartComponent),
      },
      {
        path: 'orders',
        loadComponent: () =>
          import('./features/customer/orders/customer-orders.component').then(
            m => m.CustomerOrdersComponent
          ),
      },
      {
        path: 'orders/:id',
        loadComponent: () =>
          import('./features/customer/order-detail/order-detail.component').then(
            m => m.OrderDetailComponent
          ),
      },
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
    ],
  },

  // ── Admin (auth required, role: admin | employee) ───────────────────
  {
    path: 'admin',
    loadComponent: () => import('./features/admin/shell/admin-shell.component').then(m => m.AdminShellComponent),
    canActivate: [authGuard],
    canActivateChild: [roleGuard],
    data: { roles: ['admin', 'manager', 'sales_rep', 'warehouse'] },
    children: [
      {
        path: 'dashboard',
        data: { title: 'Dashboard' },
        loadComponent: () =>
          import('./features/admin/dashboard/admin-dashboard.component').then(
            m => m.AdminDashboardComponent
          ),
      },
      {
        path: 'products',
        data: { title: 'Products' },
        loadComponent: () =>
          import('./features/admin/products/admin-products.component').then(
            m => m.AdminProductsComponent
          ),
      },
      {
        path: 'categories',
        data: { title: 'Categories' },
        loadComponent: () =>
          import('./features/admin/categories/admin-categories.component').then(
            m => m.AdminCategoriesComponent
          ),
      },
      {
        path: 'brands',
        data: { title: 'Brands' },
        loadComponent: () =>
          import('./features/admin/brands/admin-brands.component').then(
            m => m.AdminBrandsComponent
          ),
      },
      {
        path: 'service-areas',
        data: { title: 'Service Areas' },
        loadComponent: () =>
          import('./features/admin/service-areas/admin-service-areas.component').then(
            m => m.AdminServiceAreasComponent
          ),
      },
      {
        path: 'stock-adjustments',
        data: { title: 'Stock Adjustments' },
        loadComponent: () =>
          import('./features/admin/stock-adjustments/admin-stock-adjustments.component').then(
            m => m.AdminStockAdjustmentsComponent
          ),
      },
      {
        path: 'customers',
        data: { title: 'Customers' },
        loadComponent: () =>
          import('./features/admin/customers/admin-customers.component').then(
            m => m.AdminCustomersComponent
          ),
      },
      {
        path: 'access-requests',
        data: { title: 'Access Requests' },
        loadComponent: () =>
          import('./features/admin/access-requests/admin-access-requests.component').then(
            m => m.AdminAccessRequestsComponent
          ),
      },
      {
        path: 'orders',
        data: { title: 'Orders' },
        loadComponent: () =>
          import('./features/admin/orders/admin-orders.component').then(
            m => m.AdminOrdersComponent
          ),
      },
      {
        path: 'payments',
        data: { title: 'Payments' },
        loadComponent: () =>
          import('./features/admin/payments/admin-payments.component').then(
            m => m.AdminPaymentsComponent
          ),
      },
      {
        path: 'employees',
        data: { roles: ['admin'], title: 'Employees' },
        loadComponent: () =>
          import('./features/admin/employees/admin-employees.component').then(
            m => m.AdminEmployeesComponent
          ),
      },
      {
        path: 'content',
        data: { roles: ['admin'], title: 'Content' },
        loadComponent: () =>
          import('./features/admin/content/admin-content.component').then(
            m => m.AdminContentComponent
          ),
      },
      {
        path: 'settings',
        data: { roles: ['admin'], title: 'Settings' },
        loadComponent: () =>
          import('./features/admin/settings/admin-settings.component').then(
            m => m.AdminSettingsComponent
          ),
      },
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
    ],
  },

  // ── Fallback ─────────────────────────────────────────────────────────
  {
    path: 'unauthorized',
    loadComponent: () =>
      import('./features/public/unauthorized/unauthorized.component').then(
        m => m.UnauthorizedComponent
      ),
  },
  { path: '**', redirectTo: '' },
];
