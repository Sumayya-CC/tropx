export interface Currency {
  code: string;
  symbol: string;
  name: string;
  locale: string;
}

export const SUPPORTED_CURRENCIES: readonly Currency[] = [
  { code: 'CAD', symbol: '$', name: 'Canadian Dollar', locale: 'en-CA' },
  { code: 'USD', symbol: '$', name: 'US Dollar', locale: 'en-US' },
  { code: 'EUR', symbol: '€', name: 'Euro', locale: 'fr-FR' },
  { code: 'GBP', symbol: '£', name: 'British Pound', locale: 'en-GB' },
] as const;

// CAD is default as Tropx operates primarily in Canada
export const DEFAULT_CURRENCY: Currency = SUPPORTED_CURRENCIES[0];
