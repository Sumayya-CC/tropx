export interface StorefrontGalleryImage {
  id: string;
  imageUrl: string;
  caption: string;
  createdAt: any;
}

export interface FeaturedBannerProduct {
  productId: string;
  showPrice: boolean;
}

export interface FeaturedBannerSlide {
  id: string;
  imageUrl: string;
  products: FeaturedBannerProduct[];
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
