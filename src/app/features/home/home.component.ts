import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Component, Inject, OnDestroy, OnInit, PLATFORM_ID } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  Subject,
  Subscription,
  catchError,
  debounceTime,
  distinctUntilChanged,
  finalize,
  forkJoin,
  interval,
  of,
  retry,
  timeout,
  timer
} from 'rxjs';
import { AuthService, User } from '../../core/services/auth.service';
import {
  CustomerOrderInput,
  ShopCategory,
  ShopLocation,
  ShopProduct,
  ShopService
} from '../../core/services/shop.service';
import { APP_LOCALE, formatPeso } from '../../shared/utils/locale-format';

interface NavLink {
  label: string;
  targetId: string;
}

interface CartItem {
  productId: number;
  locationId: number;
  sku: string;
  name: string;
  categoryName: string;
  locationName: string;
  unit: string;
  price: number;
  quantity: number;
  qtyAvailable: number;
}

interface CheckoutState {
  customerName: string;
  mobileNumber: string;
  fulfillmentMethod: 'pickup' | 'delivery';
  deliveryAddress: string;
  notes: string;
}

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.css']
})
export class HomeComponent implements OnInit, OnDestroy {
  private static readonly LOAD_TIMEOUT_MS = 12000;
  private static readonly LIVE_REFRESH_MS = 15000;

  private readonly isBrowser: boolean;
  private readonly searchTerm$ = new Subject<string>();
  private metaSub?: Subscription;
  private catalogSub?: Subscription;
  private orderSub?: Subscription;
  private refreshSub?: Subscription;
  private searchSub?: Subscription;

  readonly heroImage = '/images/home-hero.png';
  readonly fallbackImage = '/inventory-front.svg';
  readonly navLinks: NavLink[] = [
    { label: 'Home', targetId: 'hero-top' },
    { label: 'Departments', targetId: 'department-board' },
    { label: 'Categories', targetId: 'category-board' },
    { label: 'Customer Shop', targetId: 'customer-shop' },
    { label: 'Checkout', targetId: 'checkout-panel' }
  ];
  readonly skeletonCards = Array.from({ length: 6 }, (_, index) => index);

  locations: ShopLocation[] = [];
  categories: ShopCategory[] = [];
  products: ShopProduct[] = [];
  featuredProducts: ShopProduct[] = [];
  selectedProduct: ShopProduct | null = null;

  selectedLocationId: number | null = null;
  selectedCategoryId: number | null = null;
  searchTerm = '';

  page = 1;
  limit = 12;
  totalProducts = 0;
  hasMoreProducts = false;
  appliedLocation: ShopLocation | null = null;

  detailOpen = false;
  detailQuantity = 1;

  cartItems: CartItem[] = [];
  checkout: CheckoutState = this.createDefaultCheckoutState();

  metaLoading = false;
  catalogLoading = false;
  catalogRefreshing = false;
  checkoutSubmitting = false;
  filtersDrawerOpen = false;
  cartDrawerOpen = false;

  catalogError = '';
  checkoutError = '';
  checkoutSuccess = '';
  lastSyncedLabel = 'Waiting for first sync';

  constructor(
    private readonly shopService: ShopService,
    private readonly authService: AuthService,
    @Inject(PLATFORM_ID) platformId: Object
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  ngOnInit(): void {
    this.prefillCheckoutFromUser();
    this.bindSearchDebounce();
    this.loadMetaAndCatalog();
    this.startLiveRefresh();
  }

  ngOnDestroy(): void {
    this.metaSub?.unsubscribe();
    this.catalogSub?.unsubscribe();
    this.orderSub?.unsubscribe();
    this.refreshSub?.unsubscribe();
    this.searchSub?.unsubscribe();
  }

  get currentUser(): User | null {
    return this.authService.currentUser();
  }

  get cartItemCount(): number {
    return this.cartItems.reduce((total, item) => total + item.quantity, 0);
  }

  get cartTotal(): number {
    return this.cartItems.reduce((total, item) => total + item.quantity * item.price, 0);
  }

  get totalAvailableUnits(): number {
    return this.products.reduce((total, product) => total + product.qtyAvailable, 0);
  }

  get lowStockCount(): number {
    return this.products.filter(product => product.qtyAvailable > 0 && product.qtyAvailable <= 10).length;
  }

  get soldOutCount(): number {
    return this.products.filter(product => product.qtyAvailable <= 0).length;
  }

  get dashboardRoute(): string | null {
    const user = this.currentUser;
    if (!user || user.role === 'customer') {
      return null;
    }

    return this.authService.getDashboardRoute(user);
  }

  get canSubmitOrder(): boolean {
    if (this.checkoutSubmitting || this.cartItems.length === 0) {
      return false;
    }

    if (!this.checkout.customerName.trim() || !this.checkout.mobileNumber.trim()) {
      return false;
    }

    if (!this.mobileNumberValid) {
      return false;
    }

    if (this.checkout.fulfillmentMethod === 'delivery' && !this.checkout.deliveryAddress.trim()) {
      return false;
    }

    return this.cartItems.every(item => item.quantity > 0 && item.quantity <= item.qtyAvailable);
  }

  get mobileNumberValid(): boolean {
    return this.checkout.mobileNumber.trim() === '' || this.isValidMobileNumber(this.checkout.mobileNumber);
  }

  get cartSubtotal(): number {
    return this.cartTotal;
  }

  get showCatalogSkeleton(): boolean {
    return this.catalogLoading && this.products.length === 0;
  }

  get showEmptyProducts(): boolean {
    return !this.catalogLoading && !this.catalogError && this.products.length === 0;
  }

  get showDrawerBackdrop(): boolean {
    return this.isCompactViewport() && (this.filtersDrawerOpen || this.cartDrawerOpen);
  }

  onSearchTermChange(value: string): void {
    this.searchTerm = value;
    this.page = 1;
    this.searchTerm$.next(value.trim().toLowerCase());
  }

  selectLocation(locationId: number | null): void {
    this.selectedLocationId = locationId;
    this.page = 1;
    this.loadCatalog();
    this.closeDrawers();
  }

  selectCategory(categoryId: number | null): void {
    this.selectedCategoryId = categoryId;
    this.page = 1;
    this.loadCatalog();
    this.closeDrawers();
  }

  clearCatalogFilters(): void {
    this.searchTerm = '';
    this.selectedCategoryId = null;
    this.selectedLocationId = null;
    this.page = 1;
    this.loadCatalog();
    this.closeDrawers();
  }

  prevPage(): void {
    if (this.page <= 1 || this.catalogLoading || this.catalogRefreshing) {
      return;
    }

    this.page -= 1;
    this.loadCatalog();
  }

  nextPage(): void {
    if (!this.hasMoreProducts || this.catalogLoading || this.catalogRefreshing) {
      return;
    }

    this.page += 1;
    this.loadCatalog();
  }

  retryCatalogLoad(): void {
    this.loadCatalog();
  }

  openFiltersDrawer(): void {
    if (!this.isCompactViewport()) {
      return;
    }
    this.filtersDrawerOpen = true;
    this.cartDrawerOpen = false;
  }

  openCartDrawer(): void {
    if (!this.isCompactViewport()) {
      return;
    }
    this.cartDrawerOpen = true;
    this.filtersDrawerOpen = false;
  }

  closeDrawers(): void {
    this.filtersDrawerOpen = false;
    this.cartDrawerOpen = false;
  }

  openProductDetails(product: ShopProduct): void {
    this.selectedProduct = product;
    this.detailQuantity = 1;
    this.detailOpen = true;
  }

  closeProductDetails(): void {
    this.detailOpen = false;
    this.selectedProduct = null;
    this.detailQuantity = 1;
  }

  increaseDetailQuantity(): void {
    if (!this.selectedProduct) {
      return;
    }

    this.detailQuantity = Math.min(this.detailQuantity + 1, Math.max(this.selectedProduct.qtyAvailable, 1));
  }

  decreaseDetailQuantity(): void {
    this.detailQuantity = Math.max(1, this.detailQuantity - 1);
  }

  addProductToCart(product: ShopProduct, quantity = 1): void {
    if (!product.locationId || product.qtyAvailable <= 0) {
      this.checkoutError = `${product.name} is not available for online ordering right now.`;
      return;
    }

    this.checkoutError = '';
    this.checkoutSuccess = '';

    const existingItem = this.cartItems.find(
      item => item.productId === product.id && item.locationId === product.locationId
    );

    if (existingItem) {
      existingItem.quantity = Math.min(existingItem.quantity + quantity, product.qtyAvailable);
      existingItem.qtyAvailable = product.qtyAvailable;
      if (this.isCompactViewport()) {
        this.cartDrawerOpen = true;
      }
      return;
    }

    this.cartItems = [
      ...this.cartItems,
      {
        productId: product.id,
        locationId: product.locationId,
        sku: product.sku,
        name: product.name,
        categoryName: product.categoryName,
        locationName: product.locationName || this.appliedLocation?.name || 'Assigned department',
        unit: product.unit,
        price: product.price,
        quantity: Math.min(quantity, product.qtyAvailable),
        qtyAvailable: product.qtyAvailable
      }
    ];
    if (this.isCompactViewport()) {
      this.cartDrawerOpen = true;
    }
  }

  addSelectedProductToCart(): void {
    if (!this.selectedProduct) {
      return;
    }

    this.addProductToCart(this.selectedProduct, this.detailQuantity);
    this.closeProductDetails();
    this.scrollToSection('checkout-panel');
  }

  updateCartQuantity(item: CartItem, rawValue: string | number): void {
    const quantity = Number(rawValue);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      item.quantity = 1;
      return;
    }

    item.quantity = Math.min(quantity, Math.max(item.qtyAvailable, 1));
  }

  increaseCartQuantity(item: CartItem): void {
    item.quantity = Math.min(item.quantity + 1, Math.max(item.qtyAvailable, 1));
  }

  decreaseCartQuantity(item: CartItem): void {
    if (item.quantity <= 1) {
      this.removeCartItem(item);
      return;
    }

    item.quantity -= 1;
  }

  removeCartItem(item: CartItem): void {
    this.cartItems = this.cartItems.filter(
      current => !(current.productId === item.productId && current.locationId === item.locationId)
    );
  }

  submitOrder(): void {
    if (!this.canSubmitOrder) {
      this.checkoutError = 'Complete the checkout form and keep quantities within the available stock before placing the order.';
      return;
    }

    const payload: CustomerOrderInput = {
      customerName: this.checkout.customerName.trim(),
      mobileNumber: this.checkout.mobileNumber.trim(),
      fulfillmentMethod: this.checkout.fulfillmentMethod,
      deliveryAddress:
        this.checkout.fulfillmentMethod === 'delivery' ? this.checkout.deliveryAddress.trim() : undefined,
      notes: this.checkout.notes.trim() || undefined,
      items: this.cartItems.map(item => ({
        productId: item.productId,
        locationId: item.locationId,
        quantity: item.quantity
      }))
    };

    this.checkoutSubmitting = true;
    this.checkoutError = '';
    this.checkoutSuccess = '';
    this.orderSub?.unsubscribe();

    this.orderSub = this.shopService
      .createPublicOrder(payload)
      .pipe(
        timeout(HomeComponent.LOAD_TIMEOUT_MS),
        retry({ count: 1, delay: () => timer(250) }),
        finalize(() => (this.checkoutSubmitting = false))
      )
      .subscribe({
        next: order => {
          this.checkoutSuccess = `Saved successfully. Order ${order.orderNo} is now pending review and the stock has been reserved.`;
          this.cartItems = [];
          this.resetCheckoutAfterSuccess();
          this.loadCatalog(false, true);
          this.closeDrawers();
          this.scrollToSection('checkout-panel');
        },
        error: error => {
          this.checkoutError =
            typeof error?.error?.message === 'string'
              ? error.error.message
              : 'Unable to place the order right now. Please retry.';
        }
      });
  }

  logout(): void {
    this.authService.logout();
  }

  scrollToSection(targetId: string): void {
    if (!this.isBrowser) {
      return;
    }

    const target = document.getElementById(targetId);
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    this.closeDrawers();
  }

  useFallbackImage(event: Event): void {
    const target = event.target as HTMLImageElement | null;
    if (!target) {
      return;
    }

    if (!target.src.includes(this.fallbackImage)) {
      target.src = this.fallbackImage;
    }
  }

  formatMoney(value: number): string {
    return formatPeso(value);
  }

  getCartLineTotal(item: CartItem): number {
    return item.price * item.quantity;
  }

  trackByCategoryId(_index: number, category: ShopCategory): number {
    return category.id;
  }

  trackByLocationId(_index: number, location: ShopLocation): number {
    return location.id;
  }

  trackByProductId(_index: number, product: ShopProduct): number {
    return product.id;
  }

  trackByCartItem(_index: number, item: CartItem): string {
    return `${item.productId}-${item.locationId}`;
  }

  private createDefaultCheckoutState(): CheckoutState {
    return {
      customerName: '',
      mobileNumber: '',
      fulfillmentMethod: 'pickup',
      deliveryAddress: '',
      notes: ''
    };
  }

  private bindSearchDebounce(): void {
    this.searchSub = this.searchTerm$
      .pipe(debounceTime(300), distinctUntilChanged())
      .subscribe(() => this.loadCatalog());
  }

  private prefillCheckoutFromUser(): void {
    const user = this.currentUser;
    if (!user) {
      return;
    }

    this.checkout.customerName = user.fullName || user.username;
  }

  private loadMetaAndCatalog(): void {
    this.metaSub?.unsubscribe();
    this.metaLoading = true;

    this.metaSub = forkJoin({
      locations: this.shopService.getPublicLocations().pipe(
        timeout(HomeComponent.LOAD_TIMEOUT_MS),
        retry({ count: 1, delay: () => timer(250) }),
        catchError(() => of([] as ShopLocation[]))
      ),
      categories: this.shopService.getPublicCategories().pipe(
        timeout(HomeComponent.LOAD_TIMEOUT_MS),
        retry({ count: 1, delay: () => timer(250) }),
        catchError(() => of([] as ShopCategory[]))
      )
    })
      .pipe(finalize(() => (this.metaLoading = false)))
      .subscribe(({ locations, categories }) => {
        this.locations = locations;
        this.categories = categories;
        this.loadCatalog();
      });
  }

  private loadCatalog(keepPage = true, silent = false): void {
    if (!keepPage) {
      this.page = 1;
    }

    this.catalogSub?.unsubscribe();

    if (silent) {
      this.catalogRefreshing = true;
    } else {
      this.catalogLoading = true;
      this.catalogError = '';
    }

    this.catalogSub = this.shopService
      .getPublicProducts({
        page: this.page,
        limit: this.limit,
        search: this.searchTerm.trim() || undefined,
        categoryId: this.selectedCategoryId,
        locationId: this.selectedLocationId
      })
      .pipe(
        timeout(HomeComponent.LOAD_TIMEOUT_MS),
        retry({ count: 1, delay: () => timer(250) }),
        finalize(() => {
          this.catalogLoading = false;
          this.catalogRefreshing = false;
        })
      )
      .subscribe({
        next: result => {
          this.products = result.products;
          this.featuredProducts = [...result.products].sort((a, b) => b.qtyAvailable - a.qtyAvailable).slice(0, 4);
          this.totalProducts = result.total;
          this.hasMoreProducts = result.hasMore;
          this.appliedLocation = result.appliedLocation;
          this.syncCartAvailability(result.products);
          this.syncSelectedProduct(result.products);
          this.lastSyncedLabel = new Intl.DateTimeFormat(APP_LOCALE, {
            hour: 'numeric',
            minute: '2-digit',
            second: '2-digit'
          }).format(new Date());
          this.catalogError = '';
        },
        error: () => {
          this.products = [];
          this.featuredProducts = [];
          this.totalProducts = 0;
          this.hasMoreProducts = false;
          this.catalogError = 'Unable to load the public shop right now. Please retry.';
        }
      });
  }

  private syncCartAvailability(products: ShopProduct[]): void {
    const availabilityMap = new Map<string, ShopProduct>();
    for (const product of products) {
      if (product.locationId) {
        availabilityMap.set(`${product.id}-${product.locationId}`, product);
      }
    }

    this.cartItems = this.cartItems
      .map(item => {
        const liveProduct = availabilityMap.get(`${item.productId}-${item.locationId}`);
        if (!liveProduct) {
          return item;
        }

        if (liveProduct.qtyAvailable <= 0) {
          return null;
        }

        return {
          ...item,
          price: liveProduct.price,
          qtyAvailable: liveProduct.qtyAvailable,
          quantity: Math.min(item.quantity, liveProduct.qtyAvailable)
        };
      })
      .filter((item): item is CartItem => item !== null);
  }

  private syncSelectedProduct(products: ShopProduct[]): void {
    if (!this.selectedProduct) {
      return;
    }

    const liveProduct = products.find(product => product.id === this.selectedProduct?.id);
    if (!liveProduct) {
      return;
    }

    this.selectedProduct = liveProduct;
    this.detailQuantity = Math.min(this.detailQuantity, Math.max(liveProduct.qtyAvailable, 1));
  }

  private startLiveRefresh(): void {
    this.refreshSub?.unsubscribe();
    this.refreshSub = interval(HomeComponent.LIVE_REFRESH_MS).subscribe(() => {
      if (this.catalogLoading || this.checkoutSubmitting) {
        return;
      }

      this.loadCatalog(true, true);
    });
  }

  private resetCheckoutAfterSuccess(): void {
    const preservedName = this.checkout.customerName;
    const preservedMobile = this.checkout.mobileNumber;
    this.checkout = this.createDefaultCheckoutState();
    this.checkout.customerName = preservedName;
    this.checkout.mobileNumber = preservedMobile;
  }

  private isValidMobileNumber(value: string): boolean {
    return /^09\d{9}$/.test(value.trim());
  }

  private isCompactViewport(): boolean {
    return this.isBrowser && window.innerWidth <= 840;
  }
}
