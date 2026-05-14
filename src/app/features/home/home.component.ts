import { CommonModule, isPlatformBrowser } from '@angular/common';
import { AfterViewInit, Component, HostListener, Inject, OnDestroy, OnInit, PLATFORM_ID, effect } from '@angular/core';
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
  CustomerOrderHistoryItem,
  CustomerOrderInput,
  ShopCategory,
  ShopLocation,
  ShopProduct,
  ShopService
} from '../../core/services/shop.service';
import { APP_LOCALE, formatPeso } from '../../shared/utils/locale-format';
import { AppRefreshEvent, AppRefreshService } from '../../core/services/app-refresh.service';

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
export class HomeComponent implements OnInit, AfterViewInit, OnDestroy {
  private static readonly LOAD_TIMEOUT_MS = 12000;
  private static readonly LIVE_REFRESH_MS = 15000;
  private static readonly CART_STORAGE_KEY = 'public_shop_cart';
  private static readonly GUEST_CHECKOUT_STORAGE_KEY = 'public_shop_guest_checkout';
  private static readonly CUSTOMER_ORDER_HISTORY_LIMIT = 6;
  private static readonly SECTION_SCROLL_PADDING_PX = 12;
  private static readonly LOW_STOCK_THRESHOLD = 10;

  private readonly isBrowser: boolean;
  private readonly searchTerm$ = new Subject<string>();
  private metaSub?: Subscription;
  private catalogSub?: Subscription;
  private orderSub?: Subscription;
  private refreshSub?: Subscription;
  private appRefreshSub?: Subscription;
  private searchSub?: Subscription;
  private customerOrdersSub?: Subscription;
  private sectionObserver?: IntersectionObserver;
  private scrollMetricTimer: number | null = null;
  private scrollReadyTimer: number | null = null;
  private scrollRequestId = 0;
  private pendingScrollTargetId: string | null = null;
  private previousDocumentScrollStyles: {
    htmlHeight: string;
    htmlOverflowY: string;
    bodyHeight: string;
    bodyMinHeight: string;
    bodyOverflowX: string;
    bodyOverflowY: string;
  } | null = null;
  private sectionTargetsVerified = false;
  private checkoutStateHydrated = false;
  private lastSessionSuggestedName = '';

  readonly heroImage = '/images/home-hero.png';
  readonly fallbackImage = '/inventory-front.svg';
  readonly navLinks: NavLink[] = [
    { label: 'Home', targetId: 'homeSection' },
    { label: 'Categories', targetId: 'categoriesSection' },
    { label: 'Customer Shop', targetId: 'shopSection' },
    { label: 'Checkout', targetId: 'checkoutSection' }
  ];
  readonly skeletonCards = Array.from({ length: 6 }, (_, index) => index);

  locations: ShopLocation[] = [];
  categories: ShopCategory[] = [];
  products: ShopProduct[] = [];
  featuredProducts: ShopProduct[] = [];
  selectedProduct: ShopProduct | null = null;
  customerOrders: CustomerOrderHistoryItem[] = [];

  selectedLocationId: number | null = null;
  selectedCategoryId: number | null = null;
  searchTerm = '';
  productQuantities: Record<string, number> = {};

  page = 1;
  limit = 12;
  totalProducts = 0;
  hasMoreProducts = false;
  appliedLocation: ShopLocation | null = null;

  detailOpen = false;
  detailQuantity = 1;
  activeSectionId = 'homeSection';
  headerHeightPx = 88;
  navHeightPx = 66;
  stickyStackHeightPx = 170;
  checkoutStarted = false;
  mobileCartOpen = false;

  cartItems: CartItem[] = [];
  checkout: CheckoutState = this.createDefaultCheckoutState();
  guestCheckoutDraft: CheckoutState = this.createDefaultCheckoutState();

  metaLoading = false;
  catalogLoading = false;
  catalogRefreshing = false;
  checkoutSubmitting = false;
  customerOrdersLoading = false;

  catalogError = '';
  checkoutError = '';
  checkoutSuccess = '';
  customerOrdersError = '';
  lastSyncedLabel = 'Waiting for first sync';

  constructor(
    private readonly shopService: ShopService,
    private readonly authService: AuthService,
    private readonly appRefreshService: AppRefreshService,
    @Inject(PLATFORM_ID) platformId: Object
  ) {
    this.isBrowser = isPlatformBrowser(platformId);

    effect(() => {
      const user = this.authService.currentUser();
      if (!this.checkoutStateHydrated) {
        return;
      }

      this.syncCheckoutIdentity(user);
      this.syncCustomerOrderHistory(user);
      this.scheduleScrollMetricUpdate();
    });
  }

  ngAfterViewInit(): void {
    this.enablePublicPageScrolling();
    this.verifySectionTargets();
    this.scheduleScrollMetricUpdate();
  }

  ngOnInit(): void {
    this.enablePublicPageScrolling();
    this.restoreGuestCheckoutDraft();
    this.restoreCartItems();
    this.checkoutStateHydrated = true;
    this.syncCheckoutIdentity(this.currentUser);
    this.syncCustomerOrderHistory(this.currentUser);
    this.bindSearchDebounce();
    this.bindAppRefresh();
    this.loadMetaAndCatalog();
    this.startLiveRefresh();
  }

  ngOnDestroy(): void {
    this.metaSub?.unsubscribe();
    this.catalogSub?.unsubscribe();
    this.orderSub?.unsubscribe();
    this.refreshSub?.unsubscribe();
    this.appRefreshSub?.unsubscribe();
    this.searchSub?.unsubscribe();
    this.customerOrdersSub?.unsubscribe();
    this.sectionObserver?.disconnect();

    if (this.scrollMetricTimer !== null && this.isBrowser) {
      window.clearTimeout(this.scrollMetricTimer);
      this.scrollMetricTimer = null;
    }

    if (this.scrollReadyTimer !== null && this.isBrowser) {
      window.clearTimeout(this.scrollReadyTimer);
      this.scrollReadyTimer = null;
    }

    this.restoreDocumentScrolling();
  }

  @HostListener('window:resize')
  onViewportResize(): void {
    this.scheduleScrollMetricUpdate();
  }

  get currentUser(): User | null {
    return this.authService.currentUser();
  }

  get currentUserDisplayName(): string {
    const user = this.currentUser;
    if (!user) {
      return '';
    }

    return user.fullName?.trim() || user.username;
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

  get isCustomerSession(): boolean {
    return this.currentUser?.role === 'customer';
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

  get showCheckoutForm(): boolean {
    return this.checkoutStarted && this.cartItems.length > 0;
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
  }

  selectCategory(categoryId: number | null): void {
    this.selectedCategoryId = categoryId;
    this.page = 1;
    this.loadCatalog();
  }

  selectCategoryAndScroll(categoryId: number | null): void {
    this.selectCategory(categoryId);
    this.scrollToSection('shopSection');
  }

  clearCatalogFilters(): void {
    this.searchTerm = '';
    this.selectedCategoryId = null;
    this.selectedLocationId = null;
    this.page = 1;
    this.loadCatalog();
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

  startCheckout(): void {
    if (this.cartItems.length === 0) {
      this.checkoutStarted = false;
      return;
    }

    this.checkoutStarted = true;
    this.mobileCartOpen = false;
    this.checkoutError = '';
    this.checkoutSuccess = '';
    this.scrollToSection('checkoutSection');
  }

  continueShopping(): void {
    this.checkoutStarted = false;
    this.scrollToSection('shopSection');
  }

  toggleMobileCart(): void {
    this.mobileCartOpen = !this.mobileCartOpen;
  }

  closeMobileCart(): void {
    this.mobileCartOpen = false;
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
      this.persistCartItems();
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
    this.persistCartItems();
  }

  addProductSelectionToCart(product: ShopProduct): void {
    if (product.qtyAvailable <= 0) {
      this.checkoutError = `${product.name} is out of stock right now.`;
      return;
    }

    this.addProductToCart(product, this.getProductQuantity(product));
    this.mobileCartOpen = true;
  }

  addSelectedProductToCart(): void {
    if (!this.selectedProduct) {
      return;
    }

    this.addProductToCart(this.selectedProduct, this.detailQuantity);
    this.closeProductDetails();
    this.mobileCartOpen = true;
  }

  updateCartQuantity(item: CartItem, rawValue: string | number): void {
    const quantity = Number(rawValue);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      item.quantity = 1;
      this.persistCartItems();
      return;
    }

    item.quantity = Math.min(quantity, Math.max(item.qtyAvailable, 1));
    this.persistCartItems();
  }

  increaseCartQuantity(item: CartItem): void {
    item.quantity = Math.min(item.quantity + 1, Math.max(item.qtyAvailable, 1));
    this.persistCartItems();
  }

  decreaseCartQuantity(item: CartItem): void {
    if (item.quantity <= 1) {
      this.removeCartItem(item);
      return;
    }

    item.quantity -= 1;
    this.persistCartItems();
  }

  removeCartItem(item: CartItem): void {
    this.cartItems = this.cartItems.filter(
      current => !(current.productId === item.productId && current.locationId === item.locationId)
    );

    if (this.cartItems.length === 0) {
      this.checkoutStarted = false;
      this.mobileCartOpen = false;
    }

    this.persistCartItems();
  }

  onCheckoutFieldChange(): void {
    this.checkoutError = '';
    this.checkoutSuccess = '';
    this.persistGuestCheckoutDraft();
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
          this.checkoutStarted = false;
          this.mobileCartOpen = false;
          this.persistCartItems();
          this.resetCheckoutAfterSuccess();
          this.persistGuestCheckoutDraft();
          this.scrollToSection('checkoutSection');
          this.appRefreshService.request('public-order-created', ['dashboard', 'inventory', 'products', 'transactions', 'orders', 'shop']);
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
    this.checkoutError = '';
    this.checkoutSuccess = '';
    this.authService.logout();
  }

  scrollToSection(targetId: string): void {
    if (!this.isBrowser) {
      return;
    }

    this.activeSectionId = targetId;
    this.queueSectionScroll(targetId);
  }

  onLayoutAssetSettled(): void {
    if (!this.isBrowser) {
      return;
    }

    this.scheduleScrollMetricUpdate();
    this.flushPendingSectionScroll();
  }

  useFallbackImage(event: Event): void {
    const target = event.target as HTMLImageElement | null;
    if (!target) {
      return;
    }

    if (!target.src.includes(this.fallbackImage)) {
      target.src = this.fallbackImage;
      return;
    }

    this.onLayoutAssetSettled();
  }

  formatMoney(value: number): string {
    return formatPeso(value);
  }

  formatOrderStatus(value: string): string {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return 'Pending';
    }

    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
  }

  getCartLineTotal(item: CartItem): number {
    return item.price * item.quantity;
  }

  getProductQuantity(product: ShopProduct): number {
    const key = this.getProductQuantityKey(product);
    const quantity = this.productQuantities[key] ?? 1;
    return this.clampProductQuantity(product, quantity);
  }

  setProductQuantity(product: ShopProduct, rawValue: string | number): void {
    const key = this.getProductQuantityKey(product);
    this.productQuantities[key] = this.clampProductQuantity(product, rawValue);
  }

  increaseProductQuantity(product: ShopProduct): void {
    this.setProductQuantity(product, this.getProductQuantity(product) + 1);
  }

  decreaseProductQuantity(product: ShopProduct): void {
    this.setProductQuantity(product, this.getProductQuantity(product) - 1);
  }

  getStockStateLabel(product: ShopProduct): string {
    if (product.qtyAvailable <= 0) {
      return 'Out of stock';
    }

    if (product.qtyAvailable <= HomeComponent.LOW_STOCK_THRESHOLD) {
      return 'Low stock';
    }

    return 'In stock';
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

  trackByOrderId(_index: number, order: CustomerOrderHistoryItem): number {
    return order.id;
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

  private bindAppRefresh(): void {
    this.appRefreshSub?.unsubscribe();
    this.appRefreshSub = this.appRefreshService.refresh$.subscribe(event => this.handleAppRefresh(event));
  }

  private enablePublicPageScrolling(): void {
    if (!this.isBrowser || this.previousDocumentScrollStyles) {
      return;
    }

    const html = document.documentElement;
    const body = document.body;

    this.previousDocumentScrollStyles = {
      htmlHeight: html.style.height,
      htmlOverflowY: html.style.overflowY,
      bodyHeight: body.style.height,
      bodyMinHeight: body.style.minHeight,
      bodyOverflowX: body.style.overflowX,
      bodyOverflowY: body.style.overflowY
    };

    html.style.height = 'auto';
    html.style.overflowY = 'auto';
    body.style.height = 'auto';
    body.style.minHeight = '100dvh';
    body.style.overflowX = 'clip';
    body.style.overflowY = 'visible';
  }

  private restoreDocumentScrolling(): void {
    if (!this.isBrowser || !this.previousDocumentScrollStyles) {
      return;
    }

    const html = document.documentElement;
    const body = document.body;
    html.style.height = this.previousDocumentScrollStyles.htmlHeight;
    html.style.overflowY = this.previousDocumentScrollStyles.htmlOverflowY;
    body.style.height = this.previousDocumentScrollStyles.bodyHeight;
    body.style.minHeight = this.previousDocumentScrollStyles.bodyMinHeight;
    body.style.overflowX = this.previousDocumentScrollStyles.bodyOverflowX;
    body.style.overflowY = this.previousDocumentScrollStyles.bodyOverflowY;
    this.previousDocumentScrollStyles = null;
  }

  private scheduleScrollMetricUpdate(): void {
    if (!this.isBrowser) {
      return;
    }

    if (this.scrollMetricTimer !== null) {
      window.clearTimeout(this.scrollMetricTimer);
    }

    this.scrollMetricTimer = window.setTimeout(() => {
      this.scrollMetricTimer = null;
      this.updateScrollMetrics();
      this.registerSectionObserver();
    }, 0);
  }

  private queueSectionScroll(targetId: string): void {
    if (!this.isBrowser) {
      return;
    }

    this.pendingScrollTargetId = targetId;
    const requestId = ++this.scrollRequestId;
    this.waitForStableLayoutThenScroll(requestId);
  }

  private waitForStableLayoutThenScroll(requestId: number): void {
    if (!this.isBrowser || requestId !== this.scrollRequestId) {
      return;
    }

    if (this.scrollReadyTimer !== null) {
      window.clearTimeout(this.scrollReadyTimer);
      this.scrollReadyTimer = null;
    }

    if (!this.isLayoutReadyForScroll()) {
      this.scrollReadyTimer = window.setTimeout(() => this.waitForStableLayoutThenScroll(requestId), 40);
      return;
    }

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (requestId !== this.scrollRequestId) {
          return;
        }

        const targetId = this.pendingScrollTargetId;
        if (!targetId) {
          return;
        }

        this.performSectionScroll(targetId);
        this.pendingScrollTargetId = null;
      });
    });
  }

  private isLayoutReadyForScroll(): boolean {
    if (document.readyState === 'loading') {
      return false;
    }

    if (this.metaLoading || this.catalogLoading) {
      return false;
    }

    return this.areLayoutImagesSettled();
  }

  private areLayoutImagesSettled(): boolean {
    const images = Array.from(document.querySelectorAll<HTMLImageElement>('.home-page img'));
    return images.every(image => image.complete);
  }

  private flushPendingSectionScroll(): void {
    if (!this.pendingScrollTargetId) {
      return;
    }

    this.queueSectionScroll(this.pendingScrollTargetId);
  }

  private performSectionScroll(targetId: string): void {
    this.updateScrollMetrics();
    const target = this.getSectionTarget(targetId);
    if (!target) {
      return;
    }

    const sectionOffset = this.getStickyScrollOffset(targetId);
    const top = Math.max(0, target.getBoundingClientRect().top + window.scrollY - sectionOffset);
    window.scrollTo({ top, behavior: 'smooth' });
  }

  private getStickyScrollOffset(targetId: string): number {
    const stickyStack = document.querySelector<HTMLElement>('.top-stack');
    const stickyStackHeight = Math.ceil(stickyStack?.getBoundingClientRect().height ?? this.stickyStackHeightPx);
    return stickyStackHeight + this.getSectionScrollPadding(targetId);
  }

  private updateScrollMetrics(): void {
    if (!this.isBrowser) {
      return;
    }

    const stickyStack = document.querySelector<HTMLElement>('.top-stack');
    const header = document.querySelector<HTMLElement>('.utility-header');
    const nav = document.querySelector<HTMLElement>('.main-nav');
    const headerHeight = Math.ceil(header?.getBoundingClientRect().height ?? 88);
    const navHeight = Math.ceil(nav?.getBoundingClientRect().height ?? 66);
    const stackHeight = Math.ceil(stickyStack?.getBoundingClientRect().height ?? headerHeight + navHeight);

    this.headerHeightPx = headerHeight;
    this.navHeightPx = navHeight;
    this.stickyStackHeightPx = stackHeight;
  }

  private registerSectionObserver(): void {
    if (!this.isBrowser || typeof IntersectionObserver === 'undefined') {
      return;
    }

    this.sectionObserver?.disconnect();

    const sections = Array.from(document.querySelectorAll<HTMLElement>('[data-scroll-section]'));
    if (sections.length === 0) {
      return;
    }

    const scrollContainer = this.resolveScrollContainer(sections[0]);

    this.sectionObserver = new IntersectionObserver(
      entries => {
        const visibleEntries = entries
          .filter(entry => entry.isIntersecting && entry.target instanceof HTMLElement)
          .sort((left, right) => right.intersectionRatio - left.intersectionRatio);

        const nextSectionId = visibleEntries[0]?.target?.id;
        if (nextSectionId) {
          this.activeSectionId = nextSectionId;
        }
      },
      {
        root: scrollContainer,
        threshold: [0.2, 0.35, 0.55, 0.75],
        rootMargin: `-${this.stickyStackHeightPx + HomeComponent.SECTION_SCROLL_PADDING_PX}px 0px -30% 0px`
      }
    );

    sections.forEach(section => this.sectionObserver?.observe(section));
  }

  private getSectionScrollPadding(targetId: string): number {
    return targetId === 'shopSection'
      ? HomeComponent.SECTION_SCROLL_PADDING_PX + 16
      : HomeComponent.SECTION_SCROLL_PADDING_PX;
  }

  private getSectionTarget(targetId: string): HTMLElement | null {
    const target = document.getElementById(targetId);
    if (target) {
      return target;
    }

    console.warn(`[HomeComponent] Unable to find scroll target with id "${targetId}".`);
    return null;
  }

  private verifySectionTargets(): void {
    if (!this.isBrowser || this.sectionTargetsVerified) {
      return;
    }

    this.sectionTargetsVerified = true;
    const missingTargetIds = this.navLinks
      .map(link => link.targetId)
      .filter(targetId => !document.getElementById(targetId));

    if (missingTargetIds.length > 0) {
      console.warn(
        `[HomeComponent] Missing section ids for navbar scroll targets: ${missingTargetIds.join(', ')}.`
      );
    }
  }

  private resolveScrollContainer(target: HTMLElement | null): HTMLElement | null {
    if (!target) {
      return null;
    }

    const ancestorContainer = this.findScrollableAncestor(target);
    if (ancestorContainer) {
      return ancestorContainer;
    }

    for (const selector of ['.portal-shell', '.page', '.content', '.landing-shell', '.app-shell', '.home-page']) {
      const candidate = document.querySelector<HTMLElement>(selector);
      if (candidate && this.isScrollableContainer(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  private findScrollableAncestor(target: HTMLElement): HTMLElement | null {
    let current: HTMLElement | null = target.parentElement;

    while (current) {
      if (this.isScrollableContainer(current)) {
        return current;
      }

      if (current === document.body) {
        break;
      }

      current = current.parentElement;
    }

    return null;
  }

  private isScrollableContainer(element: HTMLElement): boolean {
    if (element === document.body) {
      return element.scrollHeight > element.clientHeight + 1;
    }

    if (this.isDocumentScroller(element)) {
      return false;
    }

    const styles = window.getComputedStyle(element);
    const overflowValue = `${styles.overflow} ${styles.overflowY}`;
    const allowsScrolling = /(auto|scroll|overlay)/.test(overflowValue);

    return allowsScrolling && element.scrollHeight > element.clientHeight + 1;
  }

  private isDocumentScroller(element: HTMLElement): boolean {
    return element === document.documentElement;
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
      .pipe(
        finalize(() => {
          this.metaLoading = false;
          this.scheduleScrollMetricUpdate();
          this.flushPendingSectionScroll();
        })
      )
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
          this.scheduleScrollMetricUpdate();
          this.flushPendingSectionScroll();
        })
      )
      .subscribe({
        next: result => {
          this.products = result.products;
          this.featuredProducts = [...result.products].sort((a, b) => b.qtyAvailable - a.qtyAvailable).slice(0, 4);
          this.totalProducts = result.total;
          this.hasMoreProducts = result.hasMore;
          this.appliedLocation = result.appliedLocation;
          this.syncProductQuantities(result.products);
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

  private loadCustomerOrderHistory(): void {
    if (!this.isCustomerSession) {
      this.customerOrders = [];
      this.customerOrdersError = '';
      this.customerOrdersLoading = false;
      return;
    }

    this.customerOrdersSub?.unsubscribe();
    this.customerOrdersLoading = true;
    this.customerOrdersError = '';

    this.customerOrdersSub = this.shopService
      .getCustomerOrderHistory(HomeComponent.CUSTOMER_ORDER_HISTORY_LIMIT)
      .pipe(
        timeout(HomeComponent.LOAD_TIMEOUT_MS),
        retry({ count: 1, delay: () => timer(250) }),
        finalize(() => (this.customerOrdersLoading = false))
      )
      .subscribe({
        next: orders => {
          this.customerOrders = orders;
        },
        error: error => {
          this.customerOrders = [];
          this.customerOrdersError =
            typeof error?.error?.message === 'string'
              ? error.error.message
              : 'Unable to load your order history right now.';
        }
      });
  }

  private syncCustomerOrderHistory(user: User | null): void {
    if (user?.role === 'customer') {
      this.loadCustomerOrderHistory();
      return;
    }

    this.customerOrdersSub?.unsubscribe();
    this.customerOrders = [];
    this.customerOrdersError = '';
    this.customerOrdersLoading = false;
  }

  private syncCheckoutIdentity(user: User | null): void {
    const previousSuggestedName = this.lastSessionSuggestedName;
    const nextSuggestedName = user ? (user.fullName?.trim() || user.username?.trim() || '') : '';

    if (!user) {
      if (!this.checkout.customerName.trim() || this.checkout.customerName.trim() === previousSuggestedName) {
        this.checkout.customerName = this.guestCheckoutDraft.customerName;
      }

      if (!this.checkout.mobileNumber.trim()) {
        this.checkout.mobileNumber = this.guestCheckoutDraft.mobileNumber;
      }

      if (!this.checkout.deliveryAddress.trim()) {
        this.checkout.deliveryAddress = this.guestCheckoutDraft.deliveryAddress;
      }

      if (!this.checkout.notes.trim()) {
        this.checkout.notes = this.guestCheckoutDraft.notes;
      }

      this.checkout.fulfillmentMethod = this.guestCheckoutDraft.fulfillmentMethod;
      this.lastSessionSuggestedName = '';
      return;
    }

    if (!this.checkout.customerName.trim() || this.checkout.customerName.trim() === previousSuggestedName) {
      this.checkout.customerName = nextSuggestedName;
    }

    this.lastSessionSuggestedName = nextSuggestedName;
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

    if (this.cartItems.length === 0) {
      this.checkoutStarted = false;
      this.mobileCartOpen = false;
    }

    this.persistCartItems();
  }

  private syncProductQuantities(products: ShopProduct[]): void {
    for (const product of products) {
      const key = this.getProductQuantityKey(product);
      this.productQuantities[key] = this.clampProductQuantity(product, this.productQuantities[key] ?? 1);
    }
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

  private handleAppRefresh(event: AppRefreshEvent): void {
    if (this.appRefreshService.matches(event, ['categories', 'products'])) {
      this.loadMetaAndCatalog();
      return;
    }

    if (this.appRefreshService.matches(event, ['inventory', 'transactions', 'orders', 'shop'])) {
      this.loadCatalog(true, true);
    }

    if (this.isCustomerSession && this.appRefreshService.matches(event, ['orders', 'shop'])) {
      this.loadCustomerOrderHistory();
    }
  }

  private resetCheckoutAfterSuccess(): void {
    const preservedName = this.checkout.customerName;
    const preservedMobile = this.checkout.mobileNumber;
    this.checkout = this.createDefaultCheckoutState();
    this.checkout.customerName = preservedName;
    this.checkout.mobileNumber = preservedMobile;
  }

  private getProductQuantityKey(product: ShopProduct): string {
    return `${product.id}-${product.locationId ?? 0}`;
  }

  private clampProductQuantity(product: ShopProduct, rawValue: string | number): number {
    const parsed = Number(rawValue);
    const maxQuantity = Math.max(product.qtyAvailable, 1);

    if (!Number.isFinite(parsed) || parsed <= 0) {
      return 1;
    }

    return Math.min(Math.trunc(parsed), maxQuantity);
  }

  private restoreCartItems(): void {
    if (!this.isBrowser) {
      return;
    }

    try {
      const storedValue = localStorage.getItem(HomeComponent.CART_STORAGE_KEY);
      if (!storedValue) {
        return;
      }

      const parsed = JSON.parse(storedValue) as unknown[];
      const restoredItems = Array.isArray(parsed) ? parsed.map(value => this.mapStoredCartItem(value)).filter(Boolean) : [];
      this.cartItems = restoredItems as CartItem[];
    } catch {
      this.cartItems = [];
      localStorage.removeItem(HomeComponent.CART_STORAGE_KEY);
    }
  }

  private persistCartItems(): void {
    if (!this.isBrowser) {
      return;
    }

    localStorage.setItem(HomeComponent.CART_STORAGE_KEY, JSON.stringify(this.cartItems));
  }

  private restoreGuestCheckoutDraft(): void {
    if (!this.isBrowser) {
      return;
    }

    try {
      const storedValue = localStorage.getItem(HomeComponent.GUEST_CHECKOUT_STORAGE_KEY);
      if (!storedValue) {
        this.guestCheckoutDraft = this.createDefaultCheckoutState();
        this.checkout = { ...this.guestCheckoutDraft };
        return;
      }

      const parsed = JSON.parse(storedValue);
      this.guestCheckoutDraft = this.mapStoredCheckoutState(parsed);
      this.checkout = { ...this.guestCheckoutDraft };
    } catch {
      this.guestCheckoutDraft = this.createDefaultCheckoutState();
      this.checkout = { ...this.guestCheckoutDraft };
      localStorage.removeItem(HomeComponent.GUEST_CHECKOUT_STORAGE_KEY);
    }
  }

  private persistGuestCheckoutDraft(): void {
    if (!this.isBrowser || this.currentUser) {
      return;
    }

    this.guestCheckoutDraft = {
      customerName: this.checkout.customerName,
      mobileNumber: this.checkout.mobileNumber,
      fulfillmentMethod: this.checkout.fulfillmentMethod,
      deliveryAddress: this.checkout.deliveryAddress,
      notes: this.checkout.notes
    };

    localStorage.setItem(HomeComponent.GUEST_CHECKOUT_STORAGE_KEY, JSON.stringify(this.guestCheckoutDraft));
  }

  private mapStoredCartItem(value: unknown): CartItem | null {
    const item = (value || {}) as Partial<CartItem>;
    const productId = Number(item.productId ?? 0);
    const locationId = Number(item.locationId ?? 0);
    const quantity = Number(item.quantity ?? 0);
    const qtyAvailable = Number(item.qtyAvailable ?? 0);
    const price = Number(item.price ?? 0);

    if (
      !Number.isInteger(productId) ||
      productId <= 0 ||
      !Number.isInteger(locationId) ||
      locationId <= 0 ||
      !Number.isInteger(quantity) ||
      quantity <= 0
    ) {
      return null;
    }

    return {
      productId,
      locationId,
      sku: String(item.sku ?? ''),
      name: String(item.name ?? ''),
      categoryName: String(item.categoryName ?? ''),
      locationName: String(item.locationName ?? ''),
      unit: String(item.unit ?? ''),
      price: Number.isFinite(price) ? price : 0,
      quantity,
      qtyAvailable: Number.isFinite(qtyAvailable) && qtyAvailable > 0 ? qtyAvailable : quantity
    };
  }

  private mapStoredCheckoutState(value: unknown): CheckoutState {
    const stored = (value || {}) as Partial<CheckoutState>;
    return {
      customerName: String(stored.customerName ?? ''),
      mobileNumber: String(stored.mobileNumber ?? ''),
      fulfillmentMethod: stored.fulfillmentMethod === 'delivery' ? 'delivery' : 'pickup',
      deliveryAddress: String(stored.deliveryAddress ?? ''),
      notes: String(stored.notes ?? '')
    };
  }

  private isValidMobileNumber(value: string): boolean {
    return /^09\d{9}$/.test(value.trim());
  }
}
