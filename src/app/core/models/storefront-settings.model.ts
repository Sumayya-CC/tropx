export interface StorefrontGalleryImage {
  id: string;
  imageUrl: string;
  caption: string;
  createdAt: any;
}

export interface StorefrontSettings {
  heroEnabled: boolean;
  heroProductId: string | null;
  heroHeadline: string;
  heroSubtext: string;

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
  heroEnabled: false,
  heroProductId: null,
  heroHeadline: '',
  heroSubtext: '',
  orderAgainEnabled: true,
  newArrivalsEnabled: true,
  newArrivalsAutoDays: 14,
  popularEnabled: true,
  galleryEnabled: false,
  galleryImages: [],
};
