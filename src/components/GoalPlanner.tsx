import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, query, where, onSnapshot, doc, setDoc, deleteDoc, getDoc } from 'firebase/firestore';
import type { Investment, InvestmentCurrency, ExchangeRates } from '../types';
import { convertCurrency, formatCurrency } from '../utils/exchangeRates';
import { 
  Target, TrendingUp, Trash2, Save, AlertCircle, 
  Sparkles, RefreshCw, Compass, HelpCircle, CheckCircle2
} from 'lucide-react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend
} from 'recharts';

interface Goal {
  id: string;
  portfolioId: string;
  name: string;
  targetAmount: number;
  targetCurrency: InvestmentCurrency;
  targetYears: number;
  monthlyContribution: number;
  riskProfile: 'conservative' | 'balanced' | 'aggressive';
  ownerId: string;
  createdAt: any;
  updatedAt: any;
}

interface GoalPlannerProps {
  portfolioId: string;
  investments: Investment[];
  rates: ExchangeRates;
  user: any;
  canWrite: boolean;
}

export const GoalPlanner: React.FC<GoalPlannerProps> = ({
  portfolioId,
  investments,
  rates,
  user,
  canWrite
}) => {
  // Goal List and Selection
  const [goals, setGoals] = useState<Goal[]>([]);
  const [selectedGoalId, setSelectedGoalId] = useState<string>('new');
  
  // Goal Form State
  const [goalName, setGoalName] = useState('');
  const [targetAmount, setTargetAmount] = useState('1000000');
  const [targetCurrency, setTargetCurrency] = useState<InvestmentCurrency>('INR');
  const [targetYears, setTargetYears] = useState('5');
  const [monthlyContribution, setMonthlyContribution] = useState('10000');
  const [riskProfile, setRiskProfile] = useState<'conservative' | 'balanced' | 'aggressive'>('balanced');
  
  // Status and Loading
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // AI Advisor state
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [aiReport, setAiReport] = useState<string>('');
  const [aiError, setAiError] = useState<string | null>(null);

  // Load Gemini API Key
  const [apiKey, setApiKey] = useState<string>('');

  useEffect(() => {
    const loadKey = async () => {
      const isOwner = user?.email?.toLowerCase() === 'admin@example.com';
      if (!isOwner) {
        return;
      }
      const envKey = (import.meta.env.VITE_GEMINI_API_KEY as string) || '';
      if (envKey) {
        setApiKey(envKey);
        return;
      }
      try {
        const secretDocRef = doc(db, 'secrets', 'gemini');
        const secretSnap = await getDoc(secretDocRef);
        if (secretSnap.exists()) {
          setApiKey(secretSnap.data().key || '');
        }
      } catch (err) {
        console.warn("Could not load secure key from Firestore.", err);
      }
    };
    loadKey();
  }, [user]);

  // Fetch goals for active portfolio
  useEffect(() => {
    if (!portfolioId) return;
    setError(null);
    setSuccess(null);
    setAiReport('');
    setAiError(null);

    const q = query(
      collection(db, 'goals'),
      where('portfolioId', '==', portfolioId)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list: Goal[] = [];
      snapshot.forEach((docSnap) => {
        list.push(docSnap.data() as Goal);
      });
      setGoals(list);
      
      // Auto-select first goal or reset to 'new'
      if (list.length > 0) {
        setSelectedGoalId(list[0].id);
      } else {
        setSelectedGoalId('new');
        resetForm();
      }
    }, (err) => {
      console.error("Failed to load goals", err);
      setError("Failed to fetch goals.");
    });

    return () => unsubscribe();
  }, [portfolioId]);

  // Load selected goal into form
  useEffect(() => {
    if (selectedGoalId === 'new') {
      resetForm();
    } else {
      const activeGoal = goals.find(g => g.id === selectedGoalId);
      if (activeGoal) {
        setGoalName(activeGoal.name);
        setTargetAmount(activeGoal.targetAmount.toString());
        setTargetCurrency(activeGoal.targetCurrency);
        setTargetYears(activeGoal.targetYears.toString());
        setMonthlyContribution(activeGoal.monthlyContribution.toString());
        setRiskProfile(activeGoal.riskProfile);
        setAiReport('');
        setAiError(null);
      }
    }
  }, [selectedGoalId, goals]);

  const resetForm = () => {
    setGoalName('');
    setTargetAmount('1000000');
    setTargetCurrency('INR');
    setTargetYears('5');
    setMonthlyContribution('10000');
    setRiskProfile('balanced');
    setAiReport('');
    setAiError(null);
  };

  // Form submit handler (Create / Update Goal)
  const handleSaveGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canWrite) return;
    if (!goalName.trim()) {
      setError("Goal name is required.");
      return;
    }

    const amt = parseFloat(targetAmount);
    const yrs = parseInt(targetYears);
    const mc = parseFloat(monthlyContribution);

    if (isNaN(amt) || amt <= 0) {
      setError("Please enter a valid target amount.");
      return;
    }
    if (isNaN(yrs) || yrs <= 0 || yrs > 100) {
      setError("Please enter a target timeline between 1 and 100 years.");
      return;
    }
    if (isNaN(mc) || mc < 0) {
      setError("Please enter a valid monthly contribution.");
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const docId = selectedGoalId === 'new' ? doc(collection(db, 'goals')).id : selectedGoalId;
      const goalData: Goal = {
        id: docId,
        portfolioId,
        name: goalName.trim(),
        targetAmount: amt,
        targetCurrency,
        targetYears: yrs,
        monthlyContribution: mc,
        riskProfile,
        ownerId: user?.uid || '',
        createdAt: selectedGoalId === 'new' ? new Date() : (goals.find(g => g.id === docId)?.createdAt || new Date()),
        updatedAt: new Date()
      };

      await setDoc(doc(db, 'goals', docId), goalData);
      setSuccess(selectedGoalId === 'new' ? "Goal created successfully!" : "Goal updated successfully!");
      setSelectedGoalId(docId);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to save goal.");
    } finally {
      setSaving(false);
    }
  };

  // Delete goal handler
  const handleDeleteGoal = async () => {
    if (!canWrite || selectedGoalId === 'new') return;
    if (!window.confirm("Are you sure you want to delete this goal?")) return;

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      await deleteDoc(doc(db, 'goals', selectedGoalId));
      setSuccess("Goal deleted successfully.");
      setSelectedGoalId('new');
      resetForm();
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to delete goal.");
    } finally {
      setSaving(false);
    }
  };

  // ==========================================
  // MATHEMATICAL CALCULATIONS & PROJECTIONS
  // ==========================================

  // Asset return rate assumptions
  const assetRates = {
    stock: 0.12,        // 12%
    mutual_fund: 0.10,  // 10%
    fd: 0.065,          // 6.5%
    savings: 0.035,     // 3.5%
    other: 0.05         // 5%
  };

  // 1. Calculate current portfolio value in goal's target currency
  const currentValTargetCurr = investments.reduce((sum, inv) => {
    return sum + convertCurrency(inv.currentValue, inv.currency, targetCurrency, rates);
  }, 0);

  // 2. Calculate weighted average return rate of the current portfolio
  const calculateWeightedReturnRate = () => {
    if (investments.length === 0 || currentValTargetCurr === 0) {
      return 0.08; // default to 8% if empty
    }
    
    let totalWeightedReturns = 0;
    investments.forEach((inv) => {
      const invValInTarget = convertCurrency(inv.currentValue, inv.currency, targetCurrency, rates);
      const rate = assetRates[inv.type] || 0.05;
      totalWeightedReturns += invValInTarget * rate;
    });

    return totalWeightedReturns / currentValTargetCurr;
  };

  const weightedRate = calculateWeightedReturnRate();

  // 3. Binary Search to find the Required annual return rate to hit the goal
  const parseNum = (val: string, def: number) => {
    const n = parseFloat(val);
    return isNaN(n) ? def : n;
  };

  const goalAmt = parseNum(targetAmount, 1000000);
  const goalYrs = parseNum(targetYears, 5);
  const goalMc = parseNum(monthlyContribution, 10000);

  const findRequiredRate = (
    startVal: number,
    targetVal: number,
    years: number,
    monthlyCont: number
  ): number => {
    let low = -0.5; // allow negative returns
    let high = 1.5;  // cap search up to 150% rate
    
    const calculateFV = (annualRate: number) => {
      let fv = startVal;
      const monthlyRate = annualRate / 12;
      const totalMonths = years * 12;
      for (let m = 0; m < totalMonths; m++) {
        fv = fv * (1 + monthlyRate) + monthlyCont;
      }
      return fv;
    };

    if (calculateFV(0) >= targetVal) return 0; // 0% interest is enough

    for (let i = 0; i < 24; i++) {
      const mid = (low + high) / 2;
      const fv = calculateFV(mid);
      if (fv < targetVal) {
        low = mid;
      } else {
        high = mid;
      }
    }
    return low;
  };

  const requiredRate = findRequiredRate(currentValTargetCurr, goalAmt, goalYrs, goalMc);

  // 4. Generate projections array for Recharts
  const generateChartData = () => {
    const data = [];
    const monthlyRateProj = weightedRate / 12;
    const monthlyRateReq = requiredRate / 12;

    let fvProj = currentValTargetCurr;
    let fvReq = currentValTargetCurr;

    // Start at Year 0
    data.push({
      year: 'Year 0',
      'Projected Value': Math.round(fvProj),
      'Required Value': Math.round(fvReq)
    });

    for (let y = 1; y <= goalYrs; y++) {
      // Run compounding monthly for 12 months
      for (let m = 0; m < 12; m++) {
        fvProj = fvProj * (1 + monthlyRateProj) + goalMc;
        fvReq = fvReq * (1 + monthlyRateReq) + goalMc;
      }
      data.push({
        year: `Year ${y}`,
        'Projected Value': Math.round(fvProj),
        'Required Value': Math.round(fvReq)
      });
    }

    return data;
  };

  const chartData = generateChartData();
  const finalProjected = chartData[chartData.length - 1]['Projected Value'];
  const hasShortfall = finalProjected < goalAmt;
  const shortfallAmt = goalAmt - finalProjected;

  // ==========================================
  // GEMINI AI INTEGRATION
  // ==========================================

  const handleConsultAi = async () => {
    if (!apiKey) {
      setAiError("Aura AI Advisor key is missing or not configured.");
      return;
    }

    setIsAiLoading(true);
    setAiError(null);
    setAiReport('');

    // Compile holdings data
    const assetsSummary = investments.map(inv => {
      const val = convertCurrency(inv.currentValue, inv.currency, targetCurrency, rates);
      return `- ${inv.name}: ${formatCurrency(val, targetCurrency)} (Type: ${inv.type}, Region: ${inv.region})`;
    }).join('\n');

    const prompt = `
I have set up a financial goal inside Aura Investment Tracker. Here are the details:
- Goal Name: "${goalName}"
- Target Amount: ${formatCurrency(goalAmt, targetCurrency)}
- Target Duration: ${goalYrs} years
- Expected Monthly Additions: ${formatCurrency(goalMc, targetCurrency)}
- Selected Risk Profile: ${riskProfile}

My current portfolio contains:
- Current Normalized Valuation: ${formatCurrency(currentValTargetCurr, targetCurrency)}
- Portfolio Weighted Annual Growth Rate: ${(weightedRate * 100).toFixed(2)}%
- Target Annual Growth Rate Required to hit goal: ${(requiredRate * 100).toFixed(2)}%
- Projected End Value: ${formatCurrency(finalProjected, targetCurrency)}
- Shortfall/Surplus: ${hasShortfall ? `Shortfall of ${formatCurrency(shortfallAmt, targetCurrency)}` : `Surplus of ${formatCurrency(Math.abs(shortfallAmt), targetCurrency)}`}

Asset constituents breakdown:
${assetsSummary || 'No investments logged yet.'}

As the Aura AI Goal Advisor, analyze this goal. Provide:
1. **Feasibility Score:** Assess how realistic this goal is (e.g. Feasible, Requires Adjustments, Aggressive Action Needed).
2. **Gap Analysis:** Explain why there is a gap (or why they are succeeding), discussing asset returns vs. required growth rate.
3. **Asset Allocation Suggestion:** Give specific rebalancing suggestions. If they have low-yield assets (like FDs or savings) for a long-term goal, suggest shifting percentages into equity mutual funds/stocks. Keep in mind their chosen risk profile (${riskProfile}).
4. **Savings Adjustment:** Calculate what their new monthly contribution should be to hit the target if they keep their current asset allocation.

Format your response in beautiful, premium Markdown with clear visual alerts and structure. Avoid long introductions, start directly with the feasibility card.
`;

    const systemInstruction = "You are Aura AI Goal Advisor, a premium, direct financial planning agent built into Aura Investment Tracker. You analyze financial targets and current asset allocations, providing mathematical gap analysis and rebalancing guides.";

    try {
      const modelName = "gemini-2.5-flash";
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
      
      const requestBody = {
        contents: [{ parts: [{ text: prompt }] }],
        systemInstruction: { parts: [{ text: systemInstruction }] }
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        throw new Error("API call failed.");
      }

      const data = await response.json();
      const text = data.candidates[0].content.parts[0].text;
      setAiReport(text);
    } catch (err: any) {
      console.error(err);
      setAiError("Failed to fetch advice from Aura AI Advisor. Please try again.");
    } finally {
      setIsAiLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner and Selector */}
      <div className="glass-panel p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-white/5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-teal-500/10 flex items-center justify-center border border-teal-500/20 shadow-glow">
            <Target className="w-5.5 h-5.5 text-teal-400" />
          </div>
          <div>
            <h2 className="text-xl font-bold">Goal Planner</h2>
            <p className="text-xs text-secondary font-mono">Map compounding projections & get AI rebalancing advice</p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 w-full sm:w-auto">
          <label className="text-[10px] font-bold text-secondary uppercase shrink-0 m-0">Active Goal:</label>
          <select 
            value={selectedGoalId} 
            onChange={(e) => setSelectedGoalId(e.target.value)}
            className="py-1.5 px-3 text-xs bg-black/40 border border-white/10 rounded-lg text-white font-semibold outline-none w-full sm:w-[220px]"
          >
            <option value="new">+ Set up New Goal</option>
            {goals.map(g => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div className="p-3.5 rounded-xl bg-red-950/20 border border-red-500/20 text-red-300 text-xs flex items-center gap-2 animate-fade-in">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="p-3.5 rounded-xl bg-teal-950/20 border border-teal-500/20 text-teal-300 text-xs flex items-center gap-2 animate-fade-in">
          <CheckCircle2 className="w-4 h-4 text-teal-400 shrink-0" />
          <span>{success}</span>
        </div>
      )}

      {/* Main Grid: Form Config & Projections */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Goal Configurator Card */}
        <div className="glass-panel p-6 border-white/5 space-y-4 lg:col-span-1">
          <h3 className="text-sm font-bold uppercase tracking-wider text-teal-400 flex items-center gap-1.5">
            <Compass className="w-4 h-4" />
            <span>Goal Configurator</span>
          </h3>

          <form onSubmit={handleSaveGoal} className="space-y-3.5">
            <div>
              <label>Goal Name</label>
              <input 
                type="text" 
                placeholder="e.g. Retirement Fund, Home Equity"
                value={goalName}
                onChange={(e) => setGoalName(e.target.value)}
                disabled={!canWrite}
                className="py-2 px-3 text-sm bg-black/40"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label>Target Amount</label>
                <input 
                  type="number" 
                  min="1"
                  value={targetAmount}
                  onChange={(e) => setTargetAmount(e.target.value)}
                  disabled={!canWrite}
                  className="py-2 px-3 text-sm bg-black/40 font-semibold"
                />
              </div>
              <div>
                <label>Currency</label>
                <select 
                  value={targetCurrency}
                  onChange={(e) => setTargetCurrency(e.target.value as InvestmentCurrency)}
                  disabled={!canWrite}
                  className="py-2 px-3 text-sm bg-black/40 outline-none"
                >
                  <option value="INR">INR (₹)</option>
                  <option value="EUR">EUR (€)</option>
                  <option value="USD">USD ($)</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label>Timeline (Years)</label>
                <input 
                  type="number" 
                  min="1"
                  max="100"
                  value={targetYears}
                  onChange={(e) => setTargetYears(e.target.value)}
                  disabled={!canWrite}
                  className="py-2 px-3 text-sm bg-black/40 font-semibold"
                />
              </div>
              <div>
                <label>Monthly Addition</label>
                <input 
                  type="number" 
                  min="0"
                  value={monthlyContribution}
                  onChange={(e) => setMonthlyContribution(e.target.value)}
                  disabled={!canWrite}
                  className="py-2 px-3 text-sm bg-black/40 font-semibold"
                />
              </div>
            </div>

            <div>
              <label>Risk Profile</label>
              <div className="grid grid-cols-3 gap-2">
                {(['conservative', 'balanced', 'aggressive'] as const).map((profile) => (
                  <button
                    key={profile}
                    type="button"
                    onClick={() => setRiskProfile(profile)}
                    disabled={!canWrite}
                    className={`py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-lg border transition-all duration-150 ${
                      riskProfile === profile
                        ? 'bg-teal-500/15 text-teal-400 border-teal-500/40 shadow-glow'
                        : 'border-white/5 hover:border-white/20 text-secondary hover:text-white bg-transparent'
                    }`}
                  >
                    {profile}
                  </button>
                ))}
              </div>
            </div>

            {canWrite && (
              <div className="flex items-center gap-2 pt-3 border-t border-white/5">
                {selectedGoalId !== 'new' && (
                  <button
                    type="button"
                    onClick={handleDeleteGoal}
                    className="btn btn-secondary py-2 px-3 border-red-500/10 text-red-400 hover:border-red-500/40 hover:bg-red-500/5"
                    disabled={saving}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
                <button
                  type="submit"
                  className="btn btn-primary flex-grow py-2 text-sm"
                  disabled={saving}
                >
                  <Save className="w-4 h-4" />
                  <span>{saving ? 'Saving...' : 'Save Goal'}</span>
                </button>
              </div>
            )}
          </form>

          {/* Quick Metrics */}
          <div className="p-3.5 rounded-xl border border-white/5 bg-white/[0.01] text-xs font-mono space-y-2 pt-4">
            <div className="flex justify-between">
              <span className="text-secondary">Initial Valuation:</span>
              <span className="text-white font-semibold">{formatCurrency(currentValTargetCurr, targetCurrency)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-secondary">Weighted Portfolio Return:</span>
              <span className="text-teal-400 font-semibold">{(weightedRate * 100).toFixed(2)}% / yr</span>
            </div>
            <div className="flex justify-between">
              <span className="text-secondary">Target Growth Required:</span>
              <span className="text-indigo-400 font-semibold">{(requiredRate * 100).toFixed(2)}% / yr</span>
            </div>
          </div>
        </div>

        {/* Projection Chart Card */}
        <div className="glass-panel p-6 border-white/5 space-y-4 lg:col-span-2 flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-teal-400 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <TrendingUp className="w-4 h-4" />
                <span>Compound Trajectory Projection</span>
              </div>
              <span className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-0.5 rounded-full ${
                hasShortfall 
                  ? 'bg-red-950/40 border border-red-500/20 text-red-300'
                  : 'bg-emerald-950/40 border border-emerald-500/20 text-emerald-300'
              }`}>
                {hasShortfall ? 'Allocation Shortfall' : 'On Track'}
              </span>
            </h3>

            {/* Trajectory lines summary */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4 p-4 rounded-xl border border-white/5 bg-white/[0.01]">
              <div>
                <span className="text-[10px] uppercase font-bold text-secondary tracking-widest block mb-0.5">Target Goal</span>
                <span className="text-base font-extrabold text-white">{formatCurrency(goalAmt, targetCurrency)}</span>
              </div>
              <div>
                <span className="text-[10px] uppercase font-bold text-secondary tracking-widest block mb-0.5">Projected Value</span>
                <span className="text-base font-extrabold text-teal-400">{formatCurrency(finalProjected, targetCurrency)}</span>
              </div>
              <div>
                <span className="text-[10px] uppercase font-bold text-secondary tracking-widest block mb-0.5">
                  {hasShortfall ? 'Shortfall Gap' : 'Surplus Yield'}
                </span>
                <span className={`text-base font-extrabold ${hasShortfall ? 'text-red-400' : 'text-emerald-400'}`}>
                  {formatCurrency(Math.abs(shortfallAmt), targetCurrency)}
                </span>
              </div>
            </div>
          </div>

          {/* Recharts responsive container */}
          <div className="w-full h-64 md:h-72 mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.03)" strokeDasharray="3 3" />
                <XAxis 
                  dataKey="year" 
                  stroke="hsl(240, 6%, 70%)" 
                  fontSize={11}
                  tickLine={false}
                />
                <YAxis 
                  stroke="hsl(240, 6%, 70%)" 
                  fontSize={11}
                  tickLine={false}
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
                  formatter={(value: any) => [formatCurrency(value, targetCurrency), '']}
                />
                <Legend 
                  verticalAlign="top"
                  height={36}
                  iconType="circle"
                  wrapperStyle={{ fontSize: '11px', fontWeight: 'bold' }}
                />
                <Line 
                  type="monotone" 
                  dataKey="Projected Value" 
                  stroke="hsl(172, 85%, 45%)" 
                  strokeWidth={2.5}
                  dot={{ r: 4, strokeWidth: 0, fill: 'hsl(172, 85%, 45%)' }}
                  activeDot={{ r: 6 }}
                />
                <Line 
                  type="monotone" 
                  dataKey="Required Value" 
                  stroke="hsl(263, 90%, 65%)" 
                  strokeWidth={2}
                  strokeDasharray="4 4"
                  dot={{ r: 3, strokeWidth: 0, fill: 'hsl(263, 90%, 65%)' }}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Aura AI Goal Advisor Section */}
      <div className="glass-panel p-6 border-white/5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/5 pb-4">
          <div className="flex items-center gap-2.5">
            <Sparkles className="w-5 h-5 text-teal-400" />
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-white">Aura AI Goal Advisor</h3>
              <p className="text-xs text-secondary font-mono">Evaluate allocation metrics, rebalancing thresholds & required savings gaps</p>
            </div>
          </div>

          <button
            onClick={handleConsultAi}
            disabled={isAiLoading || !apiKey}
            className={`btn btn-primary py-2 px-4 text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 ${
              !apiKey ? 'opacity-50 cursor-not-allowed' : ''
            }`}
          >
            {isAiLoading ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
            <span>{isAiLoading ? 'Analyzing...' : 'Consult Aura Goal AI'}</span>
          </button>
        </div>

        {!apiKey && (
          <div className="p-3.5 rounded-xl bg-yellow-950/20 border border-yellow-500/20 text-yellow-300 text-xs flex items-center gap-2">
            <HelpCircle className="w-4 h-4 text-yellow-400 shrink-0" />
            <span>Aura AI Advisor key is not active. Please load or save your Gemini API key in the Aura AI Hub tab first.</span>
          </div>
        )}

        {aiError && (
          <div className="p-3.5 rounded-xl bg-red-950/20 border border-red-500/20 text-red-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <span>{aiError}</span>
          </div>
        )}

        {isAiLoading && (
          <div className="py-12 flex flex-col items-center justify-center gap-3 text-center">
            <RefreshCw className="w-8 h-8 text-teal-400 animate-spin" />
            <span className="text-xs text-secondary font-mono animate-pulse">Consulting Gemini to calculate rebalancing plan...</span>
          </div>
        )}

        {!isAiLoading && aiReport && (
          <div className="p-5 rounded-2xl bg-white/[0.01] border border-white/5 text-sm leading-relaxed prose prose-invert max-w-none shadow-glow">
            {/* Display formatted response */}
            <div className="space-y-4 text-secondary">
              {aiReport.split('\n').map((line, idx) => {
                // Formatting bullet points and bold sections
                let cleanLine = line;
                
                // Blockquotes/Alerts styling
                if (line.startsWith('> ')) {
                  return (
                    <blockquote key={idx} className="border-l-4 border-teal-500 pl-4 py-1.5 my-2 text-white italic bg-teal-500/5 rounded-r-xl">
                      {line.substring(2)}
                    </blockquote>
                  );
                }

                // Headers
                if (line.startsWith('### ')) {
                  return <h4 key={idx} className="text-white font-bold text-base mt-4 mb-2">{line.substring(4)}</h4>;
                }
                if (line.startsWith('## ')) {
                  return <h3 key={idx} className="text-teal-400 font-extrabold text-lg mt-5 mb-2 border-b border-white/5 pb-1">{line.substring(3)}</h3>;
                }

                // Parse bold tags
                const boldRegex = /\*\*(.*?)\*\*/g;
                const parts = [];
                let lastIndex = 0;
                let match;
                while ((match = boldRegex.exec(cleanLine)) !== null) {
                  if (match.index > lastIndex) {
                    parts.push(cleanLine.substring(lastIndex, match.index));
                  }
                  parts.push(<strong key={match.index} className="text-white font-semibold">{match[1]}</strong>);
                  lastIndex = boldRegex.lastIndex;
                }
                if (lastIndex < cleanLine.length) {
                  parts.push(cleanLine.substring(lastIndex));
                }

                if (line.startsWith('- ') || line.startsWith('* ')) {
                  return (
                    <div key={idx} className="flex items-start gap-2 pl-4 py-0.5">
                      <span className="text-teal-400 select-none mt-1.5">•</span>
                      <div>{parts.length > 0 ? parts : cleanLine.substring(2)}</div>
                    </div>
                  );
                }

                return <p key={idx} className="my-1.5">{parts.length > 0 ? parts : cleanLine}</p>;
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
