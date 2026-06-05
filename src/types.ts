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

export type InvestmentType = 'stock' | 'mutual_fund' | 'fd' | 'savings' | 'other';
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
  institution: string;
  notes?: string;
  ticker?: string;
  schemeCode?: number;
  createdAt: any;
  updatedAt: any;
}

export interface ExchangeRates {
  INR: number;
  EUR: number;
  USD: number;
  date: string;
}
