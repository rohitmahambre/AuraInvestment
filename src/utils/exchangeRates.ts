import type { ExchangeRates } from '../types';

const FALLBACK_RATES: ExchangeRates = {
  INR: 90.0,
  EUR: 1.0,
  USD: 1.08,
  date: new Date().toISOString().split('T')[0]
};

export const fetchExchangeRates = async (): Promise<ExchangeRates> => {
  try {
    const response = await fetch('https://api.frankfurter.dev/v1/latest?base=EUR&symbols=INR,USD');
    if (!response.ok) {
      // Try alternative domain if frankfurter.dev is down
      const altResponse = await fetch('https://api.frankfurter.app/latest?base=EUR&symbols=INR,USD');
      if (!altResponse.ok) throw new Error('API failed');
      const data = await altResponse.json();
      return {
        INR: data.rates.INR,
        EUR: 1.0,
        USD: data.rates.USD,
        date: data.date
      };
    }
    const data = await response.json();
    return {
      INR: data.rates.INR,
      EUR: 1.0,
      USD: data.rates.USD,
      date: data.date
    };
  } catch (error) {
    console.warn('Failed to fetch real-time exchange rates, using fallback values.', error);
    return FALLBACK_RATES;
  }
};

export const convertCurrency = (
  amount: number,
  from: 'INR' | 'EUR' | 'USD',
  to: 'INR' | 'EUR' | 'USD',
  rates: ExchangeRates
): number => {
  if (from === to) return amount;

  // Convert to base currency (EUR) first
  let amountInEur = amount;
  if (from === 'INR') {
    amountInEur = amount / rates.INR;
  } else if (from === 'USD') {
    amountInEur = amount / rates.USD;
  }

  // Convert from base currency (EUR) to target currency
  if (to === 'INR') {
    return amountInEur * rates.INR;
  } else if (to === 'USD') {
    return amountInEur * rates.USD;
  }

  return amountInEur; // Target is EUR
};

export const formatCurrency = (amount: number, currency: 'INR' | 'EUR' | 'USD'): string => {
  const locales = {
    INR: 'en-IN',
    EUR: 'de-DE',
    USD: 'en-US'
  };

  const formattingOptions: Intl.NumberFormatOptions = {
    style: 'currency',
    currency: currency,
    maximumFractionDigits: 0
  };

  return new Intl.NumberFormat(locales[currency], formattingOptions).format(amount);
};
