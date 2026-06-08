import React, { useState, useEffect, useRef } from 'react';
import type { Investment, InvestmentType, InvestmentRegion, InvestmentCurrency, ExchangeRates } from '../types';
import { formatCurrency, convertCurrency } from '../utils/exchangeRates';
import { 
  Plus, Edit2, Trash2, Filter, Calculator, 
  TrendingUp, Calendar, Landmark, Info, RefreshCw, ChevronDown
} from 'lucide-react';
import { collection, addDoc, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../firebase';

interface MultiSelectFilterProps {
  label: string;
  options: { value: string; label: string }[];
  selectedValues: string[];
  onChange: (values: string[]) => void;
  placeholder: string;
}

const MultiSelectFilter: React.FC<MultiSelectFilterProps> = ({
  label,
  options,
  selectedValues,
  onChange,
  placeholder
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleToggle = (value: string) => {
    if (selectedValues.includes(value)) {
      onChange(selectedValues.filter((v) => v !== value));
    } else {
      onChange([...selectedValues, value]);
    }
  };

  const displayText = selectedValues.length === 0 
    ? placeholder 
    : selectedValues.length === options.length
      ? (label === 'Currency' ? 'All Currencies' : `All ${label}s`)
      : options.filter(o => selectedValues.includes(o.value)).map(o => o.label).join(', ');

  return (
    <div ref={containerRef} className="relative inline-block text-left w-[180px]">
      <div>
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="w-full flex items-center justify-between py-1.5 px-3 text-xs bg-white/5 border border-white/10 rounded-lg text-white hover:bg-white/10 transition-all duration-150 font-semibold"
        >
          <span className="truncate pr-2">{displayText}</span>
          <ChevronDown className="w-3.5 h-3.5 opacity-60 shrink-0" />
        </button>
      </div>

      {isOpen && (
        <div className="absolute left-0 mt-2 w-max min-w-full md:min-w-[200px] origin-top-left rounded-xl bg-[#0b0c10] border border-white/10 shadow-2xl z-50 py-1.5 max-h-60 overflow-y-auto glass-panel">
          {options.map((option) => {
            const isChecked = selectedValues.includes(option.value);
            return (
              <div
                key={option.value}
                onClick={(e) => {
                  e.stopPropagation();
                  handleToggle(option.value);
                }}
                className="flex items-center gap-2.5 px-3 py-2 text-xs text-secondary hover:text-white hover:bg-white/5 cursor-pointer select-none"
              >
                <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-all duration-150 shrink-0 ${
                  isChecked 
                    ? 'bg-teal-400 border-teal-400 text-black shadow-[0_0_8px_rgba(20,184,166,0.3)]' 
                    : 'border-white/20 bg-transparent text-transparent hover:border-white/40'
                }`}>
                  {isChecked && (
                    <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth="3.5" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5"></path>
                    </svg>
                  )}
                </span>
                <span>{option.label}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

interface InvestmentListProps {
  portfolioId: string;
  investments: Investment[];
  rates: ExchangeRates;
  displayCurrency: InvestmentCurrency;
  canWrite: boolean;
  syncingPrices?: boolean;
  syncMessage?: string;
  onSyncLivePrices?: () => Promise<void>;
}

// FD Calculation helper
const calculateFDValue = (
  principal: number,
  ratePercent: number,
  startDateStr: string,
  targetDateStr: string,
  interestType: 'simple' | 'compound',
  frequency: 'monthly' | 'quarterly' | 'half-yearly' | 'yearly'
): number => {
  const start = new Date(startDateStr);
  const target = new Date(targetDateStr);
  
  if (isNaN(start.getTime()) || isNaN(target.getTime())) return principal;
  if (target <= start) return principal;

  const diffTime = target.getTime() - start.getTime();
  const diffDays = diffTime / (1000 * 60 * 60 * 24);
  const t = diffDays / 365.0; // elapsed years
  const r = ratePercent / 100.0;

  if (interestType === 'simple') {
    return principal * (1 + r * t);
  } else {
    const freqMap = {
      monthly: 12,
      quarterly: 4,
      'half-yearly': 2,
      yearly: 1
    };
    const n = freqMap[frequency] || 4;
    return principal * Math.pow(1 + r / n, n * t);
  }
};

export const InvestmentList: React.FC<InvestmentListProps> = ({
  portfolioId,
  investments,
  rates,
  displayCurrency,
  canWrite,
  syncingPrices = false,
  syncMessage = '',
  onSyncLivePrices
}) => {
  // Filter states
  const [typeFilters, setTypeFilters] = useState<string[]>([]);
  const [regionFilters, setRegionFilters] = useState<string[]>([]);
  const [currencyFilters, setCurrencyFilters] = useState<string[]>([]);
  const [institutionFilters, setInstitutionFilters] = useState<string[]>([]);

  // Reset filters when portfolio changes
  useEffect(() => {
    setTypeFilters([]);
    setRegionFilters([]);
    setCurrencyFilters([]);
    setInstitutionFilters([]);
  }, [portfolioId]);


  // Sorting states
  const [sortField, setSortField] = useState<'name' | 'type' | 'region' | 'currentValue' | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  const handleSort = (field: 'name' | 'type' | 'region' | 'currentValue') => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const renderSortIcon = (field: 'name' | 'type' | 'region' | 'currentValue') => {
    if (sortField !== field) {
      return <ChevronDown className="w-3.5 h-3.5 opacity-25 ml-1 inline shrink-0" />;
    }
    return (
      <ChevronDown 
        className="w-3.5 h-3.5 text-teal-400 ml-1 inline shrink-0 transition-transform duration-200" 
        style={{ transform: sortDirection === 'asc' ? 'rotate(180deg)' : 'none' }}
      />
    );
  };

  // Modal states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingInvestment, setEditingInvestment] = useState<Investment | null>(null);

  // Form states
  const [name, setName] = useState('');
  const [type, setType] = useState<InvestmentType>('stock');
  const [region, setRegion] = useState<InvestmentRegion>('India');
  const [currency, setCurrency] = useState<InvestmentCurrency>('INR');
  const [amountInvested, setAmountInvested] = useState('');
  const [currentValue, setCurrentValue] = useState('');
  const [units, setUnits] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [institution, setInstitution] = useState('');
  const [notes, setNotes] = useState('');
  const [ticker, setTicker] = useState('');
  const [schemeCode, setSchemeCode] = useState('');
  
  // SIP Specific fields
  const [isSipActive, setIsSipActive] = useState(false);
  const [sipAmount, setSipAmount] = useState('');
  const [sipFrequency, setSipFrequency] = useState<'weekly' | 'monthly' | 'quarterly'>('monthly');
  const [sipDay, setSipDay] = useState('');
  
  // Insurance Specific fields
  const [policyType, setPolicyType] = useState<'term' | 'health' | 'life' | 'motor' | 'other'>('term');
  const [sumAssured, setSumAssured] = useState('');
  const [premiumAmount, setPremiumAmount] = useState('');
  const [premiumFrequency, setPremiumFrequency] = useState<'monthly' | 'quarterly' | 'half-yearly' | 'yearly'>('yearly');
  const [premiumDueDate, setPremiumDueDate] = useState('');
  const [policyNumber, setPolicyNumber] = useState('');
  
  // FD Specific fields
  const [interestRate, setInterestRate] = useState('');
  const [interestType, setInterestType] = useState<'simple' | 'compound'>('compound');
  const [compoundingFrequency, setCompoundingFrequency] = useState<'monthly' | 'quarterly' | 'half-yearly' | 'yearly'>('quarterly');
  const [startDate, setStartDate] = useState('');
  const [maturityDate, setMaturityDate] = useState('');

  // UI States
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [isCalculatingFd, setIsCalculatingFd] = useState(false);

  // Open modal for adding
  const handleOpenAdd = () => {
    setEditingInvestment(null);
    setName('');
    setType('stock');
    setRegion('India');
    setCurrency('INR');
    setAmountInvested('');
    setCurrentValue('');
    setUnits('');
    setPurchasePrice('');
    setInstitution('');
    setNotes('');
    setTicker('');
    setSchemeCode('');
    setInterestRate('');
    setInterestType('compound');
    setCompoundingFrequency('quarterly');
    setStartDate('');
    setMaturityDate('');
    setIsSipActive(false);
    setSipAmount('');
    setSipFrequency('monthly');
    setSipDay('');
    setPolicyType('term');
    setSumAssured('');
    setPremiumAmount('');
    setPremiumFrequency('yearly');
    setPremiumDueDate('');
    setPolicyNumber('');
    setFormError('');
    setIsModalOpen(true);
  };

  // Open modal for editing
  const handleOpenEdit = (inv: Investment) => {
    setEditingInvestment(inv);
    setName(inv.name);
    setType(inv.type);
    setRegion(inv.region);
    setCurrency(inv.currency);
    setAmountInvested(inv.amountInvested.toString());
    setCurrentValue(inv.currentValue.toString());
    setUnits(inv.units ? inv.units.toString() : '');
    setPurchasePrice(inv.purchasePrice ? inv.purchasePrice.toString() : '');
    setInstitution(inv.institution);
    setNotes(inv.notes || '');
    setTicker(inv.ticker || '');
    setSchemeCode(inv.schemeCode ? inv.schemeCode.toString() : '');
    setInterestRate(inv.interestRate ? inv.interestRate.toString() : '');
    setInterestType(inv.interestType || 'compound');
    setCompoundingFrequency(inv.compoundingFrequency || 'quarterly');
    setStartDate(inv.startDate || '');
    setMaturityDate(inv.maturityDate || '');
    setIsSipActive(inv.isSipActive || false);
    setSipAmount(inv.sipAmount ? inv.sipAmount.toString() : '');
    setSipFrequency(inv.sipFrequency || 'monthly');
    setSipDay(inv.sipDay ? inv.sipDay.toString() : '');
    setPolicyType(inv.policyType || 'term');
    setSumAssured(inv.sumAssured ? inv.sumAssured.toString() : '');
    setPremiumAmount(inv.premiumAmount ? inv.premiumAmount.toString() : '');
    setPremiumFrequency(inv.premiumFrequency || 'yearly');
    setPremiumDueDate(inv.premiumDueDate || '');
    setPolicyNumber(inv.policyNumber || '');
    setFormError('');
    setIsModalOpen(true);
  };

  // Auto calculation triggers
  const handleCalculateFdCurrentValue = () => {
    if (!amountInvested || !interestRate || !startDate) {
      setFormError('FD calculation requires Principal, Interest Rate, and Start Date');
      return;
    }
    setFormError('');
    const p = parseFloat(amountInvested);
    const r = parseFloat(interestRate);
    const todayStr = new Date().toISOString().split('T')[0];
    
    const computedVal = calculateFDValue(
      p, r, startDate, todayStr, interestType, compoundingFrequency
    );
    setCurrentValue(computedVal.toFixed(2));
    setIsCalculatingFd(true);
    setTimeout(() => setIsCalculatingFd(false), 800);
  };

  const handleCalculateFdMaturityValue = () => {
    if (!amountInvested || !interestRate || !startDate || !maturityDate) {
      setFormError('Maturity calculation requires Principal, Rate, Start Date, and Maturity Date');
      return;
    }
    setFormError('');
    const p = parseFloat(amountInvested);
    const r = parseFloat(interestRate);
    
    const computedVal = calculateFDValue(
      p, r, startDate, maturityDate, interestType, compoundingFrequency
    );
    setCurrentValue(computedVal.toFixed(2));
    setIsCalculatingFd(true);
    setTimeout(() => setIsCalculatingFd(false), 800);
  };

  // Handle submit form
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (type === 'insurance') {
      if (!name || !institution || !premiumAmount || !premiumDueDate) {
        setFormError('Name, Institution, Premium Amount, and Premium Due Date are required');
        return;
      }
    } else {
      if (!name || !amountInvested || !institution) {
        setFormError('Name, Invested Amount, and Institution are required');
        return;
      }
    }

    let p = 0;
    let c = 0;

    if (type === 'insurance') {
      p = parseFloat(amountInvested || '0');
      if (isNaN(p) || p < 0) p = 0;

      if (policyType === 'life') {
        c = parseFloat(currentValue || '0');
        if (isNaN(c) || c < 0) {
          setFormError('Current Value (Surrender Value) must be a valid positive number');
          return;
        }
      } else {
        c = 0; // Term, Health, Motor policies have no asset currentValue
      }

      const pAmt = parseFloat(premiumAmount);
      if (isNaN(pAmt) || pAmt <= 0) {
        setFormError('Premium Amount must be a positive number');
        return;
      }
    } else {
      p = parseFloat(amountInvested);
      c = parseFloat(currentValue || amountInvested);

      if (isNaN(p) || p < 0) {
        setFormError('Invested Amount must be a valid positive number');
        return;
      }

      if (isNaN(c) || c < 0) {
        setFormError('Current Value must be a valid positive number');
        return;
      }

      if (isSipActive && (type === 'stock' || type === 'mutual_fund')) {
        const sAmt = parseFloat(sipAmount);
        const sDay = parseInt(sipDay);
        if (isNaN(sAmt) || sAmt <= 0) {
          setFormError('SIP Amount must be a positive number');
          return;
        }
        if (isNaN(sDay) || sDay < 1 || sDay > 28) {
          setFormError('SIP Execution Day must be a number between 1 and 28');
          return;
        }
      }
    }

    setSaving(true);

    const investmentData: any = {
      name,
      type,
      region,
      currency,
      amountInvested: p,
      currentValue: c,
      institution,
      updatedAt: new Date()
    };

    if (units) investmentData.units = parseFloat(units);
    if (purchasePrice) investmentData.purchasePrice = parseFloat(purchasePrice);
    if (notes) investmentData.notes = notes;
    if (ticker) investmentData.ticker = ticker.trim();
    if (schemeCode) investmentData.schemeCode = parseInt(schemeCode.trim());

    if (type === 'stock' || type === 'mutual_fund') {
      investmentData.isSipActive = isSipActive;
      if (isSipActive) {
        investmentData.sipAmount = parseFloat(sipAmount);
        investmentData.sipFrequency = sipFrequency;
        investmentData.sipDay = parseInt(sipDay);
      } else {
        investmentData.sipAmount = null;
        investmentData.sipFrequency = null;
        investmentData.sipDay = null;
      }
    } else {
      investmentData.isSipActive = false;
      investmentData.sipAmount = null;
      investmentData.sipFrequency = null;
      investmentData.sipDay = null;
    }

    if (type === 'insurance') {
      investmentData.policyType = policyType;
      investmentData.sumAssured = parseFloat(sumAssured) || 0;
      investmentData.premiumAmount = parseFloat(premiumAmount);
      investmentData.premiumFrequency = premiumFrequency;
      investmentData.premiumDueDate = premiumDueDate;
      if (policyNumber) investmentData.policyNumber = policyNumber.trim();
    } else {
      investmentData.policyType = null;
      investmentData.sumAssured = null;
      investmentData.premiumAmount = null;
      investmentData.premiumFrequency = null;
      investmentData.premiumDueDate = null;
      investmentData.policyNumber = null;
    }

    if (type === 'fd') {
      if (interestRate) investmentData.interestRate = parseFloat(interestRate);
      investmentData.interestType = interestType;
      investmentData.compoundingFrequency = compoundingFrequency;
      if (maturityDate) investmentData.maturityDate = maturityDate;
    }

    if (startDate) {
      investmentData.startDate = startDate;
    }

    try {
      if (editingInvestment) {
        // Edit mode
        const invRef = doc(db, `portfolios/${portfolioId}/investments`, editingInvestment.id);
        await updateDoc(invRef, investmentData);
      } else {
        // Add mode
        investmentData.createdAt = new Date();
        investmentData.portfolioId = portfolioId;
        const colRef = collection(db, `portfolios/${portfolioId}/investments`);
        const docRef = await addDoc(colRef, { ...investmentData, id: '' });
        // Save the document ID inside the document
        await updateDoc(docRef, { id: docRef.id });
      }
      setIsModalOpen(false);
    } catch (err: any) {
      console.error(err);
      setFormError(err.message || 'Failed to save investment details.');
    } finally {
      setSaving(false);
    }
  };

  // Handle Delete
  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this investment? This action is permanent.')) return;
    try {
      const invRef = doc(db, `portfolios/${portfolioId}/investments`, id);
      await deleteDoc(invRef);
    } catch (err) {
      console.error(err);
      alert('Failed to delete investment.');
    }
  };



  // Get unique institutions for the current portfolio's investments
  const uniqueInstitutions = Array.from(
    new Set(investments.map((inv) => inv.institution).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

  const institutionOptions = uniqueInstitutions.map((inst) => ({
    value: inst,
    label: inst
  }));

  // Filter logic
  const filteredInvestments = investments.filter((inv) => {
    const passType = typeFilters.length === 0 || typeFilters.includes(inv.type);
    const passRegion = regionFilters.length === 0 || regionFilters.includes(inv.region);
    const passCurrency = currencyFilters.length === 0 || currencyFilters.includes(inv.currency);
    const passInstitution = institutionFilters.length === 0 || institutionFilters.includes(inv.institution);
    return passType && passRegion && passCurrency && passInstitution;
  });

  // Sorting logic
  const sortedInvestments = [...filteredInvestments].sort((a, b) => {
    if (!sortField) return 0;

    let valueA: any;
    let valueB: any;

    if (sortField === 'currentValue') {
      valueA = convertCurrency(a.currentValue, a.currency, displayCurrency, rates);
      valueB = convertCurrency(b.currentValue, b.currency, displayCurrency, rates);
    } else if (sortField === 'name' || sortField === 'type' || sortField === 'region') {
      valueA = a[sortField];
      valueB = b[sortField];
    } else {
      return 0;
    }

    if (valueA === valueB) return 0;

    if (typeof valueA === 'string' && typeof valueB === 'string') {
      return sortDirection === 'asc' 
        ? valueA.localeCompare(valueB) 
        : valueB.localeCompare(valueA);
    } else {
      return sortDirection === 'asc' 
        ? (valueA > valueB ? 1 : -1) 
        : (valueA < valueB ? 1 : -1);
    }
  });

  // Calculate totals for filtered investments
  const totalInvested = filteredInvestments.reduce((sum, inv) => {
    return sum + convertCurrency(inv.amountInvested, inv.currency, displayCurrency, rates);
  }, 0);

  const totalCurrent = filteredInvestments.reduce((sum, inv) => {
    return sum + convertCurrency(inv.currentValue, inv.currency, displayCurrency, rates);
  }, 0);

  const totalProfit = totalCurrent - totalInvested;
  const totalProfitPct = totalInvested > 0 ? (totalProfit / totalInvested) * 100 : 0;
  const isTotalProfit = totalProfit >= 0;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header and Add Button */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-3xl font-extrabold tracking-tight">Investments</h2>
          <p className="text-secondary text-sm">Manage and track your assets across different platforms and regions.</p>
        </div>
        {canWrite && (
          <div className="flex items-center gap-3 self-start sm:self-auto">
            <button
              onClick={onSyncLivePrices}
              disabled={syncingPrices || investments.length === 0}
              className="btn btn-secondary text-xs flex items-center gap-1.5 border-teal-500/20 text-teal-400 hover:border-teal-500/50 hover:bg-teal-500/5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncingPrices ? 'animate-spin' : ''}`} />
              {syncingPrices ? 'Syncing...' : 'Sync Live Prices'}
            </button>
            <button onClick={handleOpenAdd} className="btn btn-primary">
              <Plus className="w-4 h-4" />
              Add Investment
            </button>
          </div>
        )}
      </div>

      {syncMessage && (
        <div className="p-3 rounded-xl bg-teal-950/30 border border-teal-500/20 text-teal-300 text-xs flex items-center gap-2 animate-pulse">
          <RefreshCw className="w-4 h-4 animate-spin text-teal-400" />
          <span>{syncMessage}</span>
        </div>
      )}

      {/* Filters Toolbar */}
      <div className="glass-panel p-4 flex flex-wrap items-center gap-4 border-white/5">
        <div className="flex items-center gap-2 text-xs font-semibold text-secondary uppercase tracking-wider">
          <Filter className="w-4 h-4 text-teal-400" />
          <span>Filters:</span>
        </div>

        {/* Type Filter */}
        <MultiSelectFilter
          label="Type"
          options={[
            { value: 'stock', label: 'Stocks' },
            { value: 'mutual_fund', label: 'Mutual Funds' },
            { value: 'fd', label: 'Fixed Deposits' },
            { value: 'savings', label: 'Savings Accounts' },
            { value: 'other', label: 'Other Savings' },
            { value: 'insurance', label: 'Insurance Policies' }
          ]}
          selectedValues={typeFilters}
          onChange={setTypeFilters}
          placeholder="All Types"
        />

        {/* Region Filter */}
        <MultiSelectFilter
          label="Region"
          options={[
            { value: 'India', label: 'India' },
            { value: 'Europe', label: 'Europe' },
            { value: 'Other', label: 'Other' }
          ]}
          selectedValues={regionFilters}
          onChange={setRegionFilters}
          placeholder="All Regions"
        />

        {/* Currency Filter */}
        <MultiSelectFilter
          label="Currency"
          options={[
            { value: 'INR', label: 'INR (₹)' },
            { value: 'EUR', label: 'EUR (€)' },
            { value: 'USD', label: 'USD ($)' }
          ]}
          selectedValues={currencyFilters}
          onChange={setCurrencyFilters}
          placeholder="All Currencies"
        />

        {/* Institution Filter */}
        <MultiSelectFilter
          label="Institution"
          options={institutionOptions}
          selectedValues={institutionFilters}
          onChange={setInstitutionFilters}
          placeholder="All Institutions"
        />

        {/* Clear Filters Button */}
        {(typeFilters.length > 0 || regionFilters.length > 0 || currencyFilters.length > 0 || institutionFilters.length > 0) && (
          <button
            onClick={() => {
              setTypeFilters([]);
              setRegionFilters([]);
              setCurrencyFilters([]);
              setInstitutionFilters([]);
            }}
            className="btn btn-secondary py-1.5 px-3 text-xs text-rose-400 hover:text-white border-rose-500/20 hover:border-rose-500/50 hover:bg-rose-500/5 transition-all duration-150 rounded-lg md:ml-auto"
          >
            Clear Filters
          </button>
        )}
      </div>

      {/* Data Table */}
      <div className="glass-panel overflow-hidden border-white/5">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/5 bg-white/[0.01] text-xs font-bold text-secondary uppercase tracking-wider">
                <th 
                  className="p-4 pl-6 cursor-pointer hover:text-white select-none transition-colors"
                  onClick={() => handleSort('name')}
                >
                  <div className="flex items-center">
                    <span>Asset Name</span>
                    {renderSortIcon('name')}
                  </div>
                </th>
                <th 
                  className="p-4 cursor-pointer hover:text-white select-none transition-colors"
                  onClick={() => handleSort('type')}
                >
                  <div className="flex items-center">
                    <span>Type</span>
                    {renderSortIcon('type')}
                  </div>
                </th>
                <th 
                  className="p-4 cursor-pointer hover:text-white select-none transition-colors"
                  onClick={() => handleSort('region')}
                >
                  <div className="flex items-center">
                    <span>Region</span>
                    {renderSortIcon('region')}
                  </div>
                </th>
                <th className="p-4">Institution</th>
                <th className="p-4 text-right">Invested Value</th>
                <th 
                  className="p-4 text-right cursor-pointer hover:text-white select-none transition-colors"
                  onClick={() => handleSort('currentValue')}
                >
                  <div className="flex items-center justify-end">
                    <span>Current Value</span>
                    {renderSortIcon('currentValue')}
                  </div>
                </th>
                <th className="p-4 text-right">Return (G/L)</th>
                {canWrite && <th className="p-4 pr-6 text-center w-[120px]">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-sm">
              {sortedInvestments.length === 0 ? (
                <tr>
                  <td colSpan={canWrite ? 8 : 7} className="p-8 text-center text-secondary">
                    No investments match selected filters.
                  </td>
                </tr>
              ) : (
                sortedInvestments.map((inv) => {
                  const profit = inv.currentValue - inv.amountInvested;
                  const profitPct = inv.amountInvested > 0 ? (profit / inv.amountInvested) * 100 : 0;
                  const isProfit = profit >= 0;

                  return (
                    <tr key={inv.id} className="hover:bg-white/[0.02] transition-colors duration-150">
                      <td className="p-4 pl-6 font-semibold text-white">
                        <div>{inv.name}</div>
                        {inv.units && (
                          <div className="text-xs text-muted font-mono mt-0.5">
                            {inv.units} units @ {formatCurrency(inv.purchasePrice || (inv.amountInvested / inv.units), inv.currency)}
                          </div>
                        )}
                        {inv.type === 'fd' && inv.interestRate && (
                          <div className="text-xs text-teal-400 font-mono mt-0.5 flex items-center gap-1">
                            <Landmark className="w-3 h-3" />
                            <span>{inv.interestRate}% ({inv.interestType})</span>
                            {inv.maturityDate && <span>• Matures: {inv.maturityDate}</span>}
                          </div>
                        )}
                        {inv.isSipActive && inv.sipAmount && (
                          <div className="text-[11px] text-teal-300 font-mono mt-1 flex items-center gap-1 bg-teal-500/10 border border-teal-500/20 px-2 py-0.5 rounded w-fit uppercase tracking-wider font-bold">
                            <span className="animate-pulse">🔄</span>
                            <span>SIP: {formatCurrency(inv.sipAmount, inv.currency)} / {inv.sipFrequency} (Day {inv.sipDay})</span>
                          </div>
                        )}
                        {inv.type === 'insurance' && inv.premiumAmount && (
                          <div className="text-[11px] text-indigo-300 font-mono mt-1 flex flex-col gap-1 bg-indigo-500/10 border border-indigo-500/20 px-2.5 py-1 rounded w-fit">
                            <div className="flex items-center gap-1 font-bold uppercase tracking-wider text-xs">
                              <span>🛡️</span>
                              <span className="capitalize">{inv.policyType || 'insurance'} cover</span>
                              {inv.policyNumber && <span className="opacity-60 font-medium font-sans lowercase">• #{inv.policyNumber}</span>}
                            </div>
                            <div className="text-[10px] text-secondary flex flex-wrap items-center gap-x-1.5 gap-y-0.5 font-semibold mt-0.5">
                              <span>Sum Assured: {inv.sumAssured ? formatCurrency(inv.sumAssured, inv.currency) : 'N/A'}</span>
                              <span>•</span>
                              <span>Premium: {formatCurrency(inv.premiumAmount, inv.currency)} ({inv.premiumFrequency})</span>
                              <span>•</span>
                              <span className="text-indigo-200">Due: {inv.premiumDueDate}</span>
                            </div>
                          </div>
                        )}
                      </td>
                      <td className="p-4 capitalize">
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-white/5 text-secondary border border-white/10">
                          {inv.type === 'mutual_fund' ? 'Mutual Fund' : inv.type === 'fd' ? 'Fixed Deposit' : inv.type === 'insurance' ? 'Insurance' : inv.type}
                        </span>
                      </td>
                      <td className="p-4">
                        <span className={`badge ${
                          inv.region === 'India' ? 'badge-india' : 
                          inv.region === 'Europe' ? 'badge-europe' : 'badge-other'
                        }`}>
                          {inv.region}
                        </span>
                      </td>
                      <td className="p-4 text-secondary">{inv.institution}</td>
                      <td className="p-4 text-right font-mono font-semibold">
                        {formatCurrency(inv.amountInvested, inv.currency)}
                      </td>
                      <td className="p-4 text-right font-mono font-bold text-white">
                        {formatCurrency(inv.currentValue, inv.currency)}
                      </td>
                      <td className="p-4 text-right font-mono font-semibold">
                        <div className={isProfit ? 'text-green-400' : 'text-red-400'}>
                          {isProfit ? '+' : ''}{formatCurrency(profit, inv.currency)}
                        </div>
                        <div className={`text-xs ${isProfit ? 'text-green-400/80' : 'text-red-400/80'}`}>
                          {isProfit ? '+' : ''}{profitPct.toFixed(2)}%
                        </div>
                      </td>
                      {canWrite && (
                        <td className="p-4 pr-6 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <button 
                              onClick={() => handleOpenEdit(inv)}
                              className="p-1.5 rounded-lg hover:bg-white/5 text-secondary hover:text-white transition-colors duration-150"
                              title="Edit Investment"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button 
                              onClick={() => handleDelete(inv.id)}
                              className="p-1.5 rounded-lg hover:bg-white/5 text-secondary hover:text-red-400 transition-colors duration-150"
                              title="Delete Investment"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
            {filteredInvestments.length > 0 && (
              <tfoot className="border-t-2 border-white/10 bg-white/[0.03] text-sm font-bold text-white">
                <tr className="hover:bg-white/[0.02]">
                  <td colSpan={4} className="p-4 pl-6 text-left text-teal-400 font-extrabold uppercase tracking-wide">
                    Total (Filtered ({displayCurrency}))
                  </td>
                  <td className="p-4 text-right font-mono text-secondary">
                    {formatCurrency(totalInvested, displayCurrency)}
                  </td>
                  <td className="p-4 text-right font-mono text-teal-300">
                    {formatCurrency(totalCurrent, displayCurrency)}
                  </td>
                  <td className="p-4 text-right font-mono">
                    <div className={isTotalProfit ? 'text-green-400' : 'text-red-400'}>
                      {isTotalProfit ? '+' : ''}{formatCurrency(totalProfit, displayCurrency)}
                    </div>
                    <div className={`text-xs ${isTotalProfit ? 'text-green-400/85' : 'text-red-400/85'} font-semibold mt-0.5`}>
                      {isTotalProfit ? '+' : ''}{totalProfitPct.toFixed(2)}%
                    </div>
                  </td>
                  {canWrite && <td className="p-4"></td>}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Add / Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="glass-panel w-full max-w-2xl p-6 border-white/10 animate-fade-in max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-bold mb-4">
              {editingInvestment ? 'Edit Investment' : 'Add Investment'}
            </h3>

            {formError && (
              <div className="mb-4 p-3 rounded-lg bg-red-950/40 border border-red-500/20 text-red-400 text-sm">
                {formError}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Asset Name */}
                <div>
                  <label>Asset Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Reliance Stocks, SBI FD, EUR Savings"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>

                {/* Institution */}
                <div>
                  <label>Institution / Provider *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Zerodha, HDFC Bank, Trade Republic"
                    value={institution}
                    onChange={(e) => setInstitution(e.target.value)}
                  />
                </div>

                {/* Type */}
                <div>
                  <label>Asset Type</label>
                  <select value={type} onChange={(e) => setType(e.target.value as InvestmentType)}>
                    <option value="stock">Stock</option>
                    <option value="mutual_fund">Mutual Fund</option>
                    <option value="fd">Fixed Deposit (FD)</option>
                    <option value="savings">Savings Account</option>
                    <option value="other">Other Savings</option>
                    <option value="insurance">Insurance Policy</option>
                  </select>
                </div>

                {/* Region */}
                <div>
                  <label>Region</label>
                  <select value={region} onChange={(e) => setRegion(e.target.value as InvestmentRegion)}>
                    <option value="India">India</option>
                    <option value="Europe">Europe</option>
                    <option value="Other">Other</option>
                  </select>
                </div>

                {/* Currency */}
                <div>
                  <label>Currency</label>
                  <select value={currency} onChange={(e) => setCurrency(e.target.value as InvestmentCurrency)}>
                    <option value="INR">INR (₹)</option>
                    <option value="EUR">EUR (€)</option>
                    <option value="USD">USD ($)</option>
                  </select>
                </div>

                {/* Amount Invested */}
                <div>
                  <label>{type === 'insurance' ? 'Total Premiums Paid to Date (optional)' : 'Amount Invested (Capital) *'}</label>
                  <input
                    type="number"
                    step="any"
                    required={type !== 'insurance'}
                    min="0"
                    placeholder="0.00"
                    value={amountInvested}
                    onChange={(e) => {
                      const val = e.target.value;
                      setAmountInvested(val);
                      if (val && units && (type === 'stock' || type === 'mutual_fund')) {
                        const amt = parseFloat(val);
                        const u = parseFloat(units);
                        if (!isNaN(amt) && !isNaN(u) && u > 0) {
                          setPurchasePrice((amt / u).toFixed(4));
                        }
                      }
                    }}
                  />
                </div>

                {/* Current Value */}
                {(type !== 'insurance' || policyType === 'life') && (
                  <div>
                    <label className="flex items-center justify-between">
                      <span>{type === 'insurance' ? 'Current Surrender Value (Net Worth) *' : 'Current Value *'}</span>
                      {type === 'fd' && (
                        <span className="text-[10px] text-teal-400 flex items-center gap-0.5">
                          <Info className="w-3 h-3" /> Use Calculator Below
                        </span>
                      )}
                    </label>
                    <input
                      type="number"
                      step="any"
                      required
                      min="0"
                      placeholder="0.00"
                      className={isCalculatingFd ? 'border-teal-400 bg-teal-950/20' : ''}
                      value={currentValue}
                      onChange={(e) => setCurrentValue(e.target.value)}
                    />
                  </div>
                )}

                {/* Purchase Date */}
                {type !== 'fd' && type !== 'insurance' && (
                  <div>
                    <label>Purchase Date (optional, for Tax tracking)</label>
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                    />
                  </div>
                )}

                {/* Stocks/MF details */}
                {(type === 'stock' || type === 'mutual_fund') && (
                  <>
                    <div>
                      <label>Total Units / Quantity (U)</label>
                      <input
                        type="number"
                        step="any"
                        min="0"
                        placeholder="e.g. 52.4"
                        value={units}
                        onChange={(e) => {
                          const val = e.target.value;
                          setUnits(val);
                          if (val && purchasePrice) {
                            const u = parseFloat(val);
                            const p = parseFloat(purchasePrice);
                            if (!isNaN(u) && !isNaN(p)) {
                              setAmountInvested((u * p).toFixed(2));
                            }
                          }
                        }}
                      />
                    </div>
                    <div>
                      <label>Avg Purchase Price / Initial Value Per Share (P)</label>
                      <input
                        type="number"
                        step="any"
                        min="0"
                        placeholder="e.g. 1540.50"
                        value={purchasePrice}
                        onChange={(e) => {
                          const val = e.target.value;
                          setPurchasePrice(val);
                          if (units && val) {
                            const u = parseFloat(units);
                            const p = parseFloat(val);
                            if (!isNaN(u) && !isNaN(p)) {
                              setAmountInvested((u * p).toFixed(2));
                            }
                          }
                        }}
                      />
                    </div>
                    {type === 'stock' && (
                      <div>
                        <label>Yahoo Finance Ticker Symbol</label>
                        <input
                          type="text"
                          placeholder="e.g. RELIANCE.NS, INFy.NS"
                          value={ticker}
                          onChange={(e) => setTicker(e.target.value)}
                        />
                      </div>
                    )}
                    {type === 'mutual_fund' && (
                      <div>
                        <label>AMFI Scheme Code</label>
                        <input
                          type="number"
                          placeholder="e.g. 122640"
                          value={schemeCode}
                          onChange={(e) => setSchemeCode(e.target.value)}
                        />
                      </div>
                    )}

                    {/* Systematic Investment Plan (SIP) Panel */}
                    <div className="col-span-1 md:col-span-2 p-4 rounded-xl border border-white/5 bg-white/[0.02] mt-2 space-y-4">
                      <label className="flex items-start gap-3 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={isSipActive}
                          onChange={(e) => setIsSipActive(e.target.checked)}
                          className="w-4 h-4 mt-0.5 rounded border-white/20 bg-transparent text-teal-400 focus:ring-teal-400 focus:ring-offset-0 shrink-0"
                        />
                        <div>
                          <span className="font-bold text-sm text-white">Active Systematic Investment Plan (SIP)</span>
                          <p className="text-xs text-secondary mt-0.5">Configure recurring monthly, weekly, or quarterly investments for portfolio projections and upcoming payment forecasts.</p>
                        </div>
                      </label>

                      {isSipActive && (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t border-white/5 animate-fade-in animate-duration-200">
                          <div>
                            <label className="text-[11px] uppercase tracking-wider font-semibold text-secondary">SIP Amount ({currency}) *</label>
                            <input
                              type="number"
                              step="any"
                              required
                              min="1"
                              placeholder="0.00"
                              value={sipAmount}
                              onChange={(e) => setSipAmount(e.target.value)}
                              className="w-full mt-1 bg-black/40 border border-white/15 rounded-lg py-1.5 px-3 text-sm text-white"
                            />
                          </div>
                          <div>
                            <label className="text-[11px] uppercase tracking-wider font-semibold text-secondary">SIP Frequency *</label>
                            <select
                              value={sipFrequency}
                              onChange={(e) => setSipFrequency(e.target.value as any)}
                              className="w-full mt-1 bg-black/40 border border-white/15 rounded-lg py-1.5 px-3 text-sm text-white"
                            >
                              <option value="weekly">Weekly</option>
                              <option value="monthly">Monthly</option>
                              <option value="quarterly">Quarterly</option>
                            </select>
                          </div>
                          <div>
                            <label className="text-[11px] uppercase tracking-wider font-semibold text-secondary">Execution Day (1-28) *</label>
                            <input
                              type="number"
                              required
                              min="1"
                              max="28"
                              placeholder="e.g. 10"
                              value={sipDay}
                              onChange={(e) => {
                                const val = parseInt(e.target.value);
                                if (!isNaN(val)) {
                                  setSipDay(Math.min(28, Math.max(1, val)).toString());
                                } else {
                                  setSipDay(e.target.value);
                                }
                              }}
                              className="w-full mt-1 bg-black/40 border border-white/15 rounded-lg py-1.5 px-3 text-sm text-white"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                )}

                {type === 'insurance' && (
                  <>
                    {/* Policy Type */}
                    <div>
                      <label>Policy Category *</label>
                      <select value={policyType} onChange={(e) => setPolicyType(e.target.value as any)}>
                        <option value="term">Term Life Insurance</option>
                        <option value="health">Health / Medical Insurance</option>
                        <option value="life">Traditional Life Insurance (Surrender Value)</option>
                        <option value="motor">Vehicle / Motor Insurance</option>
                        <option value="other">Other Insurance Policy</option>
                      </select>
                    </div>

                    {/* Policy Number */}
                    <div>
                      <label>Policy Number (optional)</label>
                      <input
                        type="text"
                        placeholder="e.g. POL-1294819"
                        value={policyNumber}
                        onChange={(e) => setPolicyNumber(e.target.value)}
                      />
                    </div>

                    {/* Sum Assured */}
                    <div>
                      <label>Sum Assured / Cover Limit ({currency})</label>
                      <input
                        type="number"
                        min="0"
                        placeholder="e.g. 10000000"
                        value={sumAssured}
                        onChange={(e) => setSumAssured(e.target.value)}
                      />
                    </div>

                    {/* Premium Amount */}
                    <div>
                      <label>Premium Amount ({currency}) *</label>
                      <input
                        type="number"
                        min="1"
                        placeholder="0.00"
                        value={premiumAmount}
                        onChange={(e) => setPremiumAmount(e.target.value)}
                      />
                    </div>

                    {/* Premium Frequency */}
                    <div>
                      <label>Premium Payment Frequency *</label>
                      <select value={premiumFrequency} onChange={(e) => setPremiumFrequency(e.target.value as any)}>
                        <option value="monthly">Monthly</option>
                        <option value="quarterly">Quarterly</option>
                        <option value="half-yearly">Half-Yearly</option>
                        <option value="yearly">Yearly</option>
                      </select>
                    </div>

                    {/* Premium Due Date */}
                    <div>
                      <label>Next Premium Due Date *</label>
                      <input
                        type="date"
                        required
                        value={premiumDueDate}
                        onChange={(e) => setPremiumDueDate(e.target.value)}
                      />
                    </div>
                  </>
                )}
              </div>

              {/* FD Calculations Module */}
              {type === 'fd' && (
                <div className="p-4 rounded-xl border border-teal-500/10 bg-teal-950/5 space-y-3">
                  <div className="flex items-center gap-2 text-sm font-semibold text-teal-400">
                    <Calculator className="w-4 h-4" />
                    <span>Automated FD Interest Calculator</span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <label className="text-[11px]">Interest Rate (%)</label>
                      <input
                        type="number"
                        step="0.01"
                        placeholder="e.g. 7.10"
                        className="py-1.5 px-3 text-xs bg-black/40"
                        value={interestRate}
                        onChange={(e) => setInterestRate(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-[11px]">Compounding Type</label>
                      <select 
                        className="py-1.5 px-3 text-xs bg-black/40"
                        value={interestType} 
                        onChange={(e) => setInterestType(e.target.value as 'simple' | 'compound')}
                      >
                        <option value="compound">Compound Interest</option>
                        <option value="simple">Simple Interest</option>
                      </select>
                    </div>
                    {interestType === 'compound' && (
                      <div>
                        <label className="text-[11px]">Frequency</label>
                        <select 
                          className="py-1.5 px-3 text-xs bg-black/40"
                          value={compoundingFrequency} 
                          onChange={(e) => setCompoundingFrequency(e.target.value as any)}
                        >
                          <option value="monthly">Monthly</option>
                          <option value="quarterly">Quarterly</option>
                          <option value="half-yearly">Half-Yearly</option>
                          <option value="yearly">Yearly</option>
                        </select>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px]">Start Date</label>
                      <div className="relative">
                        <input
                          type="date"
                          className="py-1.5 px-3 text-xs bg-black/40"
                          value={startDate}
                          onChange={(e) => setStartDate(e.target.value)}
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-[11px]">Maturity Date</label>
                      <input
                        type="date"
                        className="py-1.5 px-3 text-xs bg-black/40"
                        value={maturityDate}
                        onChange={(e) => setMaturityDate(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 pt-2 border-t border-teal-500/10">
                    <button
                      type="button"
                      onClick={handleCalculateFdCurrentValue}
                      className="btn btn-secondary py-1 px-3 text-xs text-teal-400 hover:text-white flex items-center gap-1 border-teal-500/20 hover:border-teal-500/50"
                    >
                      <TrendingUp className="w-3.5 h-3.5" />
                      Calculate Value (Today)
                    </button>
                    <button
                      type="button"
                      onClick={handleCalculateFdMaturityValue}
                      className="btn btn-secondary py-1 px-3 text-xs text-teal-400 hover:text-white flex items-center gap-1 border-teal-500/20 hover:border-teal-500/50"
                    >
                      <Calendar className="w-3.5 h-3.5" />
                      Calculate Maturity Value
                    </button>
                  </div>
                </div>
              )}

              {/* Notes */}
              <div>
                <label>Notes</label>
                <textarea
                  rows={2}
                  placeholder="Memo, locking details or extra metadata"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>

              {/* Buttons */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-white/5">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="btn btn-secondary"
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={saving}
                >
                  {saving ? 'Saving...' : 'Save Investment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
