import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { db } from '../firebase';
import { convertCurrency, formatCurrency } from '../utils/exchangeRates';
import {
  collection,
  query,
  onSnapshot,
  doc,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  orderBy
} from 'firebase/firestore';
import {
  Calendar, Plus, Trash2, Edit3, AlertTriangle,
  CheckCircle, Info, Sparkles, UserCheck, Plane,
  Clock, Landmark, HelpCircle, X, RefreshCw, ShieldCheck
} from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import type { Trip, TaxConfig, Investment, ExchangeRates } from '../types';

// Format YYYY-MM-DD to DD/MM/YYYY
const formatDateDMY = (dateStr: string) => {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
};

// Calculate inclusive duration of trip in days
const getTripDuration = (startStr: string, endStr: string) => {
  if (!startStr || !endStr) return 0;
  const start = new Date(`${startStr}T00:00:00`);
  const end = new Date(`${endStr}T23:59:59`);
  const diffTime = Math.abs(end.getTime() - start.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};


interface TaxResidencyProps {
  portfolioId: string;
  investments: Investment[];
  rates: ExchangeRates | null;
  displayCurrency: 'INR' | 'EUR' | 'USD';
  canWrite: boolean;
}

// Helper to check if a year is a leap year
const isLeapYear = (year: number) => {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
};

// Calculate total days in an Indian Financial Year (April 1 to March 31 of next year)
const getDaysInFY = (startYear: number) => {
  return isLeapYear(startYear + 1) || (startYear === 2023 && isLeapYear(2024)) ? 366 : 365;
};

export const TaxResidency: React.FC<TaxResidencyProps> = ({
  portfolioId,
  investments,
  rates,
  displayCurrency,
  canWrite
}) => {
  const { user } = useAuth();

  // Tax Years (Indian FYs)
  const taxYears = [
    '2021-22', '2022-23', '2023-24', '2024-25',
    '2025-26', '2026-27', '2027-28', '2028-29', '2029-30'
  ];
  const [selectedFY, setSelectedFY] = useState('2025-26');

  // States
  const [trips, setTrips] = useState<Trip[]>([]);
  const [config, setConfig] = useState<TaxConfig>({
    isIndianCitizen: true,
    hasIndianIncomeOver15L: false,
    preceding4YearsDays: 365
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Modal states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTrip, setEditingTrip] = useState<Trip | null>(null);
  const [formData, setFormData] = useState({
    startDate: '',
    endDate: '',
    purpose: 'Vacation',
    notes: ''
  });

  // AI Advisor states
  const [aiLoading, setAiLoading] = useState(false);
  const [aiReport, setAiReport] = useState<string | null>(null);
  const [showAiModal, setShowAiModal] = useState(false);

  // Parse FY bounds
  const getFYRange = (fy: string) => {
    const startYear = parseInt(fy.split('-')[0]);
    const endYear = startYear + 1;
    // Indian FY runs April 1 to March 31
    const yearStart = new Date(`${startYear}-04-01T00:00:00`);
    const yearEnd = new Date(`${endYear}-03-31T23:59:59`);
    return { yearStart, yearEnd, startYear };
  };

  // Sync Trips & Config
  useEffect(() => {
    if (!portfolioId) return;

    setLoading(true);
    const tripsRef = collection(db, `portfolios/${portfolioId}/trips`);
    const qTrips = query(tripsRef, orderBy('startDate', 'asc'));

    const unsubscribeTrips = onSnapshot(qTrips, (snapshot) => {
      const list: Trip[] = [];
      snapshot.forEach((d) => {
        list.push({ id: d.id, ...d.data() } as Trip);
      });
      setTrips(list);
      setLoading(false);
    }, (error) => {
      console.error("Error loading trips:", error);
      setLoading(false);
    });

    // Sync Config settings document (using doc ID 'settings' in subcollection 'taxConfig')
    const configDocRef = doc(db, `portfolios/${portfolioId}/taxConfig`, 'settings');
    const unsubscribeConfig = onSnapshot(configDocRef, (docSnap) => {
      if (docSnap.exists()) {
        setConfig(docSnap.data() as TaxConfig);
      } else {
        // Create default settings document if it doesn't exist
        setDoc(configDocRef, {
          isIndianCitizen: true,
          hasIndianIncomeOver15L: false,
          preceding4YearsDays: 365
        }).catch(err => console.error("Error creating default config:", err));
      }
    });

    return () => {
      unsubscribeTrips();
      unsubscribeConfig();
    };
  }, [portfolioId]);

  // Handle Config Toggles
  const handleConfigChange = async (key: keyof TaxConfig, value: any) => {
    if (!canWrite) return;
    const newConfig = { ...config, [key]: value };
    setConfig(newConfig);

    try {
      const configDocRef = doc(db, `portfolios/${portfolioId}/taxConfig`, 'settings');
      await setDoc(configDocRef, newConfig);
    } catch (err) {
      console.error("Failed to save tax configuration:", err);
    }
  };

  // Trip Date Slicing Calculator
  const { yearStart, yearEnd, startYear } = getFYRange(selectedFY);
  const totalDaysInFY = getDaysInFY(startYear);

  // Compute days spent in India during the active financial year
  let daysInIndia = 0;

  trips.forEach((trip) => {
    if (trip.destinationRegion !== 'India') return;

    const tripStart = new Date(`${trip.startDate}T00:00:00`);
    const tripEnd = new Date(`${trip.endDate}T23:59:59`);

    // Check if trip overlaps with the active financial year
    if (tripEnd < yearStart || tripStart > yearEnd) return;

    // Clamp to year boundaries
    const overlapStart = tripStart < yearStart ? yearStart : tripStart;
    const overlapEnd = tripEnd > yearEnd ? yearEnd : tripEnd;

    // Inclusive days count
    const diffTime = Math.abs(overlapEnd.getTime() - overlapStart.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    daysInIndia += diffDays;
  });

  const daysOutsideIndia = totalDaysInFY - daysInIndia;

  // Determine Indian Tax Residency Status
  let residencyStatus: 'ROR' | 'RNOR' | 'NRI' = 'NRI';
  let residencyReason = '';

  if (daysInIndia >= 182) {
    residencyStatus = 'ROR';
    residencyReason = `Spent ${daysInIndia} days in India (meets the basic 182-day physical presence rule).`;
  } else {
    const meets365Preceding = config.preceding4YearsDays >= 365;
    if (meets365Preceding) {
      if (config.isIndianCitizen) {
        if (config.hasIndianIncomeOver15L) {
          if (daysInIndia >= 120) {
            // Citizen with > 15L visiting India under 120-day rule is automatically RNOR
            residencyStatus = 'RNOR';
            residencyReason = `Spent ${daysInIndia} days in India (between 120 and 181 days) with Indian income > ₹15L and prior 4 years stay >= 365 days.`;
          } else {
            residencyStatus = 'NRI';
            residencyReason = `Spent ${daysInIndia} days in India (less than 120 days threshold for high-income citizens).`;
          }
        } else {
          // Citizen visiting India with income <= 15L has threshold of 182 days
          residencyStatus = 'NRI';
          residencyReason = `Indian citizen visiting India with Indian income <= ₹15L. Stay was ${daysInIndia} days (less than 182 days).`;
        }
      } else {
        // Non-citizen (or PIO under standard 60-day rule)
        if (daysInIndia >= 60) {
          residencyStatus = 'ROR';
          residencyReason = `Spent ${daysInIndia} days in India (meets the 60 days + 365 days preceding rules for non-citizens).`;
        } else {
          residencyStatus = 'NRI';
          residencyReason = `Spent ${daysInIndia} days in India (less than the 60-day presence rule for non-citizens).`;
        }
      }
    } else {
      residencyStatus = 'NRI';
      residencyReason = `Preceding 4 years presence in India (${config.preceding4YearsDays} days) is less than 365 days threshold.`;
    }
  }

  // Open Add/Edit Modal
  const openTripModal = (trip: Trip | null = null) => {
    if (!canWrite) return;
    if (trip) {
      setEditingTrip(trip);
      setFormData({
        startDate: trip.startDate,
        endDate: trip.endDate,
        purpose: trip.purpose || 'Vacation',
        notes: trip.notes || ''
      });
    } else {
      setEditingTrip(null);
      setFormData({
        startDate: '',
        endDate: '',
        purpose: 'Vacation',
        notes: ''
      });
    }
    setIsModalOpen(true);
  };

  // Submit Trip
  const handleTripSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canWrite || !formData.startDate || !formData.endDate) return;

    if (new Date(formData.startDate) > new Date(formData.endDate)) {
      alert("Start Date cannot be after End Date");
      return;
    }

    setSaving(true);
    try {
      const tripsRef = collection(db, `portfolios/${portfolioId}/trips`);
      const tripData = {
        portfolioId,
        destinationRegion: 'India' as const, // Only tracking India trips
        purpose: formData.purpose,
        startDate: formData.startDate,
        endDate: formData.endDate,
        notes: formData.notes,
        updatedAt: new Date()
      };

      if (editingTrip) {
        const tripDocRef = doc(db, `portfolios/${portfolioId}/trips`, editingTrip.id);
        await updateDoc(tripDocRef, tripData);
      } else {
        await addDoc(tripsRef, {
          ...tripData,
          createdAt: new Date()
        });
      }

      setIsModalOpen(false);
      setEditingTrip(null);
    } catch (err) {
      console.error("Failed to save trip:", err);
      alert("Failed to save trip. Check your connection.");
    } finally {
      setSaving(false);
    }
  };

  // Delete Trip
  const handleTripDelete = async (tripId: string) => {
    if (!canWrite || !window.confirm("Are you sure you want to delete this trip log?")) return;
    try {
      const tripDocRef = doc(db, `portfolios/${portfolioId}/trips`, tripId);
      await deleteDoc(tripDocRef);
    } catch (err) {
      console.error("Failed to delete trip:", err);
      alert("Failed to delete trip.");
    }
  };

  // AI Advisor - Fetch Custom Tax Tips from Gemini
  const handleConsultAITax = async () => {
    setAiLoading(true);
    setShowAiModal(true);

    // Extract asset summaries for context
    const assetSummary = investments.map(inv => {
      const val = rates && inv.currency !== displayCurrency
        ? (inv.currentValue / rates[inv.currency]) * (rates[displayCurrency] || 1)
        : inv.currentValue;
      return `${inv.name} (${inv.type}, Region: ${inv.region}, Val: ${val.toFixed(0)} ${displayCurrency})`;
    }).join(", ");

    try {
      const savedKey = localStorage.getItem('gemini_api_key') || '';

      // Fallback: load from Firestore secrets if we have permission, or throw error
      let resolvedKey = savedKey;
      if (!resolvedKey) {
        try {
          const docName = user?.email?.toLowerCase() === 'admin@example.com' ? 'gemini' : 'demo_gemini';
          const secretSnap = await fetch(`https://firestore.googleapis.com/v1/projects/melavo-514b7/databases/(default)/documents/secrets/${docName}`)
            .then(res => res.json());
          resolvedKey = secretSnap.fields?.key?.stringValue || '';
        } catch (e) {
          console.warn("Could not read credentials from Firestore API:", e);
        }
      }

      if (!resolvedKey) {
        setAiReport("### API Key Required\n\nPlease enter a Google Gemini API Key in the settings panel (Sparkles button at bottom-right) to generate tax advice.");
        setAiLoading(false);
        return;
      }

      const prompt = `
Tax Year: FY ${selectedFY}
Logged Days in India: ${daysInIndia}
Days Outside India: ${daysOutsideIndia}
User Details: Indian Citizen: ${config.isIndianCitizen}, Indian Income > 15L: ${config.hasIndianIncomeOver15L}, Stay in prior 4 years: ${config.preceding4YearsDays} days.
Current Residency Evaluation: ${residencyStatus} (${residencyReason})

Invested Assets: [${assetSummary}]

Provide a strategic tax evaluation report covering:
1. Clarification of the user's active Indian Tax Residency classification.
2. Major tax implications on their assets (especially TDS on Indian Mutual Funds/Stocks, taxation of European savings interest, and double taxation relief DTAA).
3. Risks regarding Schedule FA (Foreign Assets) reporting if classified as a Resident (ROR).
4. Direct, actionable calendar strategy tips (e.g., how many days they can stay in India next year to maintain NRI status).
Ensure the tone is highly professional, clean, structured in Markdown. Add a warning disclaimer at the end.`;

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${resolvedKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          systemInstruction: {
            parts: [{ text: "You are Aura, an elite personal finance and tax residency advisor for global Indian expats (NRIs). Compile a clean, comprehensive, and structured residency tax report. Avoid placeholders." }]
          }
        })
      });

      if (!response.ok) throw new Error("Gemini API call failed");
      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "Failed to compile AI insights.";
      setAiReport(text);
    } catch (err: any) {
      console.error(err);
      setAiReport(`### Advisor Error\n\nFailed to compile advice: ${err.message || 'Check your Gemini key or network connection.'}`);
    } finally {
      setAiLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="h-[400px] flex flex-col items-center justify-center gap-3">
        <RefreshCw className="w-8 h-8 text-teal-400 animate-spin" />
        <span className="text-xs text-secondary font-mono">Syncing travel ledger...</span>
      </div>
    );
  }

  // Capital Gains Tax Harvesting calculations (Indian Equities)
  const indianEquities = investments.filter(
    (inv: Investment) => (inv.type === 'stock' || inv.type === 'mutual_fund') && inv.region === 'India'
  );

  let accruedLtcg = 0;
  let accruedStcg = 0;
  const harvestingCandidates: { investment: Investment; gains: number; holdingPeriodDays: number }[] = [];
  const missingPurchaseDates: Investment[] = [];

  const todayDate = new Date();

  indianEquities.forEach((inv: Investment) => {
    if (!inv.startDate) {
      missingPurchaseDates.push(inv);
      return;
    }

    const purchaseDate = new Date(inv.startDate);
    const diffTime = todayDate.getTime() - purchaseDate.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    const isLtcg = diffDays > 365;
    const gains = inv.currentValue - inv.amountInvested;

    if (gains > 0) {
      if (isLtcg) {
        accruedLtcg += gains;
        harvestingCandidates.push({
          investment: inv,
          gains,
          holdingPeriodDays: diffDays
        });
      } else {
        accruedStcg += gains;
      }
    }
  });

  const LTCG_TAX_FREE_LIMIT = 125000;
  const availableHarvestingMargin = Math.max(0, LTCG_TAX_FREE_LIMIT - accruedLtcg);

  // Insurance Tax planning aggregates
  const insurancePolicies = investments.filter(inv => inv.type === 'insurance');
  const total80CPremium = insurancePolicies
    .filter(p => p.policyType === 'life' || p.policyType === 'term')
    .reduce((sum, p) => sum + convertCurrency(p.premiumAmount || 0, p.currency, displayCurrency, rates || {} as any), 0);

  const total80DPremium = insurancePolicies
    .filter(p => p.policyType === 'health')
    .reduce((sum, p) => sum + convertCurrency(p.premiumAmount || 0, p.currency, displayCurrency, rates || {} as any), 0);

  const sec80CLimit = convertCurrency(150000, 'INR', displayCurrency, rates || {} as any);
  const sec80DLimit = convertCurrency(25000, 'INR', displayCurrency, rates || {} as any);

  const allowed80CDeduction = Math.min(sec80CLimit, total80CPremium);
  const allowed80DDeduction = Math.min(sec80DLimit, total80DPremium);

  return (
    <div className="space-y-6">
      {/* Header Panel */}
      <div className="glass-panel p-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Calendar className="text-teal-400 w-6 h-6" />
            Tax Residency & Travel Tracker
          </h2>
          <p className="text-xs text-secondary mt-1">
            Track days spent in India to evaluate your tax residency status (ROR vs RNOR vs NRI) and get tax guidance.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-xs text-secondary font-semibold">Tax Year (FY):</label>
            <select
              value={selectedFY}
              onChange={(e) => setSelectedFY(e.target.value)}
              className="bg-surface border border-light rounded-lg px-2.5 py-1.5 text-xs font-semibold focus:outline-none focus:border-teal-500"
            >
              {taxYears.map((y) => (
                <option key={y} value={y}>FY {y}</option>
              ))}
            </select>
          </div>

          <button
            onClick={() => openTripModal()}
            disabled={!canWrite}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-teal-500 hover:bg-teal-400 text-base-dark transition-all disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5" />
            Log Trip to India
          </button>
        </div>
      </div>

      {/* Capital Gains & Tax-Harvesting Optimizer */}
      <div className="glass-panel p-6 border-l-4 border-l-indigo-500">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
          <div>
            <h3 className="text-lg font-bold flex items-center gap-2 text-white">
              <Sparkles className="w-5 h-5 text-indigo-400" />
              Capital Gains & Tax-Harvesting Optimizer (Indian Equity)
            </h3>
            <p className="text-xs text-secondary mt-1">
              Maximize your annual tax-free gains. Under Section 112A, long-term capital gains (LTCG) on Indian equity up to **₹1.25 Lakhs per FY** are completely tax-exempt.
            </p>
          </div>
          <div className="text-right">
            <span className="text-[10px] text-secondary font-semibold uppercase block">Tax-Free LTCG Limit</span>
            <span className="text-base font-bold text-white font-mono">₹1,25,000 / Year</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-white/[0.02] p-4 rounded-xl border border-white/5">
            <span className="text-[10px] text-secondary uppercase font-bold block mb-1">Accrued LTCG (Indian Equity)</span>
            <span className="text-lg font-bold font-mono text-amber-400">
              ₹{accruedLtcg.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
            </span>
            <span className="text-[10px] text-secondary block mt-0.5">Holding period &gt; 365 days</span>
          </div>

          <div className="bg-white/[0.02] p-4 rounded-xl border border-white/5">
            <span className="text-[10px] text-secondary uppercase font-bold block mb-1">Remaining Tax-Free Margin</span>
            <span className="text-lg font-bold font-mono text-green-400">
              ₹{availableHarvestingMargin.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
            </span>
            <span className="text-[10px] text-secondary block mt-0.5">Available for tax-free tax harvesting</span>
          </div>

          <div className="bg-white/[0.02] p-4 rounded-xl border border-white/5">
            <span className="text-[10px] text-secondary uppercase font-bold block mb-1">Accrued STCG (Indian Equity)</span>
            <span className="text-lg font-bold font-mono text-rose-400">
              ₹{accruedStcg.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
            </span>
            <span className="text-[10px] text-secondary block mt-0.5">Holding period &lt;= 365 days (Taxed at 20%)</span>
          </div>
        </div>

        {/* Advice / Suggestions */}
        <div className="space-y-4">
          <div className="bg-indigo-950/20 border border-indigo-500/20 p-4 rounded-xl">
            <h4 className="text-xs font-bold text-indigo-300 flex items-center gap-1.5 mb-2">
              <Sparkles className="w-4 h-4 text-indigo-400" />
              Aura Tax Harvesting Strategy Suggestions
            </h4>
            {availableHarvestingMargin > 0 ? (
              <p className="text-xs text-secondary leading-relaxed">
                You have **₹{availableHarvestingMargin.toLocaleString('en-IN', { maximumFractionDigits: 0 })}** of tax-free LTCG margin remaining. 
                {harvestingCandidates.length > 0 ? (
                  <span>
                    {" "}Consider selling units of the qualified LTCG holdings below and immediately repurchasing them. 
                    This books the gains tax-free today, resets your average purchase price higher, and reduces your future tax liability when you eventually withdraw.
                  </span>
                ) : (
                  <span>
                    {" "}Add purchase dates or log investments to see which assets qualify for tax-free booking.
                  </span>
                )}
              </p>
            ) : (
              <p className="text-xs text-secondary leading-relaxed">
                You have fully utilized your ₹1.25 Lakhs tax-free LTCG limit for this FY. Any further Indian equity LTCG redemptions will be subject to a 12.5% tax rate. Avoid selling further long-term assets until next financial year.
              </p>
            )}
          </div>

          {/* Qualified holdings for harvesting */}
          {harvestingCandidates.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-light text-[10px] text-secondary font-bold uppercase tracking-wider">
                    <th className="py-2 px-1">Qualified LTCG Asset</th>
                    <th className="py-2 px-1">Purchase Date</th>
                    <th className="py-2 px-1">Holding Period</th>
                    <th className="py-2 px-1">Accrued LTCG</th>
                    <th className="py-2 px-1 text-right">Harvesting Feasibility</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-light text-xs">
                  {harvestingCandidates.map((candidate) => {
                    const { investment, gains, holdingPeriodDays } = candidate;
                    const pctOfMargin = (gains / availableHarvestingMargin) * 100;
                    const isFeasible = gains <= availableHarvestingMargin;
                    
                    return (
                      <tr key={investment.id} className="hover:bg-white/2 transition-colors">
                        <td className="py-2 px-1 font-semibold text-white">{investment.name}</td>
                        <td className="py-2 px-1 font-mono text-secondary">{formatDateDMY(investment.startDate || '')}</td>
                        <td className="py-2 px-1 text-secondary">{Math.floor(holdingPeriodDays / 30)} months ({holdingPeriodDays} days)</td>
                        <td className="py-2 px-1 font-mono text-green-400">₹{gains.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</td>
                        <td className="py-2 px-1 text-right">
                          {isFeasible ? (
                            <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-green-500/10 text-green-400 border border-green-500/10">
                              Fully Harvestable (uses {pctOfMargin.toFixed(0)}% of margin)
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/10">
                              Exceeds remaining margin by ₹{(gains - availableHarvestingMargin).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Missing purchase dates list */}
          {missingPurchaseDates.length > 0 && (
            <div className="p-4 bg-yellow-500/5 border border-yellow-500/10 rounded-xl space-y-2">
              <h4 className="text-xs font-bold text-yellow-500 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4" />
                Indian Equity Assets Missing Purchase Dates
              </h4>
              <p className="text-[11px] text-secondary leading-relaxed">
                The holding periods for these Indian equity holdings cannot be calculated. To evaluate STCG vs. LTCG, edit these assets in the **Investments** tab to add their purchase date:
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                {missingPurchaseDates.map((inv: Investment) => (
                  <span key={inv.id} className="bg-white/5 border border-white/5 text-secondary text-xs px-2.5 py-1 rounded-lg font-mono">
                    ⚠️ {inv.name} ({inv.institution})
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Tax Deductions Planner (Section 80C & 80D) */}
      <div className="glass-panel p-6 border-l-4 border-l-emerald-500 space-y-4">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h3 className="text-lg font-bold flex items-center gap-2 text-white">
              <ShieldCheck className="w-5 h-5 text-emerald-400" />
              Tax Deductions Planner (Section 80C & 80D)
            </h3>
            <p className="text-xs text-secondary mt-1">
              Optimize your tax deductions on insurance premiums in India. Section 80C covers Life/Term policies, while Section 80D covers Medical/Health insurance premiums.
            </p>
          </div>
          <div className="text-right font-mono">
            <span className="text-[10px] text-secondary font-semibold uppercase block">Active Deductions Target</span>
            <span className="text-base font-bold text-white">
              Max: {formatCurrency(convertCurrency(175000, 'INR', displayCurrency, rates || {} as any), displayCurrency)} / Year
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Section 80C Card */}
          <div className="bg-white/[0.02] p-4 rounded-xl border border-white/5 space-y-3">
            <div className="flex justify-between items-start">
              <div>
                <span className="text-xs font-bold text-white block">Section 80C (Term/Life Insurance)</span>
                <span className="text-[10px] text-secondary">Exempts premiums paid up to {formatCurrency(sec80CLimit, displayCurrency)}</span>
              </div>
              <span className="text-xs font-mono font-bold text-emerald-400">
                {formatCurrency(allowed80CDeduction, displayCurrency)} Claimed
              </span>
            </div>
            
            <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden">
              <div 
                className="h-full bg-emerald-400 rounded-full" 
                style={{ width: `${Math.min(100, (total80CPremium / (sec80CLimit || 1)) * 100)}%` }}
              ></div>
            </div>

            <div className="flex justify-between text-[10px] text-secondary font-mono">
              <span>Total Premiums: {formatCurrency(total80CPremium, displayCurrency)}</span>
              <span>Limit: {formatCurrency(sec80CLimit, displayCurrency)}</span>
            </div>
          </div>

          {/* Section 80D Card */}
          <div className="bg-white/[0.02] p-4 rounded-xl border border-white/5 space-y-3">
            <div className="flex justify-between items-start">
              <div>
                <span className="text-xs font-bold text-white block">Section 80D (Health/Medical Insurance)</span>
                <span className="text-[10px] text-secondary">Exempts health premiums up to {formatCurrency(sec80DLimit, displayCurrency)}</span>
              </div>
              <span className="text-xs font-mono font-bold text-emerald-400">
                {formatCurrency(allowed80DDeduction, displayCurrency)} Claimed
              </span>
            </div>

            <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden">
              <div 
                className="h-full bg-emerald-400 rounded-full" 
                style={{ width: `${Math.min(100, (total80DPremium / (sec80DLimit || 1)) * 100)}%` }}
              ></div>
            </div>

            <div className="flex justify-between text-[10px] text-secondary font-mono">
              <span>Total Premiums: {formatCurrency(total80DPremium, displayCurrency)}</span>
              <span>Limit: {formatCurrency(sec80DLimit, displayCurrency)}</span>
            </div>
          </div>
        </div>

        {insurancePolicies.length > 0 && (
          <div className="p-3 bg-emerald-950/20 border border-emerald-500/20 rounded-xl text-xs text-secondary leading-relaxed">
            <strong>Deductions Summary:</strong> You are currently saving <strong>{formatCurrency(allowed80CDeduction + allowed80DDeduction, displayCurrency)}</strong> in taxable income from your active insurance policies. 
            {total80CPremium > sec80CLimit && (
              <span className="text-amber-400 block mt-1">
                ⚠️ Your Section 80C premiums exceed the tax-free limit. Any excess premium above {formatCurrency(sec80CLimit, displayCurrency)} will not yield further tax savings.
              </span>
            )}
            {total80DPremium > sec80DLimit && (
              <span className="text-amber-400 block mt-1">
                ⚠️ Your Section 80D premiums exceed the standard limit. (Note: limit increases to ₹50,000 in India if premiums are paid for senior citizen parents).
              </span>
            )}
          </div>
        )}
      </div>

      {/* Main Grid: Metrics & Config */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Column 1: Physical Presence Indicators */}
        <div className="glass-panel p-6 flex flex-col justify-between min-h-[300px]">
          <div>
            <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-4 flex items-center gap-2">
              <Clock className="w-4 h-4 text-teal-400" />
              Physical Presence in FY {selectedFY}
            </h3>
            <p className="text-xs text-secondary mb-6">
              Calculated from logged arrival and departure dates in India.
            </p>
          </div>

          <div style={{ height: '180px', width: '100%', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '8px 0' }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={[
                    { name: 'In India', value: daysInIndia },
                    { name: 'Outside India', value: daysOutsideIndia }
                  ]}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={75}
                  paddingAngle={3}
                  dataKey="value"
                >
                  <Cell key="cell-in-india" fill="#f59e0b" />
                  <Cell key="cell-outside-india" fill="#6366f1" />
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: 'rgba(20, 20, 25, 0.95)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: '12px',
                    fontSize: '11px',
                    color: '#fff'
                  }}
                  formatter={(value: any) => [`${value} Days`, '']}
                />
              </PieChart>
            </ResponsiveContainer>

            {/* Center Text displaying days in India */}
            <div style={{ position: 'absolute', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <span style={{ fontSize: '24px', fontWeight: 'bold', color: '#fff' }}>{daysInIndia}</span>
              <span style={{ fontSize: '10px', color: '#94a3b8', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Days in India</span>
            </div>
          </div>

          <div className="text-[10px] text-secondary font-mono text-center mt-4">
            Total days in this financial year: {totalDaysInFY} days
          </div>
        </div>

        {/* Column 2: Configurations & Variables */}
        <div className="glass-panel p-6 flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-4 flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-teal-400" />
              Tax Profile Settings
            </h3>
            <p className="text-xs text-secondary mb-6">
              Configure parameters used to evaluate your residency rules.
            </p>
          </div>

          <div className="space-y-4">
            {/* Citizenship Toggle */}
            <div className="flex justify-between items-center bg-surface-solid/35 p-3 rounded-xl border border-light">
              <div>
                <label className="text-xs font-semibold text-white block">Indian Citizen / PIO</label>
                <span className="text-[10px] text-secondary">Allows visiting rules extensions</span>
              </div>
              <input
                type="checkbox"
                checked={config.isIndianCitizen}
                disabled={!canWrite}
                onChange={(e) => handleConfigChange('isIndianCitizen', e.target.checked)}
                className="w-4 h-4 accent-teal-500 cursor-pointer"
              />
            </div>

            {/* Income Toggle */}
            <div className={`flex justify-between items-center bg-surface-solid/35 p-3 rounded-xl border border-light transition-all ${!config.isIndianCitizen ? 'opacity-40' : ''}`}>
              <div>
                <label className="text-xs font-semibold text-white block">Indian Income &gt; ₹15 Lakhs</label>
                <span className="text-[10px] text-secondary">Triggers 120-day residency checks</span>
              </div>
              <input
                type="checkbox"
                checked={config.isIndianCitizen && config.hasIndianIncomeOver15L}
                disabled={!canWrite || !config.isIndianCitizen}
                onChange={(e) => handleConfigChange('hasIndianIncomeOver15L', e.target.checked)}
                className="w-4 h-4 accent-teal-500 cursor-pointer"
              />
            </div>

            {/* Prior Stay Days */}
            <div className="flex justify-between items-center bg-surface-solid/35 p-3 rounded-xl border border-light">
              <div>
                <label className="text-xs font-semibold text-white block">Stay in Prior 4 Years</label>
                <span className="text-[10px] text-secondary">Days in India (Preceding 4 FYs)</span>
              </div>
              <input
                type="number"
                value={config.preceding4YearsDays}
                disabled={!canWrite}
                onChange={(e) => handleConfigChange('preceding4YearsDays', parseInt(e.target.value) || 0)}
                className="w-16 bg-surface border border-light rounded-lg px-2 py-1 text-xs text-center font-bold focus:outline-none focus:border-teal-500"
              />
            </div>
          </div>

          <div className="text-[10px] text-secondary mt-4 flex items-center gap-1">
            <Info className="w-3 h-3 text-teal-400 shrink-0" />
            <span>Settings are stored in your portfolio and shared dynamically.</span>
          </div>
        </div>

        {/* Column 3: Residency Status Output */}
        <div className="glass-panel p-6 flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-4 flex items-center gap-2">
              <Landmark className="w-4 h-4 text-teal-400" />
              Tax Residency Evaluation
            </h3>
            <p className="text-xs text-secondary mb-6">
              Determined residency category for FY {selectedFY}.
            </p>
          </div>

          <div className="text-center p-4 bg-surface-solid/40 border border-light rounded-2xl shadow-glow">
            {residencyStatus === 'NRI' ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 mb-2">
                <CheckCircle className="w-3.5 h-3.5" />
                Non-Resident Indian (NRI)
              </span>
            ) : residencyStatus === 'RNOR' ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20 mb-2">
                <Info className="w-3.5 h-3.5" />
                Resident but Not Ordinarily Resident (RNOR)
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20 mb-2">
                <AlertTriangle className="w-3.5 h-3.5" />
                Resident & Ordinarily Resident (ROR)
              </span>
            )}

            <h4 className="text-lg font-bold text-white mt-1">
              {residencyStatus === 'NRI'
                ? 'Non-Resident (NR)'
                : residencyStatus === 'RNOR'
                  ? 'Resident (RNOR)'
                  : 'Ordinary Resident (ROR)'}
            </h4>

            <p className="text-[11px] text-secondary mt-3 leading-relaxed px-2">
              {residencyReason}
            </p>
          </div>

          <button
            onClick={handleConsultAITax}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs font-bold bg-gradient-to-r from-teal-500/20 to-indigo-600/20 border border-teal-500/30 text-teal-300 hover:text-white hover:from-teal-500/30 hover:to-indigo-600/30 transition-all shadow-glow mt-4"
          >
            <Sparkles className="w-4 h-4 text-teal-400 animate-pulse" />
            Consult Aura AI Tax Advisor
          </button>
        </div>

      </div>

      {/* Travel logs & Guidance */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Left: Travel Logs */}
        <div className="glass-panel p-6 flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-4 flex items-center gap-2">
              <Plane className="w-4 h-4 text-teal-400" />
              Logged Trips to India (All Time)
            </h3>
            <p className="text-xs text-secondary mb-4">
              Chronological list of all logged travel logs to India.
            </p>
          </div>

          {/* Table */}
          <div className="overflow-x-auto flex-grow min-h-[200px]">
            {trips.length === 0 ? (
              <div className="flex flex-col items-center justify-center text-center p-8 h-full">
                <Plane className="w-12 h-12 text-secondary/40 mb-3 rotate-45" />
                <h4 className="text-xs font-bold text-secondary">No trips logged yet</h4>
                <p className="text-[10px] text-secondary/60 max-w-[200px] mt-1">
                  Log your trips to India to check your physical presence days.
                </p>
              </div>
            ) : (
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-light text-[10px] text-secondary font-bold uppercase tracking-wider">
                    <th className="py-2.5 px-2">Departure Date (Leaving Home)</th>
                    <th className="py-2.5 px-2">Arrival Date (Returning Home)</th>
                    <th className="py-2.5 px-2">No. of Days</th>
                    <th className="py-2.5 px-2">Purpose</th>
                    <th className="py-2.5 px-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-light text-xs">
                  {trips.map((trip) => {
                    return (
                      <tr key={trip.id} className="hover:bg-white/2 transition-colors">
                        <td className="py-2.5 px-2 font-mono text-white">{formatDateDMY(trip.startDate)}</td>
                        <td className="py-2.5 px-2 font-mono text-white">{formatDateDMY(trip.endDate)}</td>
                        <td className="py-2.5 px-2 font-mono text-white">{getTripDuration(trip.startDate, trip.endDate)}</td>
                        <td className="py-2.5 px-2">
                          <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-teal-500/10 text-teal-400 border border-teal-500/10">
                            {trip.purpose}
                          </span>
                        </td>
                        <td className="py-2.5 px-2 text-right">
                          <div className="flex justify-end gap-1.5">
                            <button
                              onClick={() => openTripModal(trip)}
                              disabled={!canWrite}
                              className="p-1 rounded bg-surface border border-light text-secondary hover:text-white transition-colors disabled:opacity-50"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleTripDelete(trip.id)}
                              disabled={!canWrite}
                              className="p-1 rounded bg-surface border border-light text-secondary hover:text-rose-400 transition-colors disabled:opacity-50"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Right: Dynamic Guidance Panel */}
        <div className="glass-panel p-6 flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-4 flex items-center gap-2">
              <Landmark className="w-4 h-4 text-teal-400" />
              Guidance for {residencyStatus === 'NRI' ? 'NRI' : residencyStatus === 'RNOR' ? 'RNOR' : 'ROR'} Status
            </h3>
            <p className="text-xs text-secondary mb-4">
              Summary of tax liabilities and guidelines for your asset portfolio.
            </p>
          </div>

          <div className="space-y-4 flex-grow">
            {residencyStatus === 'NRI' ? (
              <>
                <div className="bg-emerald-500/5 border border-emerald-500/15 p-4 rounded-xl space-y-2.5">
                  <h4 className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
                    <CheckCircle className="w-4 h-4" />
                    Exemption on Foreign Income
                  </h4>
                  <p className="text-[11px] text-secondary leading-relaxed">
                    Your salary and investment income earned outside of India (e.g. European interest or stocks) are **not taxable** in India. Global reporting is not required.
                  </p>
                </div>

                <div className="bg-surface-solid/30 border border-light p-4 rounded-xl space-y-2.5">
                  <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
                    <Landmark className="w-4 h-4 text-teal-400" />
                    Mutual Funds & TDS Rates
                  </h4>
                  <p className="text-[11px] text-secondary leading-relaxed">
                    Indian Mutual Funds are taxable in India. However, as an NRI, **TDS is automatically deducted at the time of redemption**:
                    <br />• **Equity STCG**: 15% TDS.
                    <br />• **Equity LTCG**: 10% TDS (on gains &gt; ₹1.25L).
                    <br />• **Debt Funds**: TDS is deducted at 30% (maximum tax rate).
                  </p>
                </div>

                <div className="bg-surface-solid/30 border border-light p-4 rounded-xl space-y-2">
                  <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
                    <HelpCircle className="w-4 h-4 text-teal-400" />
                    Banking Accounts Configuration
                  </h4>
                  <p className="text-[11px] text-secondary leading-relaxed">
                    You must convert your local resident accounts into NRE (Non-Resident External - tax-free interest) and NRO (Non-Resident Ordinary - interest subject to 30% TDS).
                  </p>
                </div>
              </>
            ) : residencyStatus === 'RNOR' ? (
              <>
                <div className="bg-amber-500/5 border border-amber-500/15 p-4 rounded-xl space-y-2.5">
                  <h4 className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                    <Info className="w-4 h-4" />
                    RNOR Transition Benefits
                  </h4>
                  <p className="text-[11px] text-secondary leading-relaxed">
                    As a Resident but Not Ordinarily Resident (RNOR), your foreign assets and foreign-earned income **remain tax-exempt** in India. This serves as a buffer period for returning expats (typically 1 to 3 years).
                  </p>
                </div>

                <div className="bg-surface-solid/30 border border-light p-4 rounded-xl space-y-2.5">
                  <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
                    <CheckCircle className="w-4 h-4 text-teal-400" />
                    Foreign Asset Disclosures (Exempt)
                  </h4>
                  <p className="text-[11px] text-secondary leading-relaxed">
                    Unlike ordinary residents, RNORs are **exempt** from disclosing foreign bank accounts, shares, and assets in **Schedule FA** (Foreign Assets) of the Indian Income Tax Return.
                  </p>
                </div>
              </>
            ) : (
              <>
                <div className="bg-rose-500/5 border border-rose-500/15 p-4 rounded-xl space-y-2.5">
                  <h4 className="text-xs font-bold text-rose-400 flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4" />
                    Global Income is Taxable in India
                  </h4>
                  <p className="text-[11px] text-secondary leading-relaxed">
                    Your global income—including interest on European savings accounts, dividends, and European capital gains—is **fully taxable in India** under standard income slabs.
                  </p>
                </div>

                <div className="bg-surface-solid/30 border border-light p-4 rounded-xl space-y-2.5">
                  <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-rose-400" />
                    Mandatory Schedule FA Disclosure
                  </h4>
                  <p className="text-[11px] text-secondary leading-relaxed">
                    It is **compulsory** to declare all foreign bank accounts, custody accounts, stock holdings, and properties in **Schedule FA** of your Indian tax return. Failing to disclose assets carries severe penalties under the Black Money Act (up to ₹10 Lakhs).
                  </p>
                </div>

                <div className="bg-surface-solid/30 border border-light p-4 rounded-xl space-y-2">
                  <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
                    <Info className="w-4 h-4 text-teal-400" />
                    Double Taxation Avoidance Agreement (DTAA)
                  </h4>
                  <p className="text-[11px] text-secondary leading-relaxed">
                    To avoid paying taxes twice on your European assets, you can claim **Tax Credits** in India for the taxes already paid in Europe under the DTAA agreement between the respective countries.
                  </p>
                </div>
              </>
            )}
          </div>
        </div>

      </div>

      {/* Log Trip Modal */}
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
              {editingTrip ? 'Edit Trip Log' : 'Log Trip to India'}
            </h3>

            <form onSubmit={handleTripSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block text-secondary font-semibold mb-1">Departure Date (Leaving Home):</label>
                <input
                  type="date"
                  required
                  value={formData.startDate}
                  onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                  className="w-full bg-surface border border-light rounded-lg px-3 py-2 text-white focus:outline-none focus:border-teal-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-secondary font-semibold mb-1">Arrival Date (Returning Home):</label>
                <input
                  type="date"
                  required
                  value={formData.endDate}
                  onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                  className="w-full bg-surface border border-light rounded-lg px-3 py-2 text-white focus:outline-none focus:border-teal-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-secondary font-semibold mb-1">Purpose of Visit:</label>
                <select
                  value={formData.purpose}
                  onChange={(e) => setFormData({ ...formData, purpose: e.target.value })}
                  className="w-full bg-surface border border-light rounded-lg px-3 py-2 text-white focus:outline-none focus:border-teal-500"
                >
                  <option value="Vacation">Vacation</option>
                  <option value="Business">Business</option>
                  <option value="Family Visit">Family Visit</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              <div>
                <label className="block text-secondary font-semibold mb-1">Notes:</label>
                <textarea
                  value={formData.notes}
                  placeholder="e.g. flight info or location details"
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  className="w-full h-20 bg-surface border border-light rounded-lg px-3 py-2 text-white focus:outline-none focus:border-teal-500 resize-none"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-lg font-bold border border-light text-secondary hover:text-white transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 rounded-lg font-bold bg-teal-500 hover:bg-teal-400 text-base-dark transition-all disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save Trip'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* AI Report Modal */}
      {showAiModal && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/70 backdrop-blur-sm z-50 p-4">
          <div className="glass-panel w-full max-w-2xl p-6 relative animate-scale-in flex flex-col max-h-[85vh]">
            <button
              onClick={() => setShowAiModal(false)}
              className="absolute top-4 right-4 p-1 rounded-full text-secondary hover:text-white hover:bg-white/5 transition-all"
            >
              <X className="w-4 h-4" />
            </button>

            <h3 className="text-base font-bold text-white mb-2 flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-teal-400 animate-pulse" />
              Aura Tax Advisor Insights
            </h3>

            <p className="text-[10px] text-secondary mb-4">
              AI-generated residency compliance analysis for global investment portfolios.
            </p>

            <div className="overflow-y-auto pr-2 flex-grow space-y-4 text-xs leading-relaxed border-t border-light pt-4 text-secondary">
              {aiLoading ? (
                <div className="flex flex-col items-center justify-center gap-3 py-16">
                  <Sparkles className="w-10 h-10 text-teal-400 animate-spin" />
                  <span className="text-xs font-mono text-secondary animate-pulse">
                    Consulting Gemini, evaluating residency thresholds, and analyzing portfolio assets...
                  </span>
                </div>
              ) : (
                <div className="markdown-content whitespace-pre-line text-white">
                  {aiReport}
                </div>
              )}
            </div>

            <div className="border-t border-light pt-4 flex justify-end">
              <button
                onClick={() => setShowAiModal(false)}
                className="px-4 py-2 rounded-lg text-xs font-bold bg-surface border border-light text-secondary hover:text-white transition-all"
              >
                Close Insights
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
