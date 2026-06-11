import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../firebase';
import { convertCurrency, formatCurrency } from '../utils/exchangeRates';
import {
  collection,
  query,
  onSnapshot,
  doc,
  setDoc,
  deleteDoc,
  orderBy
} from 'firebase/firestore';
import {
  TrendingUp, Plus, Trash2, Edit3, X,
  Calendar, RefreshCw, BarChart2, AlertCircle
} from 'lucide-react';
import {
  BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, LabelList
} from 'recharts';
import type { Investment, ExchangeRates } from '../types';

interface MonthlySnapshot {
  id: string;
  portfolioId: string;
  month: string; // YYYY-MM
  value: number;
  currency: 'INR' | 'EUR' | 'USD';
  createdAt: any;
  updatedAt: any;
}

interface MonthlyTrackerProps {
  portfolioId: string;
  investments: Investment[];
  rates: ExchangeRates | null;
  displayCurrency: 'INR' | 'EUR' | 'USD';
  canWrite: boolean;
}

// Convert YYYY-MM to Month Name (e.g. 2025-05 -> MAY 2025)
const formatMonthLabel = (monthStr: string) => {
  if (!monthStr) return '';
  const [year, month] = monthStr.split('-');
  const monthNames = [
    'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
    'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'
  ];
  const monthIndex = parseInt(month, 10) - 1;
  return `${monthNames[monthIndex]} ${year}`;
};

export const MonthlyTracker: React.FC<MonthlyTrackerProps> = ({
  portfolioId,
  investments,
  rates,
  displayCurrency,
  canWrite
}) => {
  const [snapshots, setSnapshots] = useState<MonthlySnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSnapshot, setEditingSnapshot] = useState<MonthlySnapshot | null>(null);

  // Form State
  const [formData, setFormData] = useState({
    month: '',
    value: '',
    currency: displayCurrency
  });

  // Sync snapshots from Firestore
  useEffect(() => {
    setLoading(true);
    const colRef = collection(db, `portfolios/${portfolioId}/snapshots`);
    const q = query(colRef, orderBy('month', 'asc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data: MonthlySnapshot[] = [];
      snapshot.forEach((doc) => {
        data.push({ id: doc.id, ...doc.data() } as MonthlySnapshot);
      });
      setSnapshots(data);
      setLoading(false);
    }, (err) => {
      console.error("Failed to load monthly snapshots:", err);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [portfolioId]);

  // Compute total current net worth of investments
  const computedCurrentNetWorth = useMemo(() => {
    return investments.reduce((sum, inv) => {
      // Exclude term/health/motor policies from net worth
      const val = inv.type === 'insurance' && inv.policyType !== 'life' ? 0 : inv.currentValue;
      return sum + convertCurrency(val, inv.currency, displayCurrency, rates || {} as any);
    }, 0);
  }, [investments, displayCurrency, rates]);

  // Process and compute MoM performance changes
  const processedData = useMemo(() => {
    if (!rates) return [];

    return snapshots.map((snap, index) => {
      // Convert snapshot value to active display currency
      const convertedValue = convertCurrency(snap.value, snap.currency, displayCurrency, rates);
      
      let changeVal = 0;
      let percentageChange = 0;

      if (index > 0) {
        const prevSnap = snapshots[index - 1];
        const prevConvertedValue = convertCurrency(prevSnap.value, prevSnap.currency, displayCurrency, rates);
        
        changeVal = convertedValue - prevConvertedValue;
        if (prevConvertedValue > 0) {
          percentageChange = (changeVal / prevConvertedValue) * 100;
        }
      }

      const formattedMonthName = formatMonthLabel(snap.month);
      
      // Label display for the chart bar top
      let momPercentageFormatted = '';
      if (index > 0) {
        momPercentageFormatted = percentageChange >= 0
          ? `${percentageChange.toFixed(2)}%`
          : `${percentageChange.toFixed(2)}%`;
      }

      return {
        ...snap,
        convertedValue,
        changeVal,
        percentageChange,
        formattedMonthName,
        momPercentageFormatted
      };
    });
  }, [snapshots, displayCurrency, rates]);

  // Open modal for add
  const openAddModal = () => {
    const today = new Date();
    const currentMonthStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    setEditingSnapshot(null);
    setFormData({
      month: currentMonthStr,
      value: '',
      currency: displayCurrency
    });
    setIsModalOpen(true);
  };

  // Open modal for edit
  const openEditModal = (snap: MonthlySnapshot) => {
    setEditingSnapshot(snap);
    setFormData({
      month: snap.month,
      value: snap.value.toString(),
      currency: snap.currency
    });
    setIsModalOpen(true);
  };

  // Pre-fill active computed net worth
  const handleCaptureCurrent = () => {
    const today = new Date();
    const currentMonthStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    setEditingSnapshot(null);
    setFormData({
      month: currentMonthStr,
      value: Math.round(computedCurrentNetWorth).toString(),
      currency: displayCurrency
    });
    setIsModalOpen(true);
  };

  // Form Submit (Add/Edit)
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canWrite || !formData.month || !formData.value) return;

    const valueNum = parseFloat(formData.value);
    if (isNaN(valueNum) || valueNum < 0) return;

    try {
      // Find if snapshot for this month already exists to overwrite/update it
      const existing = snapshots.find(s => s.month === formData.month && (!editingSnapshot || s.id !== editingSnapshot.id));
      
      const docId = editingSnapshot ? editingSnapshot.id : (existing ? existing.id : doc(collection(db, `portfolios/${portfolioId}/snapshots`)).id);
      const docRef = doc(db, `portfolios/${portfolioId}/snapshots`, docId);

      const snapshotPayload = {
        id: docId,
        portfolioId: portfolioId,
        month: formData.month,
        value: valueNum,
        currency: formData.currency,
        createdAt: editingSnapshot ? editingSnapshot.createdAt : new Date(),
        updatedAt: new Date()
      };

      await setDoc(docRef, snapshotPayload);
      setIsModalOpen(false);
    } catch (err) {
      console.error("Failed to save snapshot:", err);
    }
  };

  // Delete Snapshot
  const handleDelete = async (id: string) => {
    if (!canWrite) return;
    if (confirm("Are you sure you want to delete this monthly snapshot?")) {
      try {
        const docRef = doc(db, `portfolios/${portfolioId}/snapshots`, id);
        await deleteDoc(docRef);
      } catch (err) {
        console.error("Failed to delete snapshot:", err);
      }
    }
  };

  return (
    <div className="space-y-6">
      
      {/* Header Panel */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-surface-solid/10 p-6 rounded-2xl border border-white/5 backdrop-blur-md">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <BarChart2 className="w-5 h-5 text-teal-400" />
            Monthly Net Worth Tracker
          </h2>
          <p className="text-xs text-secondary mt-1">
            Log and visualize the month-on-month trend of your consolidated portfolio valuation.
          </p>
        </div>

        {canWrite && (
          <div className="flex gap-2 w-full sm:w-auto">
            <button
              onClick={handleCaptureCurrent}
              className="flex-1 sm:flex-initial btn btn-secondary text-xs py-2 px-3 flex items-center justify-center gap-1.5 border-white/10 hover:border-teal-400/35 hover:text-white"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Capture Current Net Worth
            </button>
            <button
              onClick={openAddModal}
              className="flex-1 sm:flex-initial btn btn-primary text-xs py-2 px-3 flex items-center justify-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              Log Monthly Value
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="glass-panel p-16 flex flex-col items-center justify-center gap-3">
          <RefreshCw className="w-8 h-8 text-teal-400 animate-spin" />
          <span className="text-xs text-secondary font-mono">Syncing net worth historical logs...</span>
        </div>
      ) : processedData.length === 0 ? (
        <div className="glass-panel p-16 flex flex-col items-center justify-center text-center">
          <TrendingUp className="w-16 h-16 text-secondary/35 mb-4" />
          <h3 className="text-sm font-bold text-white">No historical snapshots found</h3>
          <p className="text-xs text-secondary max-w-sm mt-1 mb-6">
            Log your portfolio value at the end of each month to visualize growth, calculate compound change rates, and track progress.
          </p>
          {canWrite && (
            <button onClick={openAddModal} className="btn btn-primary text-xs py-2 px-4">
              Add First Monthly Record
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Main Visual: Performance Bar Chart */}
          <div className="glass-panel p-6 space-y-4">
            <div className="flex justify-between items-center">
              <div>
                <span className="text-[10px] font-bold text-teal-400 uppercase tracking-widest block">Valuation Trend Chart</span>
                <h3 className="text-base font-bold text-white">Consolidated Portfolio Net Worth Progress</h3>
              </div>
              <div className="text-right">
                <span className="text-[10px] text-secondary font-semibold uppercase block">Latest Logged Net Worth</span>
                <span className="text-base font-extrabold text-white font-mono">
                  {formatCurrency(processedData[processedData.length - 1].convertedValue, displayCurrency)}
                </span>
              </div>
            </div>

            {/* Recharts BarChart container */}
            <div style={{ height: '320px', width: '100%', paddingTop: '1.5rem' }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={processedData} margin={{ top: 20, right: 10, left: 15, bottom: 5 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.03)" strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="formattedMonthName" 
                    stroke="hsl(240, 6%, 70%)" 
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis 
                    stroke="hsl(240, 6%, 70%)" 
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(val) => {
                      if (val >= 10000000) return `${(val / 10000000).toFixed(1)}Cr`;
                      if (val >= 100000) return `${(val / 100000).toFixed(1)}L`;
                      if (val >= 1000) return `${(val / 1000).toFixed(0)}k`;
                      return val.toString();
                    }}
                  />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: '#0b0c10', 
                      borderColor: 'rgba(255,255,255,0.1)', 
                      borderRadius: '12px',
                      boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
                      fontSize: '11px',
                      fontFamily: 'JetBrains Mono'
                    }}
                    labelStyle={{ color: 'hsl(240, 6%, 70%)', fontWeight: 'bold' }}
                    formatter={(value: any) => [formatCurrency(value, displayCurrency), 'Consolidated Value']}
                  />
                  <Bar dataKey="convertedValue" fill="url(#barGradient)" radius={[6, 6, 0, 0]}>
                    {processedData.map((_, index) => (
                      <Cell key={`cell-${index}`} className="hover:opacity-90 transition-opacity duration-150" />
                    ))}
                    <LabelList
                      dataKey="momPercentageFormatted"
                      position="top"
                      fill="#94a3b8"
                      fontSize={9}
                      fontWeight="bold"
                      formatter={(val: any) => {
                        if (!val) return '';
                        const valNum = parseFloat(val);
                        if (isNaN(valNum)) return val;
                        return valNum >= 0 ? `+${val}` : val;
                      }}
                    />
                  </Bar>
                  {/* Define visual gradients */}
                  <defs>
                    <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#06b6d4" stopOpacity={0.85} />
                      <stop offset="100%" stopColor="#4f46e5" stopOpacity={0.15} />
                    </linearGradient>
                  </defs>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Performance Table */}
          <div className="glass-panel p-6 space-y-4">
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Calendar className="w-4 h-4 text-teal-400" />
                Historical Performance Log
              </h3>
              <p className="text-xs text-secondary mt-1">
                Month-on-Month (MoM) calculations for absolute growth and relative yield percentages.
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-light text-[10px] text-secondary font-bold uppercase tracking-wider">
                    <th className="py-3 px-3">Month</th>
                    <th className="py-3 px-3 text-right">Consolidated Portfolio Value</th>
                    <th className="py-3 px-3 text-right">Change ({displayCurrency})</th>
                    <th className="py-3 px-3 text-right">Change (%)</th>
                    {canWrite && <th className="py-3 px-3 text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-light text-xs font-mono">
                  {processedData.map((row, index) => {
                    const isPositive = row.changeVal >= 0;
                    const changeSymbol = isPositive ? '+' : '';
                    
                    return (
                      <tr key={row.id} className="hover:bg-white/[0.01] transition-colors">
                        <td className="py-3 px-3 font-semibold text-white">
                          {row.formattedMonthName}
                        </td>
                        <td className="py-3 px-3 text-right text-white">
                          {formatCurrency(row.convertedValue, displayCurrency)}
                        </td>
                        <td className={`py-3 px-3 text-right font-bold ${index === 0 ? 'text-secondary' : (isPositive ? 'text-emerald-400' : 'text-red-400')}`}>
                          {index === 0 ? 'NA' : `${changeSymbol}${formatCurrency(row.changeVal, displayCurrency)}`}
                        </td>
                        <td className={`py-3 px-3 text-right font-bold ${index === 0 ? 'text-secondary' : (isPositive ? 'text-emerald-400' : 'text-red-400')}`}>
                          {index === 0 ? 'NA' : `${changeSymbol}${row.percentageChange.toFixed(2)}%`}
                        </td>
                        {canWrite && (
                          <td className="py-3 px-3 text-right">
                            <div className="flex justify-end gap-2">
                              <button
                                onClick={() => openEditModal(row)}
                                className="p-1 rounded bg-surface border border-light text-secondary hover:text-white transition-colors"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleDelete(row.id)}
                                className="p-1 rounded bg-surface border border-light text-secondary hover:text-red-400 transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Add / Edit Snapshot Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm z-50 p-4">
          <div className="glass-panel w-full max-w-md p-6 relative animate-scale-in">
            <button
              onClick={() => setIsModalOpen(false)}
              className="absolute top-4 right-4 p-1 rounded-full text-secondary hover:text-white hover:bg-white/5 transition-all"
            >
              <X className="w-4 h-4" />
            </button>

            <h3 className="text-base font-bold text-white mb-4">
              {editingSnapshot ? 'Edit Net Worth Snapshot' : 'Log Net Worth Snapshot'}
            </h3>

            <form onSubmit={handleSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block text-secondary font-semibold mb-1">Select Month *</label>
                <input
                  type="month"
                  required
                  value={formData.month}
                  disabled={editingSnapshot !== null}
                  onChange={(e) => setFormData({ ...formData, month: e.target.value })}
                  className="w-full bg-surface border border-light rounded-lg px-3 py-2 text-white focus:outline-none focus:border-teal-500 font-mono disabled:opacity-50"
                />
              </div>

              <div>
                <label className="block text-secondary font-semibold mb-1">
                  Consolidated Portfolio Value ({formData.currency}) *
                </label>
                <input
                  type="number"
                  step="any"
                  required
                  min="0"
                  placeholder="0.00"
                  value={formData.value}
                  onChange={(e) => setFormData({ ...formData, value: e.target.value })}
                  className="w-full bg-surface border border-light rounded-lg px-3 py-2 text-white focus:outline-none focus:border-teal-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-secondary font-semibold mb-1">Currency *</label>
                <select
                  value={formData.currency}
                  onChange={(e) => setFormData({ ...formData, currency: e.target.value as any })}
                  className="w-full bg-surface border border-light rounded-lg px-3 py-2 text-white focus:outline-none focus:border-teal-500"
                >
                  <option value="INR">INR (₹)</option>
                  <option value="EUR">EUR (€)</option>
                  <option value="USD">USD ($)</option>
                </select>
              </div>

              {snapshots.some(s => s.month === formData.month && (!editingSnapshot || s.id !== editingSnapshot.id)) && (
                <div className="p-2.5 bg-amber-500/5 border border-amber-500/10 rounded-xl text-[10px] text-amber-400 flex items-start gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>
                    A snapshot already exists for this month. Saving will **overwrite** the existing record value.
                  </span>
                </div>
              )}

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-surface border border-light text-secondary hover:text-white transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-teal-500 text-black font-bold hover:bg-teal-400 transition-all"
                >
                  Save Snapshot
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
