import React, { useState, useEffect } from 'react';
import type { Investment, ExchangeRates, InvestmentCurrency } from '../types';
import { convertCurrency, formatCurrency } from '../utils/exchangeRates';
import { 
  Scale, RefreshCw, AlertTriangle, TrendingUp, 
  ArrowRight, Sparkles, CheckCircle
} from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';

interface RebalancerSandboxProps {
  investments: Investment[];
  rates: ExchangeRates;
  displayCurrency: InvestmentCurrency;
}

export const RebalancerSandbox: React.FC<RebalancerSandboxProps> = ({
  investments,
  rates,
  displayCurrency
}) => {
  // 1. Group investments:
  // Equity: stock, mutual_fund
  // Debt: fd
  // Cash & Equivalents: savings, other
  const totalValue = investments.reduce((sum, inv) => {
    return sum + convertCurrency(inv.currentValue, inv.currency, displayCurrency, rates);
  }, 0);

  const currentAllocation = {
    equity: 0,
    debt: 0,
    cash: 0
  };

  investments.forEach((inv) => {
    const val = convertCurrency(inv.currentValue, inv.currency, displayCurrency, rates);
    if (inv.type === 'stock' || inv.type === 'mutual_fund') {
      currentAllocation.equity += val;
    } else if (inv.type === 'fd') {
      currentAllocation.debt += val;
    } else {
      currentAllocation.cash += val;
    }
  });

  const getPercentage = (val: number) => {
    if (totalValue === 0) return 0;
    return (val / totalValue) * 100;
  };

  const currentPct = {
    equity: getPercentage(currentAllocation.equity),
    debt: getPercentage(currentAllocation.debt),
    cash: getPercentage(currentAllocation.cash)
  };

  // 2. State for Target Allocation Sliders
  const [targetPct, setTargetPct] = useState({
    equity: Math.round(currentPct.equity),
    debt: Math.round(currentPct.debt),
    cash: Math.round(currentPct.cash)
  });

  // Keep target percentage synced on initial render / investments change
  useEffect(() => {
    setTargetPct({
      equity: Math.round(currentPct.equity),
      debt: Math.round(currentPct.debt),
      cash: Math.round(currentPct.cash)
    });
  }, [investments]);

  const targetTotal = targetPct.equity + targetPct.debt + targetPct.cash;
  const isBalanced = targetTotal === 100;

  // 3. Calculate Drift & Required Adjustments
  const drift = {
    equity: currentPct.equity - targetPct.equity,
    debt: currentPct.debt - targetPct.debt,
    cash: currentPct.cash - targetPct.cash
  };

  const adjustment = {
    equity: totalValue * (targetPct.equity - currentPct.equity) / 100,
    debt: totalValue * (targetPct.debt - currentPct.debt) / 100,
    cash: totalValue * (targetPct.cash - currentPct.cash) / 100
  };

  // 4. Generate Rebalancing Action Steps
  const generateTradeActions = () => {
    if (!isBalanced) return [];

    const actions: { type: 'buy' | 'sell'; assetClass: string; amount: number; notes: string }[] = [];
    const sellActions: { assetClass: string; amount: number }[] = [];
    const buyActions: { assetClass: string; amount: number }[] = [];

    // Separate surplus and deficit
    if (adjustment.equity < 0) sellActions.push({ assetClass: 'Equity', amount: Math.abs(adjustment.equity) });
    else if (adjustment.equity > 0) buyActions.push({ assetClass: 'Equity', amount: adjustment.equity });

    if (adjustment.debt < 0) sellActions.push({ assetClass: 'Debt', amount: Math.abs(adjustment.debt) });
    else if (adjustment.debt > 0) buyActions.push({ assetClass: 'Debt', amount: adjustment.debt });

    if (adjustment.cash < 0) sellActions.push({ assetClass: 'Cash & Equivalents', amount: Math.abs(adjustment.cash) });
    else if (adjustment.cash > 0) buyActions.push({ assetClass: 'Cash & Equivalents', amount: adjustment.cash });

    // Match sells to buys
    let sellIdx = 0;
    let buyIdx = 0;

    // Clone arrays to mutate
    const sells = sellActions.map(s => ({ ...s }));
    const buys = buyActions.map(b => ({ ...b }));

    while (sellIdx < sells.length && buyIdx < buys.length) {
      const sell = sells[sellIdx];
      const buy = buys[buyIdx];
      const tradeAmount = Math.min(sell.amount, buy.amount);

      actions.push({
        type: 'sell',
        assetClass: sell.assetClass,
        amount: tradeAmount,
        notes: `Redeem ${formatCurrency(tradeAmount, displayCurrency)} from ${sell.assetClass} holdings ➔ Allocate to ${buy.assetClass}`
      });

      sell.amount -= tradeAmount;
      buy.amount -= tradeAmount;

      if (sell.amount <= 1) sellIdx++;
      if (buy.amount <= 1) buyIdx++;
    }

    return actions;
  };

  const tradeActions = generateTradeActions();

  // Rebalance sliders handler
  const handleSliderChange = (assetClass: 'equity' | 'debt' | 'cash', val: number) => {
    setTargetPct(prev => ({
      ...prev,
      [assetClass]: val
    }));
  };

  const autoBalance = () => {
    // Reset target to current distribution
    setTargetPct({
      equity: Math.round(currentPct.equity),
      debt: Math.round(currentPct.debt),
      cash: Math.round(currentPct.cash)
    });
  };

  const pieData = [
    { name: 'Equity', value: currentAllocation.equity },
    { name: 'Debt (FDs)', value: currentAllocation.debt },
    { name: 'Cash', value: currentAllocation.cash }
  ].filter(d => d.value > 0);

  return (
    <div className="space-y-6">
      {/* Header Panel */}
      <div className="glass-panel p-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Scale className="text-teal-400 w-6 h-6" />
            Interactive Allocation Sandbox & Rebalancer
          </h2>
          <p className="text-xs text-secondary mt-1">
            Simulate portfolio changes, calculate drifts from asset targets, and get transaction lists.
          </p>
        </div>

        <button
          onClick={autoBalance}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-white/5 border border-white/10 hover:border-teal-500/30 text-teal-400 hover:text-white transition-all"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Sync with Current
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Sliders Sandbox */}
        <div className="glass-panel p-6 space-y-6 lg:col-span-2">
          <div>
            <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-teal-400" />
              Adjust Target Allocation Mix
            </h3>
            <p className="text-xs text-secondary mb-6">
              Drag sliders to set your ideal target portfolio split. Total must sum to exactly **100%**.
            </p>
          </div>

          <div className="space-y-6">
            {/* Equity Slider */}
            <div className="space-y-2">
              <div className="flex justify-between items-center text-xs">
                <span className="font-semibold text-white">Equity (Stocks & Mutual Funds)</span>
                <span className="font-mono text-teal-400 font-bold">{targetPct.equity}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={targetPct.equity}
                onChange={(e) => handleSliderChange('equity', parseInt(e.target.value))}
                className="w-full h-1.5 bg-white/5 rounded-lg appearance-none cursor-pointer accent-teal-400"
              />
              <div className="flex justify-between text-[10px] text-secondary">
                <span>Current: {currentPct.equity.toFixed(1)}%</span>
                <span>Target: {targetPct.equity}%</span>
              </div>
            </div>

            {/* Debt Slider */}
            <div className="space-y-2">
              <div className="flex justify-between items-center text-xs">
                <span className="font-semibold text-white">Debt (Fixed Deposits / Bonds)</span>
                <span className="font-mono text-indigo-400 font-bold">{targetPct.debt}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={targetPct.debt}
                onChange={(e) => handleSliderChange('debt', parseInt(e.target.value))}
                className="w-full h-1.5 bg-white/5 rounded-lg appearance-none cursor-pointer accent-indigo-500"
              />
              <div className="flex justify-between text-[10px] text-secondary">
                <span>Current: {currentPct.debt.toFixed(1)}%</span>
                <span>Target: {targetPct.debt}%</span>
              </div>
            </div>

            {/* Cash Slider */}
            <div className="space-y-2">
              <div className="flex justify-between items-center text-xs">
                <span className="font-semibold text-white">Cash & Cash Equivalents</span>
                <span className="font-mono text-green-400 font-bold">{targetPct.cash}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={targetPct.cash}
                onChange={(e) => handleSliderChange('cash', parseInt(e.target.value))}
                className="w-full h-1.5 bg-white/5 rounded-lg appearance-none cursor-pointer accent-green-400"
              />
              <div className="flex justify-between text-[10px] text-secondary">
                <span>Current: {currentPct.cash.toFixed(1)}%</span>
                <span>Target: {targetPct.cash}%</span>
              </div>
            </div>
          </div>

          {/* Allocation Checker Status */}
          <div className={`p-4 rounded-xl border flex items-center justify-between transition-all ${
            isBalanced 
              ? 'bg-green-500/5 border-green-500/20 text-green-400' 
              : 'bg-rose-500/5 border-rose-500/20 text-rose-400'
          }`}>
            <div className="flex items-center gap-2">
              {isBalanced ? (
                <CheckCircle className="w-5 h-5" />
              ) : (
                <AlertTriangle className="w-5 h-5 animate-bounce" />
              )}
              <span className="text-xs font-semibold">
                {isBalanced 
                  ? 'Sandbox is balanced! Ready to inspect drift and generated transaction paths.'
                  : `Adjustment required: Sliders sum to ${targetTotal}% (must equal 100%).`
                }
              </span>
            </div>
            <span className="text-sm font-bold font-mono">{targetTotal}% / 100%</span>
          </div>
        </div>

        {/* Right Column: Allocation Pie & Drift */}
        <div className="glass-panel p-6 flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-4">
              Current Asset Allocation
            </h3>
          </div>

          <div style={{ height: '160px', width: '100%', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={65}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {pieData.map((entry, index) => {
                    const colorMap: Record<string, string> = {
                      'Equity': '#00F2FE',
                      'Debt (FDs)': '#8A57FE',
                      'Cash': '#10B981'
                    };
                    return <Cell key={`cell-${index}`} fill={colorMap[entry.name] || '#10B981'} />;
                  })}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: 'rgba(20, 20, 25, 0.95)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: '12px',
                    fontSize: '11px',
                    color: '#fff'
                  }}
                  formatter={(value: any) => [formatCurrency(value, displayCurrency), '']}
                />
              </PieChart>
            </ResponsiveContainer>
            <div style={{ position: 'absolute', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <span style={{ fontSize: '18px', fontWeight: 'bold', color: '#fff', fontFamily: 'monospace' }}>
                {formatCurrency(totalValue, displayCurrency).replace(/\s+/g, '')}
              </span>
              <span style={{ fontSize: '9px', color: '#94a3b8', fontWeight: '600', textTransform: 'uppercase' }}>Net Worth</span>
            </div>
          </div>

          {/* Drift Stats */}
          <div className="space-y-2.5 mt-4">
            <div className="flex justify-between items-center text-xs">
              <span className="text-secondary font-semibold">Equity Drift</span>
              <span className={`font-mono font-bold ${drift.equity > 0 ? 'text-teal-400' : drift.equity < 0 ? 'text-rose-400' : 'text-secondary'}`}>
                {drift.equity > 0 ? '+' : ''}{drift.equity.toFixed(1)}%
              </span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="text-secondary font-semibold">Debt Drift</span>
              <span className={`font-mono font-bold ${drift.debt > 0 ? 'text-indigo-400' : drift.debt < 0 ? 'text-rose-400' : 'text-secondary'}`}>
                {drift.debt > 0 ? '+' : ''}{drift.debt.toFixed(1)}%
              </span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="text-secondary font-semibold">Cash Drift</span>
              <span className={`font-mono font-bold ${drift.cash > 0 ? 'text-green-400' : drift.cash < 0 ? 'text-rose-400' : 'text-secondary'}`}>
                {drift.cash > 0 ? '+' : ''}{drift.cash.toFixed(1)}%
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Trade Actions & Rebalancing Execution Steps */}
      {isBalanced && (
        <div className="glass-panel p-6 space-y-4">
          <div>
            <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
              <TrendingUp className="w-4 h-4 text-teal-400" />
              Generated Rebalancing Action Plans
            </h3>
            <p className="text-xs text-secondary mt-1">
              Follow these transaction recommendations to rebalance your portfolio from its current state to your targets.
            </p>
          </div>

          {tradeActions.length === 0 ? (
            <div className="p-8 text-center bg-white/[0.01] border border-dashed border-white/10 rounded-xl">
              <CheckCircle className="w-10 h-10 text-green-400 mx-auto mb-2" />
              <span className="text-xs text-secondary font-semibold">Portfolio is perfectly aligned. No rebalancing actions needed!</span>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="divide-y divide-light">
                {tradeActions.map((act, idx) => (
                  <div key={idx} className="py-3 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 text-xs">
                    <div className="flex items-center gap-3">
                      <span className="w-5 h-5 rounded-full bg-white/5 border border-white/10 flex items-center justify-center font-mono font-bold text-teal-400">
                        {idx + 1}
                      </span>
                      <span className="text-white font-semibold leading-relaxed">{act.notes}</span>
                    </div>
                    <div className="flex items-center gap-1.5 font-mono font-bold text-teal-400 shrink-0">
                      <span>{formatCurrency(act.amount, displayCurrency)}</span>
                      <ArrowRight className="w-3.5 h-3.5 text-secondary" />
                    </div>
                  </div>
                ))}
              </div>

              {/* Warnings & Tax Advice */}
              <div className="p-4 bg-amber-500/5 border border-amber-500/10 rounded-xl space-y-2 mt-4">
                <h4 className="text-xs font-bold text-amber-500 flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4" />
                  Tax & Transaction Cost Alerts
                </h4>
                <ul className="text-[11px] text-secondary space-y-1.5 list-disc pl-4">
                  <li>
                    <strong>Indian Capital Gains Tax:</strong> Redeeming Indian mutual funds or stocks to rebalance could trigger **STCG (20%)** or **LTCG (12.5% above ₹1.25 Lakhs)**. Ensure you leverage the tax-harvesting optimizer before selling.
                  </li>
                  <li>
                    <strong>Exit Loads:</strong> Mutual funds often charge a **1% exit load** if redeemed within 365 days of purchase. Verify buy dates in your investments tab.
                  </li>
                  <li>
                    <strong>Fixed Deposit Premature Penalty:</strong> Breaking FDs prematurely to rebalance cash into equities can result in a **0.5% - 1% interest rate penalty**.
                  </li>
                </ul>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
