export interface SharePermission {
  email: string;
  permission: 'read' | 'write';
}

export interface Portfolio {
  id: string;
  name: string;
  ownerId: string;
  ownerEmail: string;
  sharedWith: SharePermission[];
  createdAt: any;
  updatedAt: any;
}

export type InvestmentType = 'stock' | 'mutual_fund' | 'fd' | 'savings' | 'other' | 'insurance';
export type InvestmentRegion = 'India' | 'Europe' | 'Other';
export type InvestmentCurrency = 'INR' | 'EUR' | 'USD';

export interface Investment {
  id: string;
  portfolioId: string;
  name: string;
  type: InvestmentType;
  region: InvestmentRegion;
  currency: InvestmentCurrency;
  amountInvested: number;
  currentValue: number;
  units?: number;
  purchasePrice?: number;
  interestRate?: number;
  interestType?: 'simple' | 'compound';
  compoundingFrequency?: 'monthly' | 'quarterly' | 'half-yearly' | 'yearly';
  startDate?: string; // ISO Date YYYY-MM-DD
  maturityDate?: string; // ISO Date YYYY-MM-DD
  purchaseExchangeRate?: number; // Exchange rate relative to EUR (1 EUR = X of currency) at purchase
  institution: string;
  notes?: string;
  ticker?: string;
  schemeCode?: number;
  isSipActive?: boolean;
  sipAmount?: number;
  sipFrequency?: 'weekly' | 'monthly' | 'quarterly';
  sipDay?: number; // Calendar day of execution (1-28)
  
  // Insurance policy fields
  policyType?: 'term' | 'health' | 'life' | 'motor' | 'other';
  sumAssured?: number;
  premiumAmount?: number;
  premiumFrequency?: 'monthly' | 'quarterly' | 'half-yearly' | 'yearly';
  premiumDueDate?: string; // YYYY-MM-DD
  policyNumber?: string;

  createdAt: any;
  updatedAt: any;
}

export interface ExchangeRates {
  INR: number;
  EUR: number;
  USD: number;
  date: string;
}

export interface Trip {
  id: string;
  portfolioId: string;
  destinationRegion: 'India' | 'Europe' | 'Other';
  purpose?: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  notes?: string;
  createdAt: any;
  updatedAt: any;
}

export interface TaxConfig {
  isIndianCitizen: boolean;
  hasIndianIncomeOver15L: boolean;
  preceding4YearsDays: number;
}

