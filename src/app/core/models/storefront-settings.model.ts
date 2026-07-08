export interface StorefrontGalleryImage {
  id: string;
  imageUrl: string;
  caption: string;
  createdAt: any;
}

export type BannerTextAlign = 'left' | 'center' | 'right';
export type BannerTextColor = 'light' | 'dark';
export type BannerProductPlacement = 'left' | 'right' | 'center' | 'both';

export const MAX_BANNER_PRODUCTS = 8;

export interface PopularProductsSettings {
  /** Days back to look for delivered orders */
  windowDays: number;
  /** Max products to surface */
  topN: number;
  /** Min popularity % to include a product */
  minPercent: number;
}

export const DEFAULT_POPULAR_PRODUCTS_SETTINGS: PopularProductsSettings = {
  windowDays: 90,
  topN: 10,
  minPercent: 0,
};

export interface PopularProductEntry {
  productId: string;
  customerCount: number;
  totalCustomers: number;
  percent: number;
}

export function resolveHidePrice(p: FeaturedBannerProduct): boolean {
  if (p.hidePrice !== undefined) return p.hidePrice;
  if (p.showPrice !== undefined) return !p.showPrice;
  return false;
}

export interface FeaturedBannerProduct {
  productId: string;
  hidePrice?: boolean;
  /** @deprecated Use hidePrice instead. Kept for backward compatibility. */
  showPrice?: boolean;
}

export interface FeaturedBannerOverlay {
  title?: string;
  description?: string;
  buttonLabel?: string;
  buttonLink?: string;
  textAlign: BannerTextAlign;
  textColor: BannerTextColor;
}

export interface FeaturedBannerSlide {
  id: string;
  imageUrl: string;
  products: FeaturedBannerProduct[];
  overlay?: FeaturedBannerOverlay;
  productPlacement?: BannerProductPlacement;
  createdAt?: number;
}

export interface StorefrontSettings {
  featuredBannerEnabled: boolean;
  featuredBannerAutoAdvance: boolean;
  featuredBannerIntervalSeconds: number;
  featuredBannerSlides: FeaturedBannerSlide[];

  orderAgainEnabled: boolean;

  newArrivalsEnabled: boolean;
  /** Products with createdAt within this many days are
   *  auto-included in "New arrivals", in addition to any
   *  product with isFeaturedNew === true. */
  newArrivalsAutoDays: number;

  popularEnabled: boolean;
  popularProductsSettings?: PopularProductsSettings;
  popularProductEntries?: PopularProductEntry[];
  popularProductsComputedAt?: any;
  popularProductsTotalCustomers?: number;
  popularProductsWindowDays?: number;

  galleryEnabled: boolean;
  galleryImages: StorefrontGalleryImage[];
}

export const DEFAULT_STOREFRONT_SETTINGS: StorefrontSettings = {
  featuredBannerEnabled: false,
  featuredBannerAutoAdvance: true,
  featuredBannerIntervalSeconds: 5,
  featuredBannerSlides: [],
  orderAgainEnabled: true,
  newArrivalsEnabled: true,
  newArrivalsAutoDays: 14,
  popularEnabled: true,
  popularProductsSettings: DEFAULT_POPULAR_PRODUCTS_SETTINGS,
  popularProductEntries: [],
  galleryEnabled: false,
  galleryImages: [],
};
