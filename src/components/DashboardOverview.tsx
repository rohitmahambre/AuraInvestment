import React, { useState, useEffect } from 'react';
import type { Investment, ExchangeRates, InvestmentCurrency } from '../types';
import { convertCurrency, formatCurrency } from '../utils/exchangeRates';
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
  ArrowLeft, Landmark, Eye, BarChart3
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

  const absoluteGainLoss = totalCurrentValue - totalInvested;
  const gainLossPercentage = totalInvested > 0 ? (absoluteGainLoss / totalInvested) * 100 : 0;
  const isProfit = absoluteGainLoss >= 0;

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
        
        {/* Currency Switcher */}
        <div className="flex items-center gap-2 bg-surface-dark p-1 rounded-xl border border-white/5 self-start md:self-auto">
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
