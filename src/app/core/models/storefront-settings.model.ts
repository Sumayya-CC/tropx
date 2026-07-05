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
  galleryEnabled: false,
  galleryImages: [],
};
