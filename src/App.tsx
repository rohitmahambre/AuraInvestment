import { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AuthPortal } from './components/AuthPortal';
import { DashboardOverview } from './components/DashboardOverview';
import { InvestmentList } from './components/InvestmentList';
import { CSVImporter } from './components/CSVImporter';
import { SharingSettings } from './components/SharingSettings';
import { AuraAdvisor } from './components/AuraAdvisor';
import { MutualFundOverlap } from './components/MutualFundOverlap';
import { GoalPlanner } from './components/GoalPlanner';
import type { Portfolio, Investment, ExchangeRates, InvestmentCurrency } from './types';
import { fetchExchangeRates } from './utils/exchangeRates';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  updateDoc,
  setDoc,
  doc
} from 'firebase/firestore';
import { db } from './firebase';
import { 
  TrendingUp, LayoutDashboard, LineChart, 
  FileSpreadsheet, Users, LogOut, ChevronRight,
  User, RefreshCw, AlertCircle, Plus, Folder,
  Layers, Target
} from 'lucide-react';

function DashboardShell() {
  const { user, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<'overview' | 'investments' | 'import' | 'sharing' | 'overlap' | 'goals'>('overview');
  
  // Portfolios
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [activePortfolio, setActivePortfolio] = useState<Portfolio | null>(null);
  const [portfoliosLoading, setPortfoliosLoading] = useState(true);
  
  // Investments
  const [investments, setInvestments] = useState<Investment[]>([]);
  const [investmentsLoading, setInvestmentsLoading] = useState(false);
  
  // Exchange Rates
  const [rates, setRates] = useState<ExchangeRates | null>(null);
  const [ratesLoading, setRatesLoading] = useState(true);
  const [displayCurrency, setDisplayCurrency] = useState<InvestmentCurrency>('INR');

  const [isCreatePortModalOpen, setIsCreatePortModalOpen] = useState(false);
  const [newPortName, setNewPortName] = useState('');
  const [creatingPort, setCreatingPort] = useState(false);

  // Dynamic Loader States
  const [loadingStep, setLoadingStep] = useState(0);
  const loadingPhrases = [
    "Assembling asset allocations...",
    "Querying live market tickers...",
    "Drawing portfolio variance trajectories...",
    "Syncing estate switches...",
    "Optimizing tracking analytics..."
  ];

  useEffect(() => {
    let interval: any;
    if (portfoliosLoading || ratesLoading || !rates) {
      interval = setInterval(() => {
        setLoadingStep((prev) => (prev + 1) % loadingPhrases.length);
      }, 1600);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [portfoliosLoading, ratesLoading, rates]);

  // 1. Fetch Exchange Rates
  useEffect(() => {
    const getRates = async () => {
      setRatesLoading(true);
      const data = await fetchExchangeRates();
      setRates(data);
      setRatesLoading(false);
    };
    getRates();
  }, []);

  // 2. Sync Owned Portfolios
  useEffect(() => {
    if (!user) return;

    const colRef = collection(db, 'portfolios');
    const q = query(colRef, where('ownerId', '==', user.uid));

    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const list: Portfolio[] = [];
      snapshot.forEach((doc) => {
        list.push(doc.data() as Portfolio);
      });

      // Auto-create a default portfolio if user has absolutely no portfolios owned
      if (list.length === 0) {
        try {
          const newDocRef = doc(colRef);
          const newPortData = {
            id: newDocRef.id,
            name: 'Personal Portfolio',
            ownerId: user.uid,
            ownerEmail: user.email || 'user@example.com',
            sharedWith: [],
            sharedWithEmails: [],
            sharedWithEditors: [],
            createdAt: new Date(),
            updatedAt: new Date()
          };
          await setDoc(newDocRef, newPortData);
        } catch (err) {
          console.error('Failed to create default portfolio', err);
        }
      } else {
        setPortfolios(list);
        // Default active portfolio
        if (!activePortfolio && list.length > 0) {
          setActivePortfolio(list[0]);
        } else if (activePortfolio) {
          // Keep active portfolio reference updated
          const updated = list.find((p) => p.id === activePortfolio.id);
          if (updated) setActivePortfolio(updated);
        }
      }
      setPortfoliosLoading(false);
    });

    return unsubscribe;
  }, [user]);

  // 3. Sync Investments of Active Portfolio
  useEffect(() => {
    if (!activePortfolio) {
      setInvestments([]);
      return;
    }

    setInvestmentsLoading(true);
    const colRef = collection(db, `portfolios/${activePortfolio.id}/investments`);

    const unsubscribe = onSnapshot(colRef, (snapshot) => {
      const list: Investment[] = [];
      snapshot.forEach((doc) => {
        list.push(doc.data() as Investment);
      });
      setInvestments(list);
      setInvestmentsLoading(false);
    }, (error) => {
      console.error('Error fetching investments:', error);
      setInvestments([]);
      setInvestmentsLoading(false);
    });

    return unsubscribe;
  }, [activePortfolio]);

  const handleCreatePortfolio = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPortName.trim() || !user) return;
    setCreatingPort(true);
    try {
      const colRef = collection(db, 'portfolios');
      const newPort = {
        name: newPortName.trim(),
        ownerId: user.uid,
        ownerEmail: user.email || '',
        sharedWith: [],
        sharedWithEmails: [],
        sharedWithEditors: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        id: ''
      };
      const docRef = await addDoc(colRef, newPort);
      await updateDoc(docRef, { id: docRef.id });
      setNewPortName('');
      setIsCreatePortModalOpen(false);
    } catch (err) {
      console.error(err);
      alert('Failed to create portfolio');
    } finally {
      setCreatingPort(false);
    }
  };

  const handleRefreshActivePortfolio = async () => {
    if (!activePortfolio) return;
    // Simple mock refresh or state reload trigger
    setActivePortfolio({ ...activePortfolio });
  };

  // Global Sync Live Prices states and function
  const [syncingPrices, setSyncingPrices] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');

  const handleSyncLivePrices = async () => {
    if (!activePortfolio || investments.length === 0) return;
    setSyncingPrices(true);
    setSyncMessage('Connecting to live feeds...');
    let successCount = 0;
    let failCount = 0;

    try {
      for (const inv of investments) {
        if (inv.type === 'stock' && inv.ticker && inv.units) {
          try {
            setSyncMessage(`Syncing stock: ${inv.name}...`);
            const tickerClean = inv.ticker.trim();
            const res = await fetch(`https://corsproxy.io/?https://query1.finance.yahoo.com/v8/finance/chart/${tickerClean}`);
            if (!res.ok) throw new Error("Yahoo Finance request failed");
            const data = await res.json();
            const price = data.chart.result[0].meta.regularMarketPrice;
            if (typeof price === 'number' && price > 0) {
              const newCurrentVal = inv.units * price;
              const invRef = doc(db, `portfolios/${activePortfolio.id}/investments`, inv.id);
              await updateDoc(invRef, {
                currentValue: parseFloat(newCurrentVal.toFixed(2)),
                updatedAt: new Date()
              });
              successCount++;
            } else {
              failCount++;
            }
          } catch (err) {
            console.error(`Failed to sync stock ${inv.name}:`, err);
            failCount++;
          }
        } else if (inv.type === 'mutual_fund' && inv.schemeCode && inv.units) {
          try {
            setSyncMessage(`Syncing NAV: ${inv.name}...`);
            const res = await fetch(`https://api.mfapi.in/mf/${inv.schemeCode}`);
            if (!res.ok) throw new Error("AMFI NAV API request failed");
            const data = await res.json();
            if (data && data.data && data.data.length > 0) {
              const nav = parseFloat(data.data[0].nav);
              if (!isNaN(nav) && nav > 0) {
                const newCurrentVal = inv.units * nav;
                const invRef = doc(db, `portfolios/${activePortfolio.id}/investments`, inv.id);
                await updateDoc(invRef, {
                  currentValue: parseFloat(newCurrentVal.toFixed(2)),
                  updatedAt: new Date()
                });
                successCount++;
              } else {
                failCount++;
              }
            } else {
              failCount++;
            }
          } catch (err) {
            console.error(`Failed to sync MF ${inv.name}:`, err);
            failCount++;
          }
        }
        // Throttle requests slightly
        await new Promise(r => setTimeout(r, 80));
      }

      setSyncMessage(`Live sync completed. Updated ${successCount} assets. (Failed: ${failCount})`);
      
      if (successCount > 0) {
        import('canvas-confetti').then((confetti) => {
          confetti.default({
            particleCount: 100,
            spread: 70,
            origin: { y: 0.6 }
          });
        });
      }

      setTimeout(() => {
        setSyncMessage('');
        setSyncingPrices(false);
      }, 4000);

    } catch (error) {
      console.error("Sync process failed:", error);
      setSyncMessage('Live synchronization failed.');
      setTimeout(() => {
        setSyncMessage('');
        setSyncingPrices(false);
      }, 4000);
    }
  };

  const canWrite = activePortfolio 
    ? activePortfolio.ownerId === user?.uid || 
      activePortfolio.sharedWith.some(
        (sh) => sh.email.toLowerCase() === user?.email?.toLowerCase() && sh.permission === 'write'
      )
    : false;

  const isShared = activePortfolio ? activePortfolio.ownerId !== user?.uid : false;

  // Master Loader
  if (portfoliosLoading || ratesLoading || !rates) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-base relative overflow-hidden">
        {/* Core Aura Glowing Background Orbs */}
        <div className="absolute w-[350px] h-[350px] rounded-full bg-gradient-to-tr from-teal-500/10 to-indigo-600/10 animate-aura-pulse blur-[60px] -z-10 pointer-events-none"></div>
        <div className="absolute w-[250px] h-[250px] rounded-full bg-teal-400/8 animate-aura-pulse blur-[50px] -z-10 pointer-events-none" style={{ animationDelay: '-2s' }}></div>

        {/* Floating growth particle bubbles */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none -z-5 select-none">
          <span className="absolute left-[35%] bottom-[20%] text-teal-400/40 font-bold text-lg animate-aura-float-1">+</span>
          <span className="absolute left-[45%] bottom-[15%] text-teal-500/30 font-bold text-sm animate-aura-float-2">$</span>
          <span className="absolute right-[38%] bottom-[25%] text-emerald-400/40 font-bold text-xl animate-aura-float-3">%</span>
          <span className="absolute right-[46%] bottom-[10%] text-teal-400/25 font-bold text-base animate-aura-float-1" style={{ animationDelay: '-1.5s' }}>+</span>
          <span className="absolute left-[52%] bottom-[30%] text-indigo-400/30 font-bold text-sm animate-aura-float-2" style={{ animationDelay: '-0.8s' }}>$</span>
        </div>

        {/* Loader Container */}
        <div className="flex flex-col items-center text-center gap-8 z-10 px-6">
          {/* Growing Line Chart SVG */}
          <div className="relative flex items-center justify-center p-6 bg-surface-solid/40 border border-light rounded-3xl shadow-glow">
            <svg width="220" height="120" viewBox="0 0 200 120" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-56 h-32 overflow-visible">
              {/* Faint Grid Lines */}
              <line x1="10" y1="100" x2="190" y2="100" stroke="rgba(255,255,255,0.03)" strokeWidth="1" strokeDasharray="4 4" />
              <line x1="10" y1="70" x2="190" y2="70" stroke="rgba(255,255,255,0.03)" strokeWidth="1" strokeDasharray="4 4" />
              <line x1="10" y1="40" x2="190" y2="40" stroke="rgba(255,255,255,0.03)" strokeWidth="1" strokeDasharray="4 4" />
              <line x1="10" y1="10" x2="190" y2="10" stroke="rgba(255,255,255,0.03)" strokeWidth="1" strokeDasharray="4 4" />
              
              <defs>
                {/* Main Curve Gradient */}
                <linearGradient id="chart-grad" x1="0" y1="120" x2="200" y2="0" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="hsl(263, 90%, 65%)" />
                  <stop offset="50%" stopColor="hsl(172, 85%, 45%)" />
                  <stop offset="100%" stopColor="hsl(45, 95%, 60%)" />
                </linearGradient>
                {/* Area Under Curve Fill Gradient */}
                <linearGradient id="area-grad" x1="0" y1="0" x2="0" y2="120" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="rgba(172, 85%, 45%, 0.12)" />
                  <stop offset="100%" stopColor="rgba(172, 85%, 45%, 0)" />
                </linearGradient>
              </defs>

              {/* Area Under Curve (Fade in/out) */}
              <path d="M 10 100 Q 50 90, 80 60 T 150 40 T 190 15 L 190 100 Z" fill="url(#area-grad)" className="animate-aura-area" />

              {/* The Drawing Chart Curve */}
              <path d="M 10 100 Q 50 90, 80 60 T 150 40 T 190 15" stroke="url(#chart-grad)" strokeWidth="3" strokeLinecap="round" className="animate-aura-draw-line" />

              {/* Pulse at peak */}
              <circle cx="190" cy="15" r="4" fill="hsl(45, 95%, 60%)" className="animate-aura-tip-glow" />
              <circle cx="190" cy="15" r="10" stroke="hsl(45, 95%, 60%)" strokeWidth="1.5" className="animate-aura-tip-pulse" />
            </svg>
          </div>

          {/* Typography & Phased Status Messages */}
          <div className="space-y-3">
            <h1 className="text-3xl font-extrabold tracking-widest uppercase">
              <span className="gradient-text">AURA</span>
            </h1>
            
            {/* Dynamic Loading Phrase */}
            <div className="h-6 flex items-center justify-center">
              <p className="text-secondary text-sm font-semibold tracking-wider font-mono animate-pulse">
                {loadingPhrases[loadingStep]}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header Bar */}
      <header className="glass-panel rounded-none border-t-0 border-x-0 sticky top-0 z-40 bg-black/40 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-teal-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-teal-500/10">
            <TrendingUp className="w-5 h-5 text-black" />
          </div>
          <span className="font-extrabold text-lg tracking-tight">
            <span className="gradient-text">AURA</span> Tracker
          </span>
        </div>

        {/* User profile and logout */}
        <div className="flex items-center gap-3 sm:gap-4">
          {activePortfolio && investments.length > 0 && canWrite && (
            <button
              onClick={handleSyncLivePrices}
              disabled={syncingPrices}
              className="btn btn-secondary py-1.5 px-3 text-xs flex items-center gap-1.5 border-teal-500/20 text-teal-400 hover:border-teal-500/50 hover:bg-teal-500/5"
              title="Sync live valuations for stocks and mutual funds"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncingPrices ? 'animate-spin' : ''}`} />
              <span className="hidden md:inline">{syncingPrices ? 'Syncing...' : 'Sync Live Prices'}</span>
            </button>
          )}
          <div className="hidden sm:flex items-center gap-2 bg-white/5 border border-white/5 py-1.5 px-3 rounded-xl">
            <User className="w-4 h-4 text-teal-400" />
            <span className="text-xs font-semibold text-white">{user?.displayName || user?.email}</span>
          </div>
          <button 
            onClick={logout} 
            className="btn btn-secondary py-1.5 px-3 flex items-center gap-1.5 text-xs text-red-400 border-red-500/20 hover:bg-red-500/10"
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden sm:inline">Logout</span>
          </button>
        </div>
      </header>

      {/* Main Body Layout */}
      <div className="flex-grow flex flex-col lg:flex-row">
        {/* Sidebar / Left Navigation */}
        <aside className="w-full lg:w-[280px] bg-black/20 border-r border-white/5 p-6 space-y-6 flex-shrink-0">
          
          {/* Portfolio Management Selector */}
          <div className="space-y-2">
            <label className="text-[10px] font-bold text-secondary uppercase tracking-widest">Active Workspace</label>
            <div className="space-y-2">
              <select
                value={activePortfolio?.id || ''}
                onChange={(e) => {
                  const selected = portfolios.find((p) => p.id === e.target.value);
                  if (selected) setActivePortfolio(selected);
                }}
                className="py-2.5 px-3 text-xs w-full bg-[#0d0d12]"
              >
                {activePortfolio === null && (
                  <option value="" disabled>-- Select Portfolio --</option>
                )}
                {portfolios.map((port) => (
                  <option key={port.id} value={port.id}>
                    📁 {port.name}
                  </option>
                ))}
              </select>

              <button 
                onClick={() => setIsCreatePortModalOpen(true)}
                className="w-full btn btn-secondary text-xs py-2 border-dashed border-white/10 hover:border-teal-500/30 flex items-center justify-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                Create Portfolio
              </button>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="space-y-1.5">
            <label className="text-[10px] font-bold text-secondary uppercase tracking-widest block mb-2">Navigation</label>
            
            <button
              onClick={() => {
                console.log("Tab clicked: overview");
                setActiveTab('overview');
              }}
              className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-semibold transition-all duration-200 ${
                activeTab === 'overview'
                  ? 'bg-teal-500/10 text-teal-400 border-l-2 border-teal-500'
                  : 'text-secondary hover:text-white hover:bg-white/5'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <LayoutDashboard className="w-4 h-4" />
                Dashboard
              </span>
              <ChevronRight className="w-3.5 h-3.5 opacity-60" />
            </button>

            <button
              onClick={() => {
                console.log("Tab clicked: investments");
                setActiveTab('investments');
              }}
              className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-semibold transition-all duration-200 ${
                activeTab === 'investments'
                  ? 'bg-teal-500/10 text-teal-400 border-l-2 border-teal-500'
                  : 'text-secondary hover:text-white hover:bg-white/5'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <LineChart className="w-4 h-4" />
                Investments
              </span>
              <ChevronRight className="w-3.5 h-3.5 opacity-60" />
            </button>

            <button
              onClick={() => {
                console.log("Tab clicked: overlap");
                setActiveTab('overlap');
              }}
              className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-semibold transition-all duration-200 ${
                activeTab === 'overlap'
                  ? 'bg-teal-500/10 text-teal-400 border-l-2 border-teal-500'
                  : 'text-secondary hover:text-white hover:bg-white/5'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <Layers className="w-4 h-4" />
                MF Overlap
              </span>
              <ChevronRight className="w-3.5 h-3.5 opacity-60" />
            </button>

            <button
              onClick={() => {
                console.log("Tab clicked: goals");
                setActiveTab('goals');
              }}
              className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-semibold transition-all duration-200 ${
                activeTab === 'goals'
                  ? 'bg-teal-500/10 text-teal-400 border-l-2 border-teal-500'
                  : 'text-secondary hover:text-white hover:bg-white/5'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <Target className="w-4 h-4" />
                Goal Planner
              </span>
              <ChevronRight className="w-3.5 h-3.5 opacity-60" />
            </button>

            <button
              onClick={() => {
                console.log("Tab clicked: import");
                setActiveTab('import');
              }}
              className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-semibold transition-all duration-200 ${
                activeTab === 'import'
                  ? 'bg-teal-500/10 text-teal-400 border-l-2 border-teal-500'
                  : 'text-secondary hover:text-white hover:bg-white/5'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <FileSpreadsheet className="w-4 h-4" />
                CSV Importer
              </span>
              <ChevronRight className="w-3.5 h-3.5 opacity-60" />
            </button>

            <button
              onClick={() => {
                console.log("Tab clicked: sharing");
                setActiveTab('sharing');
              }}
              className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-semibold transition-all duration-200 ${
                activeTab === 'sharing'
                  ? 'bg-teal-500/10 text-teal-400 border-l-2 border-teal-500'
                  : 'text-secondary hover:text-white hover:bg-white/5'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <Users className="w-4 h-4" />
                Access Control
              </span>
              <ChevronRight className="w-3.5 h-3.5 opacity-60" />
            </button>
          </nav>
        </aside>

        {/* Dynamic Content Viewport */}
        <main className="flex-grow p-6 sm:p-8 space-y-6 overflow-y-auto">
          {/* Global sync status banner */}
          {syncMessage && (
            <div className="p-3.5 rounded-xl bg-teal-950/30 border border-teal-500/20 text-teal-300 text-xs flex items-center gap-2.5 animate-pulse shrink-0">
              <RefreshCw className="w-4 h-4 animate-spin text-teal-400 shrink-0" />
              <span>{syncMessage}</span>
            </div>
          )}

          {/* Read-only notification banner */}
          {activePortfolio && isShared && (
            <div className="p-3.5 rounded-xl bg-indigo-950/20 border border-indigo-500/20 text-indigo-300 text-xs flex items-center justify-between gap-3 animate-fade-in">
              <div className="flex items-center gap-2">
                <Folder className="w-4 h-4 text-indigo-400 shrink-0" />
                <span>
                  You are viewing <strong>{activePortfolio.name}</strong> shared by <strong>{activePortfolio.ownerEmail}</strong>. 
                  ({canWrite ? 'Read & Write Access' : 'Read-Only Access'})
                </span>
              </div>
            </div>
          )}

          {activeTab === 'overview' && (
            investmentsLoading ? (
              <div className="h-[400px] flex flex-col items-center justify-center gap-3">
                <RefreshCw className="w-8 h-8 text-teal-400 animate-spin" />
                <span className="text-xs text-secondary font-mono">Syncing portfolio ledger...</span>
              </div>
            ) : (
              <DashboardOverview
                investments={investments}
                rates={rates}
                displayCurrency={displayCurrency}
                setDisplayCurrency={setDisplayCurrency}
              />
            )
          )}

          {activeTab === 'investments' && (
            activePortfolio ? (
              investmentsLoading ? (
                <div className="h-[400px] flex flex-col items-center justify-center gap-3">
                  <RefreshCw className="w-8 h-8 text-teal-400 animate-spin" />
                  <span className="text-xs text-secondary font-mono">Syncing portfolio ledger...</span>
                </div>
              ) : (
                <InvestmentList
                  portfolioId={activePortfolio.id}
                  investments={investments}
                  rates={rates}
                  displayCurrency={displayCurrency}
                  canWrite={canWrite}
                  syncingPrices={syncingPrices}
                  syncMessage={syncMessage}
                  onSyncLivePrices={handleSyncLivePrices}
                />
              )
            ) : (
              <div className="glass-panel p-12 text-center flex flex-col items-center justify-center">
                <AlertCircle className="w-16 h-16 text-yellow-500/60 mb-4" />
                <h3 className="text-xl font-bold mb-2">No Active Portfolio</h3>
                <p className="text-secondary max-w-sm">
                  Please select or create a portfolio from the sidebar workspace selector to view investments.
                </p>
              </div>
            )
          )}

          {activeTab === 'import' && (
            activePortfolio ? (
              canWrite ? (
                <CSVImporter
                  portfolioId={activePortfolio.id}
                  onImportSuccess={() => setActiveTab('investments')}
                />
              ) : (
                <div className="glass-panel p-12 text-center flex flex-col items-center justify-center">
                  <AlertCircle className="w-16 h-16 text-yellow-500/60 mb-4" />
                  <h3 className="text-xl font-bold mb-2">Access Denied</h3>
                  <p className="text-secondary max-w-sm">
                    You have read-only access to this portfolio. You cannot import new investments.
                  </p>
                </div>
              )
            ) : (
              <div className="glass-panel p-12 text-center flex flex-col items-center justify-center">
                <AlertCircle className="w-16 h-16 text-yellow-500/60 mb-4" />
                <h3 className="text-xl font-bold mb-2">No Active Portfolio</h3>
                <p className="text-secondary max-w-sm">
                  Please select or create a portfolio from the sidebar workspace selector to import data.
                </p>
              </div>
            )
          )}

          {activeTab === 'sharing' && (
            <SharingSettings
              activePortfolio={activePortfolio}
              onRefreshPortfolio={handleRefreshActivePortfolio}
              onSelectPortfolio={(port) => {
                // Inject shared portfolio in the portfolios list so selector can identify it
                if (!portfolios.some((p) => p.id === port.id)) {
                  setPortfolios([...portfolios, port]);
                }
                setActivePortfolio(port);
                setActiveTab('overview');
              }}
            />
          )}

          {activeTab === 'overlap' && (
            <MutualFundOverlap
              investments={investments}
              rates={rates}
              displayCurrency={displayCurrency}
            />
          )}

          {activeTab === 'goals' && (
            activePortfolio ? (
              <GoalPlanner
                portfolioId={activePortfolio.id}
                investments={investments}
                rates={rates}
                user={user}
                canWrite={canWrite}
              />
            ) : (
              <div className="glass-panel p-12 text-center flex flex-col items-center justify-center">
                <AlertCircle className="w-16 h-16 text-yellow-500/60 mb-4" />
                <h3 className="text-xl font-bold mb-2">No Active Portfolio</h3>
                <p className="text-secondary max-w-sm">
                  Please select or create a portfolio from the sidebar workspace selector to configure goals.
                </p>
              </div>
            )
          )}
        </main>
      </div>

      {/* Create Portfolio Modal */}
      {isCreatePortModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="glass-panel w-full max-w-md p-6 border-white/10 animate-fade-in">
            <h3 className="text-lg font-bold mb-4">Create New Portfolio</h3>
            <form onSubmit={handleCreatePortfolio} className="space-y-4">
              <div>
                <label>Portfolio Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Europe Assets, India Long Term"
                  value={newPortName}
                  onChange={(e) => setNewPortName(e.target.value)}
                  disabled={creatingPort}
                />
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setIsCreatePortModalOpen(false)}
                  className="btn btn-secondary"
                  disabled={creatingPort}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={creatingPort}
                >
                  {creatingPort ? 'Creating...' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {rates && (
        <AuraAdvisor 
          investments={investments} 
          rates={rates} 
          displayCurrency={displayCurrency} 
        />
      )}
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AuthContextConsumer />
    </AuthProvider>
  );
}

function AuthContextConsumer() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-base">
        <div className="w-12 h-12 border-4 border-teal-500 border-t-transparent rounded-full animate-spin"></div>
        <p className="text-secondary text-sm font-semibold tracking-wider uppercase">Initializing auth handshake...</p>
      </div>
    );
  }

  return user ? <DashboardShell /> : <AuthPortal />;
}
