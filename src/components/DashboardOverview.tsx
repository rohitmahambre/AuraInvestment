import React, { useState, useEffect } from 'react';
import type { Investment, ExchangeRates, InvestmentCurrency } from '../types';
import { convertCurrency, formatCurrency, getHistoricalRate } from '../utils/exchangeRates';
import { 
  ResponsiveContainer, 
  PieChart, 
  Pie, 
  Cell, 
  Tooltip, 
  Legend, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid 
} from 'recharts';
import { 
  Wallet, ArrowUpRight, ArrowDownRight, Globe, Percent, ShieldCheck,
  ArrowLeft, Landmark, Eye, BarChart3, Printer, AlertCircle
} from 'lucide-react';

interface DashboardOverviewProps {
  investments: Investment[];
  rates: ExchangeRates;
  displayCurrency: InvestmentCurrency;
  setDisplayCurrency: (currency: InvestmentCurrency) => void;
}

export const DashboardOverview: React.FC<DashboardOverviewProps> = ({
  investments,
  rates,
  displayCurrency,
  setDisplayCurrency
}) => {
  // Aggregate stats
  const totalInvested = investments.reduce((sum, inv) => {
    return sum + convertCurrency(inv.amountInvested, inv.currency, displayCurrency, rates);
  }, 0);

  const totalCurrentValue = investments.reduce((sum, inv) => {
    return sum + convertCurrency(inv.currentValue, inv.currency, displayCurrency, rates);
  }, 0);

  // FX Impact Calculation
  const totalInvestedHistorical = investments.reduce((sum, inv) => {
    if (inv.currency === displayCurrency) {
      return sum + inv.amountInvested;
    }
    const histRate = getHistoricalRate(inv.currency, displayCurrency, inv.startDate, rates);
    return sum + (inv.amountInvested * histRate);
  }, 0);

  const totalGainWithHistorical = totalCurrentValue - totalInvestedHistorical;

  const totalFxImpact = investments.reduce((sum, inv) => {
    if (inv.currency === displayCurrency) return sum;
    const currentRate = convertCurrency(1, inv.currency, displayCurrency, rates);
    const histRate = getHistoricalRate(inv.currency, displayCurrency, inv.startDate, rates);
    const impact = inv.currentValue * (currentRate - histRate);
    return sum + impact;
  }, 0);

  const totalAssetGain = totalGainWithHistorical - totalFxImpact;

  const absoluteGainLoss = totalCurrentValue - totalInvested;
  const gainLossPercentage = totalInvested > 0 ? (absoluteGainLoss / totalInvested) * 100 : 0;
  const isProfit = absoluteGainLoss >= 0;

  // Calculate upcoming payments (SIPs + Insurance Premiums) in next 30 days
  const getNextExecutionDate = (sipDay: number) => {
    const now = new Date();
    let execDate = new Date(now.getFullYear(), now.getMonth(), sipDay);
    if (sipDay < now.getDate()) {
      execDate = new Date(now.getFullYear(), now.getMonth() + 1, sipDay);
    }
    return execDate;
  };

  const getDaysUntil = (execDate: Date) => {
    const now = new Date();
    const d1 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const d2 = new Date(execDate.getFullYear(), execDate.getMonth(), execDate.getDate());
    const diffTime = d2.getTime() - d1.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  };

  const getInsuranceDaysUntil = (dueDateStr: string) => {
    if (!dueDateStr) return 999;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const parts = dueDateStr.split('-');
    const due = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    const diffTime = due.getTime() - today.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  };

  const sipsList = investments
    .filter(inv => inv.isSipActive && inv.sipAmount && inv.sipDay)
    .map(inv => {
      const execDate = getNextExecutionDate(inv.sipDay!);
      const daysLeft = getDaysUntil(execDate);
      return {
        id: `${inv.id}-sip`,
        paymentType: 'sip' as const,
        name: inv.name,
        institution: inv.institution,
        frequency: inv.sipFrequency || 'monthly',
        currency: inv.currency,
        rawAmount: inv.sipAmount!,
        dueDate: execDate,
        daysLeft,
        amountInDisplayCurrency: convertCurrency(inv.sipAmount!, inv.currency, displayCurrency, rates)
      };
    });

  const premiumsList = investments
    .filter(inv => inv.type === 'insurance' && inv.premiumAmount && inv.premiumDueDate)
    .map(inv => {
      const daysLeft = getInsuranceDaysUntil(inv.premiumDueDate!);
      const parts = inv.premiumDueDate!.split('-');
      const dueDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
      return {
        id: `${inv.id}-premium`,
        paymentType: 'insurance_premium' as const,
        name: inv.name,
        institution: inv.institution,
        frequency: inv.premiumFrequency || 'yearly',
        currency: inv.currency,
        rawAmount: inv.premiumAmount!,
        dueDate,
        daysLeft,
        amountInDisplayCurrency: convertCurrency(inv.premiumAmount!, inv.currency, displayCurrency, rates)
      };
    });

  const upcomingPayments = [...sipsList, ...premiumsList]
    .filter(item => item.daysLeft >= -5 && item.daysLeft <= 30)
    .sort((a, b) => a.daysLeft - b.daysLeft);

  // Insurance Coverage Aggregates
  const insurancePolicies = investments.filter(inv => inv.type === 'insurance');
  const totalTermCover = insurancePolicies
    .filter(p => p.policyType === 'term')
    .reduce((sum, p) => sum + convertCurrency(p.sumAssured || 0, p.currency, displayCurrency, rates), 0);

  const totalHealthCover = insurancePolicies
    .filter(p => p.policyType === 'health')
    .reduce((sum, p) => sum + convertCurrency(p.sumAssured || 0, p.currency, displayCurrency, rates), 0);

  const totalLifeCover = insurancePolicies
    .filter(p => p.policyType === 'life')
    .reduce((sum, p) => sum + convertCurrency(p.sumAssured || 0, p.currency, displayCurrency, rates), 0);

  const totalOtherCover = insurancePolicies
    .filter(p => p.policyType === 'motor' || p.policyType === 'other')
    .reduce((sum, p) => sum + convertCurrency(p.sumAssured || 0, p.currency, displayCurrency, rates), 0);

  // State for interactive drill-downs and spotlight
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null);
  const [spotlightAssetId, setSpotlightAssetId] = useState<string | null>(null);

  // Reset drill-downs if investments list changes or portfolio changes
  useEffect(() => {
    setSelectedType(null);
    setSelectedRegion(null);
    setSpotlightAssetId(null);
  }, [investments]);

  // 1. Data Prep: Allocation by Type
  const typeMap: Record<string, number> = {};
  investments.forEach((inv) => {
    const val = convertCurrency(inv.currentValue, inv.currency, displayCurrency, rates);
    const typeLabel = inv.type === 'mutual_fund' ? 'Mutual Fund' : inv.type.toUpperCase();
    typeMap[typeLabel] = (typeMap[typeLabel] || 0) + val;
  });

  const typeData = Object.entries(typeMap).map(([name, value]) => ({
    name,
    value,
  })).sort((a, b) => b.value - a.value);

  // Drill-down data prep for Type (grouped by Institution)
  const getTypeDrillDownData = () => {
    if (!selectedType) return [];
    const dbType = selectedType === 'Mutual Fund' ? 'mutual_fund' : selectedType.toLowerCase();
    const instMap: Record<string, number> = {};
    investments
      .filter((inv) => inv.type === dbType)
      .forEach((inv) => {
        const val = convertCurrency(inv.currentValue, inv.currency, displayCurrency, rates);
        instMap[inv.institution] = (instMap[inv.institution] || 0) + val;
      });

    return Object.entries(instMap).map(([name, value]) => ({
      name,
      value
    })).sort((a, b) => b.value - a.value);
  };

  const typeDrillDownData = getTypeDrillDownData();

  // 2. Data Prep: Allocation by Region
  const regionMap: Record<string, number> = {};
  investments.forEach((inv) => {
    const val = convertCurrency(inv.currentValue, inv.currency, displayCurrency, rates);
    regionMap[inv.region] = (regionMap[inv.region] || 0) + val;
  });

  const regionData = Object.entries(regionMap).map(([name, value]) => ({
    name,
    value,
  })).sort((a, b) => b.value - a.value);

  // Drill-down data prep for Region (grouped by Institution)
  const getRegionDrillDownData = () => {
    if (!selectedRegion) return [];
    const instMap: Record<string, number> = {};
    investments
      .filter((inv) => inv.region === selectedRegion)
      .forEach((inv) => {
        const val = convertCurrency(inv.currentValue, inv.currency, displayCurrency, rates);
        instMap[inv.institution] = (instMap[inv.institution] || 0) + val;
      });

    return Object.entries(instMap).map(([name, value]) => ({
      name,
      value
    })).sort((a, b) => b.value - a.value);
  };

  const regionDrillDownData = getRegionDrillDownData();

  // 3. Data Prep: Top 5 Holdings
  const topHoldingsData = [...investments]
    .map((inv) => ({
      id: inv.id,
      name: inv.name,
      value: convertCurrency(inv.currentValue, inv.currency, displayCurrency, rates),
      type: inv.type,
      region: inv.region
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);

  // Spotlight Asset details
  const spotlightAsset = investments.find(inv => inv.id === spotlightAssetId);

  // Colors for charts
  const TYPE_COLORS = [
    '#00F2FE', // Cyan/Teal
    '#8A57FE', // Indigo
    '#10B981', // Emerald
    '#F59E0B', // Gold
    '#F43F5E', // Rose
    '#3B82F6'  // Blue
  ];

  const REGION_COLORS = {
    India: '#F97316',  // Amber/Orange for India
    Europe: '#3B82F6', // Blue for Europe
    Other: '#10B981'   // Emerald for Other
  };

  // Custom tooltips
  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="glass-panel p-3 border border-white/10 text-xs">
          <p className="font-semibold text-white mb-1">{payload[0].name}</p>
          <p className="text-teal-400 font-mono">
            {formatCurrency(payload[0].value, displayCurrency)}
          </p>
          {payload[0].payload.percent !== undefined && (
            <p className="text-secondary mt-0.5">
              {(payload[0].payload.percent * 100).toFixed(1)}% of total
            </p>
          )}
        </div>
      );
    }
    return null;
  };

  // Interactive Click Handlers
  const handleTypePieClick = (data: any) => {
    if (!data || !data.name) return;
    if (selectedType) {
      setSelectedType(null);
    } else {
      setSelectedType(data.name);
    }
  };

  const handleRegionPieClick = (data: any) => {
    if (!data || !data.name) return;
    if (selectedRegion) {
      setSelectedRegion(null);
    } else {
      setSelectedRegion(data.name);
    }
  };

  const handleBarClick = (data: any) => {
    if (!data || !data.id) return;
    if (spotlightAssetId === data.id) {
      setSpotlightAssetId(null);
    } else {
      setSpotlightAssetId(data.id);
    }
  };

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Top Banner & Currency Control */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className="text-3xl font-extrabold tracking-tight">Portfolio Dashboard</h2>
          <p className="text-secondary text-sm">
            Centralized statistics aggregate of your assets in real time (Exchange rates updated: {rates.date})
          </p>
        </div>
        
        <div className="flex items-center gap-3 self-start md:self-auto no-print">
          {/* Currency Switcher */}
          <div className="flex items-center gap-2 bg-surface-dark p-1 rounded-xl border border-white/5">
            {(['INR', 'EUR', 'USD'] as InvestmentCurrency[]).map((cur) => (
              <button
                key={cur}
                onClick={() => setDisplayCurrency(cur)}
                className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all duration-200 ${
                  displayCurrency === cur
                    ? 'bg-gradient-to-tr from-teal-500 to-teal-400 text-black shadow-lg shadow-teal-500/10'
                    : 'text-secondary hover:text-white'
                }`}
              >
                {cur}
              </button>
            ))}
          </div>

          <button
            onClick={() => window.print()}
            className="btn btn-secondary py-1.5 px-4 text-xs font-bold flex items-center gap-2 border-white/5 hover:border-teal-500/30 text-secondary hover:text-white"
          >
            <Printer className="w-4 h-4 text-teal-400" />
            Export Wealth Report
          </button>
        </div>
      </div>

      {/* Metric Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Card 1: Total Value */}
        <div className="glass-panel p-6 flex items-center justify-between border-l-4 border-l-[var(--primary)]">
          <div className="space-y-1">
            <span className="text-xs font-semibold text-secondary uppercase tracking-wider">Net Worth (Current)</span>
            <div className="text-3xl font-bold font-display glow-text text-white font-mono">
              {formatCurrency(totalCurrentValue, displayCurrency)}
            </div>
            <div className="text-xs text-secondary flex items-center gap-1.5 mt-1">
              <Globe className="w-3.5 h-3.5 text-teal-400/70" />
              <span>Aggregated portfolio value</span>
            </div>
          </div>
          <div className="w-12 h-12 rounded-xl bg-teal-500/10 border border-teal-500/20 flex items-center justify-center text-teal-400 shadow-inner">
            <Wallet className="w-6 h-6" />
          </div>
        </div>

        {/* Card 2: Total Invested */}
        <div className="glass-panel p-6 flex items-center justify-between border-l-4 border-l-[var(--secondary)]">
          <div className="space-y-1">
            <span className="text-xs font-semibold text-secondary uppercase tracking-wider">Total Capital Invested</span>
            <div className="text-3xl font-bold font-display text-white font-mono">
              {formatCurrency(totalInvested, displayCurrency)}
            </div>
            <div className="text-xs text-secondary flex items-center gap-1.5 mt-1">
              <ShieldCheck className="w-3.5 h-3.5 text-indigo-400/70" />
              <span>Base cost of all entries</span>
            </div>
          </div>
          <div className="w-12 h-12 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
            <Percent className="w-6 h-6" />
          </div>
        </div>

        {/* Card 3: Gains/Losses */}
        <div className={`glass-panel p-6 flex items-center justify-between border-l-4 ${isProfit ? 'border-l-[var(--success)]' : 'border-l-[var(--danger)]'}`}>
          <div className="space-y-1">
            <span className="text-xs font-semibold text-secondary uppercase tracking-wider">Total Return</span>
            <div className={`text-3xl font-bold font-display flex items-center gap-1 font-mono ${isProfit ? 'text-green-400' : 'text-red-400'}`}>
              {isProfit ? '+' : ''}{formatCurrency(absoluteGainLoss, displayCurrency)}
            </div>
            <div className="text-xs font-semibold flex items-center gap-1 mt-1">
              {isProfit ? (
                <span className="text-green-400 bg-green-500/10 border border-green-500/20 px-2 py-0.5 rounded-full flex items-center gap-0.5">
                  <ArrowUpRight className="w-3.5 h-3.5" />
                  {gainLossPercentage.toFixed(2)}%
                </span>
              ) : (
                <span className="text-red-400 bg-red-500/10 border border-red-500/20 px-2 py-0.5 rounded-full flex items-center gap-0.5">
                  <ArrowDownRight className="w-3.5 h-3.5" />
                  {gainLossPercentage.toFixed(2)}%
                </span>
              )}
              <span className="text-secondary ml-1">Overall return rate</span>
            </div>
          </div>
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${isProfit ? 'bg-green-500/10 border border-green-500/20 text-green-400' : 'bg-red-500/10 border border-red-500/20 text-red-400'}`}>
            {isProfit ? <ArrowUpRight className="w-6 h-6" /> : <ArrowDownRight className="w-6 h-6" />}
          </div>
        </div>
      </div>

      {investments.length === 0 ? (
        <div className="glass-panel p-12 text-center flex flex-col items-center justify-center">
          <Wallet className="w-16 h-16 text-muted mb-4" />
          <h3 className="text-xl font-bold mb-2">No investments added yet</h3>
          <p className="text-secondary max-w-md mb-6">
            Begin by adding your stocks, mutual funds, FDs, or general savings in the Investments tab, or import your current exports using the CSV Importer.
          </p>
        </div>
      ) : (
        <>
          {/* Upcoming Payments Forecasting Calendar */}
          {upcomingPayments.length > 0 && (
            <div className="glass-panel p-6 border-l-4 border-l-indigo-400 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest block flex items-center gap-1.5">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
                    </span>
                    Cashflow Forecasting & Premium Calendar
                  </span>
                  <h3 className="text-xl font-bold text-white flex items-center gap-2">
                    Upcoming Premium & SIP Payments
                  </h3>
                  <p className="text-xs text-secondary leading-relaxed">
                    Chronological timeline of recurring investments and policy premiums due in the next 30 days.
                  </p>
                </div>
                <div className="p-3 bg-indigo-950/10 rounded-xl border border-indigo-500/10 text-xs text-indigo-300 max-w-sm flex items-start gap-2 self-start sm:self-auto">
                  <AlertCircle className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                  <span>
                    <strong>Note:</strong> Ensure linked bank accounts at target institutions have sufficient capital on execution dates.
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pt-2">
                {upcomingPayments.map((item) => {
                  const formattedDate = item.dueDate.toLocaleDateString(undefined, {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric'
                  });

                  return (
                    <div key={item.id} className="relative bg-white/[0.01] hover:bg-white/[0.03] p-4 rounded-xl border border-white/5 transition-all duration-200 flex flex-col justify-between">
                      <div className="space-y-2">
                        <div className="flex justify-between items-start">
                          <span className={`text-[10px] font-bold font-mono uppercase bg-white/5 px-2 py-0.5 rounded border border-white/10 ${
                            item.paymentType === 'sip' ? 'text-teal-400 border-teal-500/10' : 'text-indigo-400 border-indigo-500/10'
                          }`}>
                            {item.paymentType === 'sip' ? `🔄 SIP / ${item.frequency}` : `🛡️ Premium / ${item.frequency}`}
                          </span>
                          <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded font-mono ${
                            item.daysLeft < 0 ? 'bg-red-500/20 border border-red-500/30 text-red-300 font-extrabold animate-pulse' :
                            item.daysLeft === 0 ? 'bg-red-500/10 border border-red-500/25 text-red-400 animate-pulse' :
                            item.daysLeft === 1 ? 'bg-amber-500/10 border border-amber-500/25 text-amber-400' :
                            'bg-teal-500/10 border border-teal-500/25 text-teal-400'
                          }`}>
                            {item.daysLeft < 0 ? `Overdue (${Math.abs(item.daysLeft)}d)` :
                             item.daysLeft === 0 ? 'Today' :
                             item.daysLeft === 1 ? 'Tomorrow' :
                             `In ${item.daysLeft} days`}
                          </span>
                        </div>

                        <div>
                          <h4 className="text-sm font-bold text-white truncate">{item.name}</h4>
                          <p className="text-xs text-secondary">{item.institution}</p>
                        </div>
                      </div>

                      <div className="flex items-end justify-between mt-4 pt-3 border-t border-white/5">
                        <div>
                          <span className="text-[9px] text-secondary uppercase font-bold block">
                            {item.paymentType === 'sip' ? 'Execute Date' : 'Premium Due Date'}
                          </span>
                          <span className="text-xs font-semibold text-white">{formattedDate}</span>
                        </div>
                        <div className="text-right">
                          <span className="text-sm font-extrabold text-teal-400 font-mono">
                            {formatCurrency(item.rawAmount, item.currency)}
                          </span>
                          {item.currency !== displayCurrency && (
                            <span className="text-[10px] text-secondary block font-mono">
                              ≈ {formatCurrency(item.amountInDisplayCurrency, displayCurrency)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Financial Safety Net Coverages Aggregates */}
          {insurancePolicies.length > 0 && (
            <div className="glass-panel p-6 border-l-4 border-l-emerald-400 space-y-4">
              <div className="space-y-1">
                <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest block">Financial Safety Net</span>
                <h3 className="text-xl font-bold text-white">Active Insurance Coverages</h3>
                <p className="text-xs text-secondary leading-relaxed">
                  Aggregated values of active policy shields securing your net worth, health, and family dependencies.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-2">
                {totalTermCover > 0 && (
                  <div className="bg-white/[0.01] p-4 rounded-xl border border-white/5 space-y-2">
                    <div className="flex justify-between items-center text-xs font-semibold text-secondary">
                      <span>TERM LIFE COVER</span>
                      <span className="text-emerald-400 font-bold">Active</span>
                    </div>
                    <div className="text-xl font-extrabold text-white font-mono">
                      {formatCurrency(totalTermCover, displayCurrency)}
                    </div>
                    <p className="text-[10px] text-secondary">Sum assured payout for family security</p>
                  </div>
                )}
                
                {totalHealthCover > 0 && (
                  <div className="bg-white/[0.01] p-4 rounded-xl border border-white/5 space-y-2">
                    <div className="flex justify-between items-center text-xs font-semibold text-secondary">
                      <span>HEALTH / MEDICAL</span>
                      <span className="text-emerald-400 font-bold">Active</span>
                    </div>
                    <div className="text-xl font-extrabold text-white font-mono">
                      {formatCurrency(totalHealthCover, displayCurrency)}
                    </div>
                    <p className="text-[10px] text-secondary">Medical hospitalization limits protection</p>
                  </div>
                )}

                {totalLifeCover > 0 && (
                  <div className="bg-white/[0.01] p-4 rounded-xl border border-white/5 space-y-2">
                    <div className="flex justify-between items-center text-xs font-semibold text-secondary">
                      <span>ENDOWMENT LIFE</span>
                      <span className="text-indigo-400 font-bold">Cash Value</span>
                    </div>
                    <div className="text-xl font-extrabold text-white font-mono">
                      {formatCurrency(totalLifeCover, displayCurrency)}
                    </div>
                    <p className="text-[10px] text-secondary">Surrender value counted in Net Worth</p>
                  </div>
                )}

                {totalOtherCover > 0 && (
                  <div className="bg-white/[0.01] p-4 rounded-xl border border-white/5 space-y-2">
                    <div className="flex justify-between items-center text-xs font-semibold text-secondary">
                      <span>MOTOR & OTHER COVERS</span>
                      <span className="text-secondary">Protected</span>
                    </div>
                    <div className="text-xl font-extrabold text-white font-mono">
                      {formatCurrency(totalOtherCover, displayCurrency)}
                    </div>
                    <p className="text-[10px] text-secondary">Vehicle and general asset coverages</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* FX Impact Analyser Panel */}
          {investments.some(inv => inv.currency !== displayCurrency) && (
            <div className="glass-panel p-6 border-l-4 border-l-teal-400">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="space-y-1">
                  <span className="text-[10px] font-bold text-teal-400 uppercase tracking-widest block">Multi-Currency FX Impact Analyser</span>
                  <h3 className="text-xl font-bold text-white">Currency Appreciation & Depreciation Effects</h3>
                  <p className="text-xs text-secondary leading-relaxed max-w-2xl">
                    Analyzing how exchange rate fluctuations from purchase dates to current live rates have affected your portfolio value.
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-xs text-secondary block font-semibold">Total FX Gain/Loss</span>
                  <div className={`text-2xl font-bold font-mono ${totalFxImpact >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {totalFxImpact >= 0 ? '+' : ''}{formatCurrency(totalFxImpact, displayCurrency)}
                  </div>
                  <span className="text-[10px] text-secondary">
                    ({(totalInvestedHistorical > 0 ? (totalFxImpact / totalInvestedHistorical) * 100 : 0).toFixed(2)}% FX Return)
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6 pt-6 border-t border-white/5">
                <div className="bg-white/[0.02] p-4 rounded-xl border border-white/5">
                  <span className="text-[10px] text-secondary uppercase font-bold block mb-1">True Invested Capital</span>
                  <span className="text-lg font-semibold font-mono text-white">
                    {formatCurrency(totalInvestedHistorical, displayCurrency)}
                  </span>
                  <span className="text-[10px] text-secondary block mt-0.5">Calculated at purchase-date exchange rates</span>
                </div>
                
                <div className="bg-white/[0.02] p-4 rounded-xl border border-white/5">
                  <span className="text-[10px] text-secondary uppercase font-bold block mb-1">Pure Asset Return</span>
                  <span className={`text-lg font-bold font-mono ${totalAssetGain >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {totalAssetGain >= 0 ? '+' : ''}{formatCurrency(totalAssetGain, displayCurrency)}
                  </span>
                  <span className="text-[10px] text-secondary block mt-0.5">Gain/loss excluding exchange rate shifts</span>
                </div>

                <div className="bg-white/[0.02] p-4 rounded-xl border border-white/5">
                  <span className="text-[10px] text-secondary uppercase font-bold block mb-1">FX Appreciation Impact</span>
                  <span className={`text-lg font-bold font-mono ${totalFxImpact >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {totalFxImpact >= 0 ? '+' : ''}{formatCurrency(totalFxImpact, displayCurrency)}
                  </span>
                  <span className="text-[10px] text-secondary block mt-0.5">Gain/loss strictly due to exchange rate shifts</span>
                </div>
              </div>
              
              {investments.some(inv => !inv.startDate && inv.currency !== displayCurrency) && (
                <div className="mt-4 p-2.5 bg-amber-500/5 border border-amber-500/10 rounded-xl text-[10px] text-amber-400/90 flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 animate-pulse text-amber-400" />
                  <span>Some foreign investments do not have a Purchase Date. Estimated historical rates are used as baseline fallbacks.</span>
                </div>
              )}
            </div>
          )}

          {/* Charts Row 1: Asset Type & Geographic Allocations */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            
            {/* Asset Type Chart */}
            <div className="glass-panel p-6 flex flex-col relative overflow-hidden group">
              <div className="flex items-center justify-between mb-4 z-10">
                <h3 className="text-lg font-bold flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-teal-400"></span>
                  {selectedType ? `${selectedType} Allocation (by Bank)` : 'Asset Allocation (by Type)'}
                </h3>
                {selectedType ? (
                  <button 
                    onClick={() => setSelectedType(null)}
                    className="btn btn-secondary py-1 px-2.5 text-[10px] flex items-center gap-1 border-white/10 hover:border-teal-400/40 hover:text-white"
                  >
                    <ArrowLeft className="w-3 h-3" />
                    Back
                  </button>
                ) : (
                  <span className="text-[10px] text-secondary font-semibold italic opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                    Click slice to drill down
                  </span>
                )}
              </div>
              
              <div className="h-[280px] w-full flex-grow relative">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={selectedType ? typeDrillDownData : typeData}
                      cx="50%"
                      cy="50%"
                      innerRadius={65}
                      outerRadius={90}
                      paddingAngle={4}
                      dataKey="value"
                      onClick={handleTypePieClick}
                      style={{ cursor: 'pointer' }}
                    >
                      {(selectedType ? typeDrillDownData : typeData).map((_, index) => (
                        <Cell 
                          key={`cell-${index}`} 
                          fill={TYPE_COLORS[index % TYPE_COLORS.length]} 
                          className="hover:opacity-90 transition-opacity duration-150"
                        />
                      ))}
                    </Pie>
                    <Tooltip content={<CustomTooltip />} />
                    <Legend 
                      verticalAlign="bottom" 
                      height={36} 
                      iconType="circle"
                      iconSize={10}
                      formatter={(value) => <span className="text-xs text-secondary font-medium">{value}</span>}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Geographic Distribution Chart */}
            <div className="glass-panel p-6 flex flex-col relative overflow-hidden group">
              <div className="flex items-center justify-between mb-4 z-10">
                <h3 className="text-lg font-bold flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-indigo-400"></span>
                  {selectedRegion ? `${selectedRegion} Assets (by Bank)` : 'Geographic Allocation (India vs. Europe)'}
                </h3>
                {selectedRegion ? (
                  <button 
                    onClick={() => setSelectedRegion(null)}
                    className="btn btn-secondary py-1 px-2.5 text-[10px] flex items-center gap-1 border-white/10 hover:border-indigo-400/40 hover:text-white"
                  >
                    <ArrowLeft className="w-3 h-3" />
                    Back
                  </button>
                ) : (
                  <span className="text-[10px] text-secondary font-semibold italic opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                    Click slice to drill down
                  </span>
                )}
              </div>

              <div className="h-[280px] w-full flex-grow relative">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={selectedRegion ? regionDrillDownData : regionData}
                      cx="50%"
                      cy="50%"
                      innerRadius={65}
                      outerRadius={90}
                      paddingAngle={4}
                      dataKey="value"
                      onClick={handleRegionPieClick}
                      style={{ cursor: 'pointer' }}
                    >
                      {(selectedRegion ? regionDrillDownData : regionData).map((entry, index) => {
                        const fill = selectedRegion
                          ? TYPE_COLORS[index % TYPE_COLORS.length]
                          : (REGION_COLORS[entry.name as keyof typeof REGION_COLORS] || '#10B981');
                        return (
                          <Cell 
                            key={`cell-${entry.name}`} 
                            fill={fill}
                            className="hover:opacity-90 transition-opacity duration-150"
                          />
                        );
                      })}
                    </Pie>
                    <Tooltip content={<CustomTooltip />} />
                    <Legend 
                      verticalAlign="bottom" 
                      height={36} 
                      iconType="circle"
                      iconSize={10}
                      formatter={(value) => <span className="text-xs text-secondary font-medium">{value}</span>}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Charts Row 2: Top Holdings Bar Chart */}
          <div className="glass-panel p-6 group relative">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400"></span>
                Top Holdings Breakdown
              </h3>
              <span className="text-[10px] text-secondary font-semibold italic opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                Click bar to spotlight asset details
              </span>
            </div>
            
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={topHoldingsData}
                  margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
                  onClick={handleBarClick}
                  style={{ cursor: 'pointer' }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#222" vertical={false} />
                  <XAxis 
                    dataKey="name" 
                    stroke="#555" 
                    tick={{ fill: '#888', fontSize: 11 }}
                    axisLine={{ stroke: '#222' }}
                  />
                  <YAxis 
                    stroke="#555" 
                    tickFormatter={(value) => formatCurrency(value, displayCurrency).replace(/\s+/g, '')}
                    tick={{ fill: '#888', fontSize: 11 }}
                    axisLine={{ stroke: '#222' }}
                  />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.02)' }} />
                  <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                    {topHoldingsData.map((entry, index) => {
                      const regionColor = REGION_COLORS[entry.region as keyof typeof REGION_COLORS] || '#10B981';
                      const isHighlighted = spotlightAssetId === entry.id;
                      return (
                        <Cell 
                          key={`cell-${index}`} 
                          fill={regionColor} 
                          opacity={spotlightAssetId ? (isHighlighted ? 1.0 : 0.35) : 0.85} 
                          className="transition-all duration-300"
                        />
                      );
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="flex items-center justify-center gap-6 mt-4 text-xs font-semibold text-secondary">
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-[#F97316]"></span>
                India Investments
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-[#3B82F6]"></span>
                Europe Investments
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-[#10B981]"></span>
                Other Investments
              </div>
            </div>
          </div>

          {/* Spotlight & Drill-Down Detail Cards */}
          {(selectedType || selectedRegion || spotlightAsset) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-fade-in pb-8">
              {/* Detailed Breakdown Card */}
              {(selectedType || selectedRegion) && (
                <div className="glass-panel p-6 border-teal-500/20 bg-teal-950/5 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <span className="text-[10px] font-bold text-teal-400 uppercase tracking-widest">Accrued Breakdown</span>
                      <button 
                        onClick={() => { setSelectedType(null); setSelectedRegion(null); }}
                        className="text-xs text-secondary hover:text-white transition-colors"
                      >
                        Clear Drill-down
                      </button>
                    </div>
                    
                    <h4 className="text-xl font-bold text-white mb-1">
                      {selectedType ? `${selectedType} Allocation` : `${selectedRegion} Allocation`}
                    </h4>
                    <p className="text-xs text-secondary mb-4">
                      Detailed share of assets grouped by provider institution:
                    </p>

                    <div className="space-y-3 max-h-[200px] overflow-y-auto pr-2">
                      {(selectedType ? typeDrillDownData : regionDrillDownData).map((item, idx) => {
                        const total = selectedType 
                          ? typeData.find(t => t.name === selectedType)?.value || 1 
                          : regionData.find(r => r.name === selectedRegion)?.value || 1;
                        const percentage = ((item.value / total) * 100).toFixed(1);
                        
                        return (
                          <div key={idx} className="space-y-1">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-semibold text-white">{item.name}</span>
                              <span className="font-mono text-secondary">
                                {formatCurrency(item.value, displayCurrency)} ({percentage}%)
                              </span>
                            </div>
                            <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                              <div 
                                className="h-full bg-teal-400 rounded-full" 
                                style={{ width: `${percentage}%` }}
                              ></div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  
                  <div className="pt-4 border-t border-white/5 mt-4 text-[10px] text-secondary flex items-center gap-1.5 font-semibold">
                    <BarChart3 className="w-3.5 h-3.5 text-teal-400" />
                    <span>Values shown in selected display currency ({displayCurrency}).</span>
                  </div>
                </div>
              )}

              {/* Spotlight Asset Info Card */}
              {spotlightAsset && (
                <div className="glass-panel p-6 border-indigo-500/20 bg-indigo-950/5 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest">Asset Spotlight</span>
                      <button 
                        onClick={() => setSpotlightAssetId(null)}
                        className="text-xs text-secondary hover:text-white transition-colors"
                      >
                        Clear Spotlight
                      </button>
                    </div>

                    <h4 className="text-xl font-bold text-white mb-1 truncate">{spotlightAsset.name}</h4>
                    <p className="text-xs text-secondary mb-4 capitalize">
                      {spotlightAsset.type === 'mutual_fund' ? 'Mutual Fund' : spotlightAsset.type} • {spotlightAsset.institution}
                    </p>

                    <div className="grid grid-cols-2 gap-4 mt-2">
                      <div className="bg-white/5 p-3 rounded-xl border border-white/5">
                        <span className="text-[9px] text-secondary uppercase font-bold block mb-0.5">Capital Invested</span>
                        <span className="text-sm font-semibold font-mono text-white">
                          {formatCurrency(spotlightAsset.amountInvested, spotlightAsset.currency)}
                        </span>
                      </div>
                      <div className="bg-white/5 p-3 rounded-xl border border-white/5">
                        <span className="text-sm font-semibold font-mono text-white">
                          {formatCurrency(spotlightAsset.currentValue, spotlightAsset.currency)}
                        </span>
                        <span className="text-[9px] text-secondary uppercase font-bold block mb-0.5">Current Value</span>
                      </div>
                      <div className="bg-white/5 p-3 rounded-xl border border-white/5">
                        <span className="text-[9px] text-secondary uppercase font-bold block mb-0.5">Gain / Loss</span>
                        <span className={`text-sm font-bold font-mono block ${spotlightAsset.currentValue >= spotlightAsset.amountInvested ? 'text-green-400' : 'text-red-400'}`}>
                          {spotlightAsset.currentValue >= spotlightAsset.amountInvested ? '+' : ''}
                          {formatCurrency(spotlightAsset.currentValue - spotlightAsset.amountInvested, spotlightAsset.currency)}
                        </span>
                      </div>
                      <div className="bg-white/5 p-3 rounded-xl border border-white/5">
                        <span className="text-[9px] text-secondary uppercase font-bold block mb-0.5">Rate of Return</span>
                        <span className={`text-sm font-bold font-mono block ${spotlightAsset.currentValue >= spotlightAsset.amountInvested ? 'text-green-400' : 'text-red-400'}`}>
                          {spotlightAsset.currentValue >= spotlightAsset.amountInvested ? '+' : ''}
                          {(((spotlightAsset.currentValue - spotlightAsset.amountInvested) / (spotlightAsset.amountInvested || 1)) * 100).toFixed(2)}%
                        </span>
                      </div>
                    </div>

                    {spotlightAsset.notes && (
                      <div className="mt-4 p-3 bg-white/[0.02] border border-white/5 rounded-xl text-xs text-secondary space-y-1">
                        <span className="font-semibold text-white block">Asset Info / Notes:</span>
                        <p className="font-mono text-[11px] leading-relaxed break-words">{spotlightAsset.notes}</p>
                      </div>
                    )}
                  </div>

                  {spotlightAsset.type === 'fd' && spotlightAsset.interestRate && (
                    <div className="pt-4 border-t border-white/5 mt-4 text-[10px] text-secondary flex items-center gap-1.5 font-semibold">
                      <Landmark className="w-3.5 h-3.5 text-indigo-400" />
                      <span>FD Interest: {spotlightAsset.interestRate}% ({spotlightAsset.interestType || 'compound'})</span>
                    </div>
                  )}
                  {spotlightAsset.ticker && (
                    <div className="pt-4 border-t border-white/5 mt-4 text-[10px] text-secondary flex items-center gap-1.5 font-semibold">
                      <Eye className="w-3.5 h-3.5 text-indigo-400" />
                      <span>Live ticker sync configured: {spotlightAsset.ticker}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};
