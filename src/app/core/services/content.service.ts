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
  };
  footerText: string;
  footerTagline: string;
  whyPartnerPoints: {
    heading: string;
    body: string;
  }[];
  whatWeSupply: string[];

  // Why Us section
  whyUsSectionLabel: string;   // "Why Choose Tropx"
  whyUsSectionTitle: string;   // "Why Partner With Us?"
  whyUsSectionSubtext: string; // "The supply partner..."

  // How It Works section
  howItWorksSectionLabel: string;  // "Simple Process"
  howItWorksSectionTitle: string;  // "Getting Started Is Simple"
  howItWorksSteps: {
    title: string;
    description: string;
    color: 'navy' | 'red' | 'green' | 'gold' | 'blue' | 'purple';
  }[];
  howItWorksCtaText: string;  // "Request Access Now"

  // About section
  aboutSectionLabel: string;   // "About Tropx"
  aboutSectionTitle: string;   // "A Canadian Wholesale..."
  aboutTrustBadges: string[];  // ["CBCA Incorporated", "Ontario"]
  aboutWhatWeSupplyLabel: string; // "What We Supply"

  // Contact section
  contactSectionLabel: string; // "Get In Touch"
  contactSectionTitle: string; // "Contact Us"
  contactPartnerNote: string;  // "Looking to become..."
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
  ],
  whyUsSectionLabel: 'Why Choose Tropx',
  whyUsSectionTitle: 'Why Partner With Us?',
  whyUsSectionSubtext: 'The supply partner built for growing retail businesses.',

  howItWorksSectionLabel: 'Simple Process',
  howItWorksSectionTitle: 'Getting Started Is Simple',
  howItWorksSteps: [
    { title: 'Request Access', description: 'Fill out our short form with your business details.', color: 'navy' },
    { title: 'Get Approved', description: 'We review applications within 24 hours.', color: 'red' },
    { title: 'Start Ordering', description: 'Log in and browse our full catalog anytime.', color: 'green' },
  ],
  howItWorksCtaText: 'Request Access Now',

  aboutSectionLabel: 'About Tropx',
  aboutSectionTitle: 'A Canadian Wholesale Distributor You Can Trust',
  aboutTrustBadges: ['CBCA Incorporated', 'Ontario'],
  aboutWhatWeSupplyLabel: 'What We Supply',

  contactSectionLabel: 'Get In Touch',
  contactSectionTitle: 'Contact Us',
  contactPartnerNote: 'Looking to become a wholesale partner? Use our Request Access form for faster onboarding.',
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
