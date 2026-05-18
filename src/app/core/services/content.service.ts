import { Injectable, inject } from '@angular/core';
import { FirestoreService } from './firestore.service';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';

export interface ContentData {
  heroHeadline: string;
  heroSubheadline: string;
  heroCtaText: string;
  heroBadgeText: string;
  aboutText: string;
  publicContactInfo: {
    phone: string;
    email: string;
    address: string;
    hours: string;
  };
  footerText: string;
  footerTagline: string;
  whyPartnerPoints: {
    heading: string;
    body: string;
  }[];
  whatWeSupply: string[];
}

const DEFAULT_CONTENT: ContentData = {
  heroHeadline: 'The Wholesale Partner Your Business Deserves.',
  heroSubheadline: 'Quality products. Competitive pricing. Reliable supply — for retail businesses across Ontario.',
  heroCtaText: 'Become a Wholesale Partner',
  heroBadgeText: 'Wholesale Distribution',
  aboutText: 'Tropx Wholesale is a federally incorporated Canadian distributor based in Kitchener, Ontario. We supply retail businesses across the region with a wide range of quality products and competitive wholesale pricing.',
  publicContactInfo: {
    phone: '',
    email: '',
    address: 'Kitchener, Ontario, Canada',
    hours: 'Monday–Friday, 9am–5pm EST'
  },
  footerText: '© 2026 Tropx Enterprises Inc. All rights reserved.',
  footerTagline: 'Your Wholesale Partner',
  whyPartnerPoints: [
    {
      heading: 'Wide Product Range',
      body: 'A diverse catalog covering everything your store needs.'
    },
    {
      heading: 'Reliable Delivery',
      body: 'Consistent, dependable supply so your shelves stay stocked.'
    },
    {
      heading: 'Competitive Pricing',
      body: 'Wholesale rates designed to protect your margins.'
    },
    {
      heading: 'Easy Online Ordering',
      body: 'Place and track orders 24/7 through our portal.'
    }
  ],
  whatWeSupply: [
    'General Merchandise',
    'Food & Beverages',
    'Snacks & Confectionery',
    'Household Products',
    'Imported Goods',
    'Personal Care',
    'Seasonal Items',
    'And More...'
  ]
};


@Injectable({
  providedIn: 'root'
})
export class ContentService {
  private firestore = inject(FirestoreService);

  content = toSignal(
    this.firestore.getDocument<ContentData>('settings/content').pipe(
      map(data => ({ ...DEFAULT_CONTENT, ...data }))
    ),
    { initialValue: DEFAULT_CONTENT }
  );
}
