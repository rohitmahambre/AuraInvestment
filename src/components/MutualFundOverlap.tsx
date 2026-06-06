import React, { useState, useEffect } from 'react';
import type { Investment, ExchangeRates, InvestmentCurrency } from '../types';
import { convertCurrency, formatCurrency } from '../utils/exchangeRates';
import { 
  Layers, AlertCircle, RefreshCw, Info, Search, Cpu, Sparkles, X
} from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';

interface MutualFundOverlapProps {
  investments: Investment[];
  rates: ExchangeRates;
  displayCurrency: InvestmentCurrency;
}

interface FundHolding {
  name: string;
  sector?: string;
  weightage: number; // Parsed as float
  marketValue?: string;
}

interface FetchedFundData {
  schemeCode: string;
  schemeName: string;
  holdings: FundHolding[];
}

interface OverlapItem {
  name: string;
  sector: string;
  weight1: number; // weight in fund/portfolio 1
  weight2: number; // weight in fund 2
  overlap: number; // min(weight1, weight2)
}

interface SearchResult {
  schemeCode: number;
  schemeName: string;
}

export const MutualFundOverlap: React.FC<MutualFundOverlapProps> = ({
  investments,
  rates,
  displayCurrency
}) => {
  const { user } = useAuth();

  // Filter investments of type mutual_fund that have schemeCode
  const mutualFunds = investments.filter(
    (inv) => inv.type === 'mutual_fund' && inv.schemeCode
  );

  // Group unique funds in case the portfolio has duplicate entries for the same scheme
  const uniqueFundsMap = new Map<number, Investment>();
  mutualFunds.forEach((mf) => {
    if (mf.schemeCode) {
      uniqueFundsMap.set(mf.schemeCode, mf);
    }
  });
  const uniqueFunds = Array.from(uniqueFundsMap.values());

  // Navigation Sub-tabs
  const [activeSubTab, setActiveSubTab] = useState<'matrix' | 'twoway' | 'newfund'>('matrix');

  // API Key & Gemini Client States
  const [apiKey, setApiKey] = useState<string>('');
  const [aiReport, setAiReport] = useState<string>('');
  const [generatingReport, setGeneratingReport] = useState<boolean>(false);

  // Tab 1: Portfolio Overview & Pairwise Matrix States
  const [matrixLoading, setMatrixLoading] = useState<boolean>(false);
  const [matrixError, setMatrixError] = useState<string | null>(null);
  const [allFetchedFunds, setAllFetchedFunds] = useState<Map<string, FetchedFundData>>(new Map());
  const [failedFunds, setFailedFunds] = useState<{ name: string; code: string }[]>([]);

  // Tab 2: Compare Two Funds States
  const [fund1Code, setFund1Code] = useState<string>('');
  const [fund2Code, setFund2Code] = useState<string>('');
  const [twoWayLoading, setTwoWayLoading] = useState<boolean>(false);
  const [twoWayError, setTwoWayError] = useState<string | null>(null);
  const [twoWayResult, setTwoWayResult] = useState<{
    overlap: number;
    shared: OverlapItem[];
    unique1: FundHolding[];
    unique2: FundHolding[];
    sectors: { sector: string; weight1: number; weight2: number; diff: number }[];
    name1: string;
    name2: string;
  } | null>(null);

  // Tab 3: Analyze a New Fund States
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchingSchemes, setSearchingSchemes] = useState<boolean>(false);
  const [selectedNewFund, setSelectedNewFund] = useState<SearchResult | null>(null);
  const [newFundLoading, setNewFundLoading] = useState<boolean>(false);
  const [newFundError, setNewFundError] = useState<string | null>(null);
  const [compareTarget, setCompareTarget] = useState<'portfolio' | string>('portfolio'); // 'portfolio' or single schemeCode
  const [newFundResult, setNewFundResult] = useState<{
    overlap: number;
    shared: OverlapItem[];
    uniquePortfolio: FundHolding[];
    uniqueNewFund: FundHolding[];
    sectors: { sector: string; weightPortfolio: number; weightNewFund: number; diff: number }[];
    targetName: string;
    newFundName: string;
  } | null>(null);

  // 1. Resolve API Key on mount
  useEffect(() => {
    const loadKey = async () => {
      const email = user?.email?.toLowerCase();
      if (email !== 'admin@example.com' && email !== 'demo@melavo.com') {
        return;
      }

      // 1. Try local dev environment variable first (owner only)
      if (email === 'admin@example.com') {
        const envKey = (import.meta.env.VITE_GEMINI_API_KEY as string) || '';
        if (envKey) {
          setApiKey(envKey);
          return;
        }
      }

      // 2. Try fetching securely from Firestore secrets document (for deployed app)
      try {
        const docName = email === 'admin@example.com' ? 'gemini' : 'demo_gemini';
        const secretDocRef = doc(db, 'secrets', docName);
        const secretSnap = await getDoc(secretDocRef);
        if (secretSnap.exists()) {
          const keyData = secretSnap.data().key;
          if (keyData) {
            setApiKey(keyData);
            return;
          }
        }
      } catch (err) {
        console.warn("Could not read secure key from Firestore.", err);
      }

      // 3. Fall back to local storage (owner only)
      if (email === 'admin@example.com') {
        const savedKey = localStorage.getItem('gemini_api_key') || '';
        if (savedKey) {
          setApiKey(savedKey);
        }
      }
    };
    loadKey();
  }, [user]);

  // 2. Fetch holdings for all unique funds in parallel on load/activeSubTab changes
  useEffect(() => {
    if (uniqueFunds.length < 2) return;

    const loadAllHoldings = async () => {
      setMatrixLoading(true);
      setMatrixError(null);
      setFailedFunds([]);
      
      const fetchedMap = new Map<string, FetchedFundData>();
      const failed: { name: string; code: string }[] = [];
      try {
        const batchSize = 6;
        for (let i = 0; i < uniqueFunds.length; i += batchSize) {
          const batch = uniqueFunds.slice(i, i + batchSize);
          await Promise.all(
            batch.map(async (fund) => {
              if (!fund.schemeCode) return;
              const codeStr = fund.schemeCode.toString();
              
              if (allFetchedFunds.has(codeStr)) {
                fetchedMap.set(codeStr, allFetchedFunds.get(codeStr)!);
                return;
              }
              
              try {
                const data = await fetchFundDetails(codeStr);
                fetchedMap.set(codeStr, data);
              } catch (err) {
                console.warn(`Failed to fetch holdings for fund ${fund.name} (Code: ${codeStr}):`, err);
                failed.push({ name: fund.name, code: codeStr });
              }
            })
          );
          if (i + batchSize < uniqueFunds.length) {
            await new Promise((r) => setTimeout(r, 80)); // Throttle slightly
          }
        }

        setAllFetchedFunds((prev) => {
          const copy = new Map(prev);
          fetchedMap.forEach((val, key) => copy.set(key, val));
          return copy;
        });
        setFailedFunds(failed);

        if (fetchedMap.size === 0 && uniqueFunds.length > 0) {
          setMatrixError("Could not retrieve stock portfolios for any of your mutual funds. Please check your network connection or verify AMFI codes.");
        }
      } catch (err: any) {
        console.error("Error loading portfolio holdings:", err);
        setMatrixError("An unexpected error occurred while compiling mutual fund holdings.");
      } finally {
        setMatrixLoading(false);
      }
    };

    loadAllHoldings();
  }, [investments, activeSubTab === 'matrix']);

  // 3. Debounced autocomplete search index for Tab 3
  useEffect(() => {
    if (!searchQuery.trim() || searchQuery.length < 3) {
      setSearchResults([]);
      return;
    }
    setSearchingSchemes(true);
    const delay = setTimeout(async () => {
      try {
        const res = await fetch(`https://api.mfapi.in/mf/search?q=${searchQuery}`);
        if (res.ok) {
          const data = await res.json();
          setSearchResults(data.slice(0, 10)); // Limit to top 10
        }
      } catch (err) {
        console.error("Failed to search schemes:", err);
      } finally {
        setSearchingSchemes(false);
      }
    }, 400);

    return () => clearTimeout(delay);
  }, [searchQuery]);

  // Helper to fetch details from FinAPI
  const fetchFundDetails = async (schemeCode: string): Promise<FetchedFundData> => {
    const response = await fetch(
      `https://finapi.upvaly.com/api/mf/scheme-code/${schemeCode}?fields=holdings`
    );
    if (!response.ok) {
      throw new Error(`Failed to fetch holdings for scheme: ${schemeCode}`);
    }
    const result = await response.json();
    if (result.status !== 'success' || !result.data) {
      throw new Error(result.message || 'Failed to fetch fund information');
    }

    const rawHoldings = result.data.holdings || [];
    const parsedHoldings: FundHolding[] = rawHoldings.map((h: any) => ({
      name: h.name || 'Unknown Asset',
      sector: h.sector || 'Other / Cash Equivalent',
      weightage: parseFloat(h.weightage) || 0,
      marketValue: h.marketValue
    }));

    return {
      schemeCode,
      schemeName: result.data.schemeName || 'Unknown Scheme',
      holdings: parsedHoldings
    };
  };

  // Helper to calculate overlap details between two funds
  const runTwoFundOverlapMath = (f1: FetchedFundData, f2: FetchedFundData) => {
    const map1 = new Map<string, FundHolding>();
    const map2 = new Map<string, FundHolding>();

    f1.holdings.forEach((h) => map1.set(h.name.toLowerCase().trim(), h));
    f2.holdings.forEach((h) => map2.set(h.name.toLowerCase().trim(), h));

    const overlappingItems: OverlapItem[] = [];
    const uniqueItems1: FundHolding[] = [];
    const uniqueItems2: FundHolding[] = [];

    f1.holdings.forEach((h) => {
      const key = h.name.toLowerCase().trim();
      const match = map2.get(key);
      if (match) {
        overlappingItems.push({
          name: h.name,
          sector: h.sector || 'Other',
          weight1: h.weightage,
          weight2: match.weightage,
          overlap: Math.min(h.weightage, match.weightage)
        });
      } else {
        uniqueItems1.push(h);
      }
    });

    f2.holdings.forEach((h) => {
      const key = h.name.toLowerCase().trim();
      if (!map1.has(key)) {
        uniqueItems2.push(h);
      }
    });

    const totalOverlap = overlappingItems.reduce((sum, item) => sum + item.overlap, 0);

    overlappingItems.sort((a, b) => b.overlap - a.overlap);
    uniqueItems1.sort((a, b) => b.weightage - a.weightage);
    uniqueItems2.sort((a, b) => b.weightage - a.weightage);

    // Sectors exposure
    const sectorWeights1: Record<string, number> = {};
    const sectorWeights2: Record<string, number> = {};
    f1.holdings.forEach((h) => {
      const s = h.sector || 'Other / Cash Equivalent';
      sectorWeights1[s] = (sectorWeights1[s] || 0) + h.weightage;
    });
    f2.holdings.forEach((h) => {
      const s = h.sector || 'Other / Cash Equivalent';
      sectorWeights2[s] = (sectorWeights2[s] || 0) + h.weightage;
    });

    const allSectors = Array.from(new Set([...Object.keys(sectorWeights1), ...Object.keys(sectorWeights2)]));
    const sectorsList = allSectors.map((sector) => {
      const w1 = sectorWeights1[sector] || 0;
      const w2 = sectorWeights2[sector] || 0;
      return { sector, weight1: w1, weight2: w2, diff: Math.abs(w1 - w2) };
    });
    sectorsList.sort((a, b) => (b.weight1 + b.weight2) - (a.weight1 + a.weight2));

    return {
      overlap: totalOverlap,
      shared: overlappingItems,
      unique1: uniqueItems1,
      unique2: uniqueItems2,
      sectors: sectorsList,
      name1: f1.schemeName,
      name2: f2.schemeName
    };
  };

  // Tab 2 Action: Compare Selected Local Funds
  const handleCompareTwoFunds = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fund1Code || !fund2Code) {
      setTwoWayError('Please select two different mutual funds.');
      return;
    }
    if (fund1Code === fund2Code) {
      setTwoWayError('Please select two different mutual funds. You cannot compare a fund with itself.');
      return;
    }

    setTwoWayLoading(true);
    setTwoWayError(null);
    setTwoWayResult(null);

    try {
      let data1 = allFetchedFunds.get(fund1Code);
      let data2 = allFetchedFunds.get(fund2Code);

      if (!data1) data1 = await fetchFundDetails(fund1Code);
      if (!data2) data2 = await fetchFundDetails(fund2Code);

      // Cache
      setAllFetchedFunds(prev => {
        const copy = new Map(prev);
        copy.set(fund1Code, data1!);
        copy.set(fund2Code, data2!);
        return copy;
      });

      const res = runTwoFundOverlapMath(data1!, data2!);
      setTwoWayResult(res);
    } catch (err: any) {
      console.error(err);
      setTwoWayError(err.message || 'An error occurred during comparison.');
    } finally {
      setTwoWayLoading(false);
    }
  };

  // Tab 3 Action: Compare New external Fund with Portfolio/Single Fund
  const handleCompareNewFund = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedNewFund) return;

    setNewFundLoading(true);
    setNewFundError(null);
    setNewFundResult(null);

    try {
      // Fetch external fund holdings
      const newFundData = await fetchFundDetails(selectedNewFund.schemeCode.toString());

      if (compareTarget === 'portfolio') {
        // 1. Calculate valuation weights for all funds in the portfolio
        let totalValuation = 0;
        const localValuations = uniqueFunds.map((fund) => {
          const val = convertCurrency(fund.currentValue, fund.currency, displayCurrency, rates);
          totalValuation += val;
          return { schemeCode: fund.schemeCode!.toString(), valuation: val };
        });

        if (totalValuation === 0) {
          throw new Error("Cannot compare with portfolio: total portfolio valuation is 0. Please update investment values first.");
        }

        // 2. Fetch all missing holdings in the portfolio to make sure we have complete data
        const portfolioFetchedData: FetchedFundData[] = [];
        for (const val of localValuations) {
          let data = allFetchedFunds.get(val.schemeCode);
          if (!data) {
            data = await fetchFundDetails(val.schemeCode);
            setAllFetchedFunds(prev => {
              const copy = new Map(prev);
              copy.set(val.schemeCode, data!);
              return copy;
            });
          }
          portfolioFetchedData.push(data);
        }

        // 3. Compile aggregate portfolio weighted holdings list
        const aggregatedHoldingsMap = new Map<string, { name: string; sector: string; weight: number }>();
        localValuations.forEach((val, idx) => {
          const weightFactor = val.valuation / totalValuation;
          const fundData = portfolioFetchedData[idx];

          fundData.holdings.forEach((h) => {
            const key = h.name.toLowerCase().trim();
            const exist = aggregatedHoldingsMap.get(key);
            const wContribution = h.weightage * weightFactor;

            if (exist) {
              exist.weight += wContribution;
            } else {
              aggregatedHoldingsMap.set(key, {
                name: h.name,
                sector: h.sector || 'Other',
                weight: wContribution
              });
            }
          });
        });

        const aggregatedHoldings = Array.from(aggregatedHoldingsMap.values()).map((h) => ({
          name: h.name,
          sector: h.sector,
          weightage: h.weight
        }));

        // 4. Run overlap math (Aggregated Portfolio vs. New Fund)
        const mockPortfolioData: FetchedFundData = {
          schemeCode: 'portfolio',
          schemeName: 'My Mutual Fund Portfolio (Aggregate)',
          holdings: aggregatedHoldings
        };

        const res = runTwoFundOverlapMath(mockPortfolioData, newFundData);

        setNewFundResult({
          overlap: res.overlap,
          shared: res.shared,
          uniquePortfolio: res.unique1,
          uniqueNewFund: res.unique2,
          sectors: res.sectors.map((s) => ({
            sector: s.sector,
            weightPortfolio: s.weight1,
            weightNewFund: s.weight2,
            diff: s.diff
          })),
          targetName: 'My Portfolio (Aggregate)',
          newFundName: newFundData.schemeName
        });
      } else {
        // Compare with a selected individual fund
        let targetData = allFetchedFunds.get(compareTarget);
        if (!targetData) targetData = await fetchFundDetails(compareTarget);

        const res = runTwoFundOverlapMath(targetData, newFundData);

        setNewFundResult({
          overlap: res.overlap,
          shared: res.shared,
          uniquePortfolio: res.unique1,
          uniqueNewFund: res.unique2,
          sectors: res.sectors.map((s) => ({
            sector: s.sector,
            weightPortfolio: s.weight1,
            weightNewFund: s.weight2,
            diff: s.diff
          })),
          targetName: targetData.schemeName,
          newFundName: newFundData.schemeName
        });
      }
    } catch (err: any) {
      console.error(err);
      setNewFundError(err.message || 'An error occurred during new fund comparison.');
    } finally {
      setNewFundLoading(false);
    }
  };

  // Tab 1: Calculate matrix grid
  const getMatrixGrid = () => {
    // Filter uniqueFunds to only include those that successfully loaded in allFetchedFunds
    const loadedFunds = uniqueFunds.filter(
      (f) => f.schemeCode && allFetchedFunds.has(f.schemeCode.toString())
    );

    if (loadedFunds.length < 2) return null;
    const codes = loadedFunds.map(f => f.schemeCode!.toString());
    const names = loadedFunds.map(f => f.name);

    // Compute pairwise matrix
    const matrix: (number | null)[][] = Array(codes.length).fill(null).map(() => Array(codes.length).fill(null));

    for (let i = 0; i < codes.length; i++) {
      for (let j = 0; j < codes.length; j++) {
        if (i === j) {
          matrix[i][j] = 100; // Self-overlap is 100%
        } else {
          const f1 = allFetchedFunds.get(codes[i]);
          const f2 = allFetchedFunds.get(codes[j]);
          if (f1 && f2) {
            const math = runTwoFundOverlapMath(f1, f2);
            matrix[i][j] = math.overlap;
          }
        }
      }
    }

    return { names, codes, matrix };
  };

  const matrixInfo = getMatrixGrid();

  // Tab 1 Action: Ask Gemini for Rebalancing Advice
  const handleAskAuraAdvice = async () => {
    if (!apiKey) {
      setAiReport("### Missing API Key\n\nPlease enter a Gemini API Key in the settings panel (via the Sparkles floating button on the bottom-right/left) to generate advisor insights.");
      return;
    }
    if (!matrixInfo) return;

    setGeneratingReport(true);
    setAiReport('');

    try {
      // Compile high overlap info
      const highOverlapList: string[] = [];
      const { names, matrix } = matrixInfo;
      
      for (let i = 0; i < names.length; i++) {
        for (let j = i + 1; j < names.length; j++) {
          const score = matrix[i][j];
          if (score !== null && score > 20) {
            highOverlapList.push(`- **${names[i]}** and **${names[j]}** have a **${score.toFixed(1)}%** portfolio overlap.`);
          }
        }
      }

      // Compile detailed allocations
      const portfolioValuations = uniqueFunds.map((fund) => {
        const val = convertCurrency(fund.currentValue, fund.currency, displayCurrency, rates);
        return `- ${fund.name} (${fund.institution}): Valuation: ${formatCurrency(val, displayCurrency)} (AMFI code: ${fund.schemeCode})`;
      }).join('\n');

      const systemPrompt = `You are Aura, an elite personal AI financial advisor. 
Analyze the user's mutual fund overlaps, diversification metrics, and concentration risk, and offer clear, professional, and actionable rebalancing strategies.
Always act as a senior wealth advisor and conclude with a standard disclaimer.`;

      const prompt = `Here is my current mutual fund portfolio breakdown:
${portfolioValuations}

Pairwise Overlap Analysis:
${highOverlapList.length === 0 ? "No pairs have significant (>20%) overlap." : highOverlapList.join('\n')}

Please evaluate this portfolio and provide:
1. **Hidden Risk Evaluation**: Which funds are redundant? Are there overlapping stock exposures?
2. **Rebalancing Action Plan**: Suggest 2-3 specific actions to diversify (e.g. merging redundant funds, reallocating to index/mid-cap funds, etc.).
3. **Optimized Target Allocations**: How should the weightages be distributed?

Keep the advice concise, professional, and structured in markdown.`;

      const modelName = "gemini-2.5-flash";
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          systemInstruction: { parts: [{ text: systemPrompt }] }
        })
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData?.error?.message || 'Gemini API call failed');
      }

      const data = await response.json();
      const text = data.candidates[0].content.parts[0].text;
      setAiReport(text);
    } catch (err: any) {
      console.error(err);
      setAiReport(`### Advisor Error\n\nFailed to compile advice: ${err.message || 'Check your Gemini key or network connection.'}`);
    } finally {
      setGeneratingReport(false);
    }
  };

  // Helper parser for markdown
  const parseMarkdownToReact = (text: string) => {
    return text.split('\n').map((line, idx) => {
      let cleanLine = line.trim();
      if (cleanLine.startsWith('###')) {
        return <h5 key={idx} className="text-sm font-bold text-white mt-4 mb-2">{cleanLine.replace('###', '').trim()}</h5>;
      }
      if (cleanLine.startsWith('##')) {
        return <h4 key={idx} className="text-base font-extrabold text-teal-400 mt-5 mb-2">{cleanLine.replace('##', '').trim()}</h4>;
      }
      if (cleanLine.startsWith('#')) {
        return <h3 key={idx} className="text-lg font-black text-teal-400 mt-6 mb-3">{cleanLine.replace('#', '').trim()}</h3>;
      }
      if (cleanLine.startsWith('-') || cleanLine.startsWith('*')) {
        return (
          <li key={idx} className="text-xs text-secondary list-disc ml-4 mt-1 leading-relaxed">
            {parseBoldText(cleanLine.substring(1).trim())}
          </li>
        );
      }
      if (cleanLine === '') return <div key={idx} className="h-2"></div>;
      return <p key={idx} className="text-xs text-secondary leading-relaxed mt-1.5">{parseBoldText(cleanLine)}</p>;
    });
  };

  const parseBoldText = (text: string) => {
    const parts = text.split('**');
    return parts.map((part, i) => i % 2 === 1 ? <strong key={i} className="text-white font-semibold">{part}</strong> : part);
  };

  // Scoring styling helpers
  const getMatrixScoreColor = (score: number | null) => {
    if (score === null) return 'text-secondary';
    if (score === 100) return 'text-muted';
    if (score < 15) return 'text-green-400 font-semibold';
    if (score < 40) return 'text-indigo-400 font-semibold';
    return 'text-red-400 font-bold';
  };

  const getScoreColorClass = (score: number) => {
    if (score < 15) return 'border-l-green-400 text-green-400 bg-green-950/10';
    if (score < 40) return 'border-l-indigo-400 text-indigo-400 bg-indigo-950/10';
    return 'border-l-red-400 text-red-400 bg-red-950/10';
  };

  const getDiversificationNote = (score: number) => {
    if (score < 15) {
      return {
        title: 'Excellent Diversification',
        description: 'These funds have very low portfolio overlap, providing excellent risk distribution across different assets.',
        alertClass: 'bg-green-950/10 border-green-500/20 text-green-300'
      };
    }
    if (score < 40) {
      return {
        title: 'Moderate Diversification',
        description: 'Some stock duplication is present. Check the common holdings list below to verify if you are comfortable with these duplicated positions.',
        alertClass: 'bg-indigo-950/10 border-indigo-500/20 text-indigo-300'
      };
    }
    return {
      title: 'High Portfolio Overlap',
      description: 'Warning: These funds hold many of the same stocks. This increases concentration risk and reduces the benefits of holding separate schemes.',
      alertClass: 'bg-red-950/20 border-red-500/20 text-red-300'
    };
  };

  // If there are less than 2 mutual funds with scheme code configured
  if (uniqueFunds.length < 2) {
    return (
      <div className="glass-panel p-8 md:p-12 text-center flex flex-col items-center justify-center space-y-6 max-w-2xl mx-auto">
        <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 shadow-xl">
          <Layers className="w-8 h-8" />
        </div>
        <div className="space-y-2">
          <h3 className="text-xl font-bold text-white">Mutual Fund Overlap Analyser</h3>
          <p className="text-secondary text-sm max-w-md mx-auto leading-relaxed">
            Compare two mutual funds side-by-side or evaluate your entire portfolio to calculate stock overlap, sector allocation gaps, and concentration risks.
          </p>
        </div>

        <div className="p-4 rounded-xl bg-white/5 border border-white/5 text-left text-xs max-w-md w-full space-y-3">
          <div className="flex gap-2.5 items-start">
            <Info className="w-4 h-4 text-teal-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <span className="font-semibold text-white">Setup Required</span>
              <p className="text-secondary leading-relaxed">
                You need at least <strong>two mutual funds with scheme codes</strong> in your portfolio. Currently, you have {uniqueFunds.length}.
              </p>
            </div>
          </div>

          <div className="border-t border-white/5 pt-2 mt-2">
            <p className="text-secondary">
              <strong>How to configure scheme codes:</strong>
            </p>
            <ol className="list-decimal list-inside ml-1 mt-1 space-y-1 text-secondary">
              <li>Navigate to the <strong>Investments</strong> tab.</li>
              <li>Add or edit a mutual fund entry.</li>
              <li>Input its <strong>AMFI Scheme Code</strong> (e.g. <code>122639</code> for Parag Parikh Flexi Cap).</li>
              <li>Save changes and come back to run comparisons!</li>
            </ol>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Title */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className="text-3xl font-extrabold tracking-tight">Mutual Fund Portfolio Overlap</h2>
          <p className="text-secondary text-sm">
            Examine correlation matrices, search external funds, and calculate portfolio-wide stock overlap details.
          </p>
        </div>

        {/* Tab Selector */}
        <div className="flex items-center gap-1 bg-surface-dark p-1 rounded-xl border border-white/5 self-start md:self-auto shrink-0">
          <button
            onClick={() => setActiveSubTab('matrix')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all duration-200 ${
              activeSubTab === 'matrix'
                ? 'bg-gradient-to-tr from-teal-500 to-teal-400 text-black shadow-lg shadow-teal-500/10'
                : 'text-secondary hover:text-white'
            }`}
          >
            Portfolio Matrix
          </button>
          <button
            onClick={() => setActiveSubTab('twoway')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all duration-200 ${
              activeSubTab === 'twoway'
                ? 'bg-gradient-to-tr from-teal-500 to-teal-400 text-black shadow-lg shadow-teal-500/10'
                : 'text-secondary hover:text-white'
            }`}
          >
            Compare 2 Funds
          </button>
          <button
            onClick={() => setActiveSubTab('newfund')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all duration-200 ${
              activeSubTab === 'newfund'
                ? 'bg-gradient-to-tr from-teal-500 to-teal-400 text-black shadow-lg shadow-teal-500/10'
                : 'text-secondary hover:text-white'
            }`}
          >
            Test New Fund
          </button>
        </div>
      </div>

      {/* ========================================== */}
      {/* Sub-Tab 1: Portfolio Overlap Matrix & Advisor */}
      {/* ========================================== */}
      {activeSubTab === 'matrix' && (
        <div className="space-y-6">
          {matrixLoading && (
            <div className="glass-panel p-12 text-center flex flex-col items-center justify-center gap-3">
              <RefreshCw className="w-8 h-8 text-teal-400 animate-spin" />
              <span className="text-xs text-secondary font-mono">Fetching fund portfolios from FinAPI...</span>
            </div>
          )}

          {matrixError && !matrixLoading && (
            <div className="p-3.5 rounded-xl bg-red-950/20 border border-red-500/20 text-red-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              <span>{matrixError}</span>
            </div>
          )}

          {failedFunds.length > 0 && !matrixLoading && (
            <div className="p-4 rounded-xl bg-yellow-950/20 border border-yellow-500/20 text-yellow-300 text-xs space-y-2">
              <div className="flex gap-2 items-center">
                <AlertCircle className="w-4 h-4 text-yellow-400 shrink-0" />
                <span className="font-semibold text-white">Portfolio holdings lookup warnings ({failedFunds.length})</span>
              </div>
              <p className="text-secondary leading-relaxed">
                We could not retrieve stock constituents from the public database for the following schemes (they may be gold/debt ETFs, liquid funds, or have invalid AMFI codes). They have been excluded from the matrix:
              </p>
              <div className="max-h-[100px] overflow-y-auto pl-6 font-mono text-[10px] text-secondary space-y-1">
                {failedFunds.map((f, idx) => (
                  <div key={idx}>• {f.name} (AMFI Code: {f.code})</div>
                ))}
              </div>
            </div>
          )}

          {matrixInfo && !matrixLoading && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Matrix Table */}
              <div className="glass-panel p-6 lg:col-span-2 space-y-4">
                <div>
                  <h3 className="text-lg font-bold flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-teal-400"></span>
                    Pairwise Overlap Matrix (%)
                  </h3>
                  <p className="text-xs text-secondary mt-0.5">
                    Percentage of common stock holdings between your mutual funds.
                  </p>
                </div>

                <div className="overflow-x-auto">
                  <table className="text-xs w-full text-center border-collapse">
                    <thead>
                      <tr className="border-b border-white/5 text-[10px] font-bold text-secondary uppercase tracking-wider">
                        <th className="py-3 px-2 text-left pl-0">Fund Scheme</th>
                        {matrixInfo.names.map((name, idx) => (
                          <th key={`th-${idx}`} className="py-3 px-2 truncate max-w-[90px]" title={name}>
                            {name.substring(0, 10)}...
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {matrixInfo.names.map((name, i) => (
                        <tr key={`tr-${i}`} className="hover:bg-white/[0.01]">
                          <td className="py-3 px-2 text-left pl-0 font-semibold text-white truncate max-w-[150px]" title={name}>
                            {name}
                          </td>
                          {matrixInfo.names.map((_, j) => {
                            const score = matrixInfo.matrix[i][j];
                            return (
                              <td key={`td-${i}-${j}`} className={`py-3 px-2 font-mono ${getMatrixScoreColor(score)}`}>
                                {score !== null ? `${score.toFixed(1)}%` : '-'}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Advisor Card */}
              <div className="glass-panel p-6 flex flex-col justify-between space-y-4">
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-teal-500/10 border border-teal-500/20 flex items-center justify-center text-teal-400">
                      <Cpu className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-white">Aura Rebalancing Advisor</h4>
                      <p className="text-[9px] text-teal-400 font-semibold">AI Insights Agent</p>
                    </div>
                  </div>
                  <p className="text-xs text-secondary leading-relaxed">
                    Aura will analyze your pairwise overlap matrix to detect duplicates and design an optimization rebalancing suggestion.
                  </p>

                  {/* Advice response viewport */}
                  {aiReport && (
                    <div className="p-3 bg-white/5 border border-white/5 rounded-xl max-h-[220px] overflow-y-auto leading-relaxed prose prose-invert prose-xs text-secondary mt-2">
                      {parseMarkdownToReact(aiReport)}
                    </div>
                  )}
                </div>

                <button
                  onClick={handleAskAuraAdvice}
                  disabled={generatingReport}
                  className="w-full btn btn-primary text-xs font-bold py-2 flex items-center justify-center gap-1.5"
                >
                  {generatingReport ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Consulting Aura...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 text-black" />
                      {aiReport ? 'Re-consult Aura' : 'Ask Aura for Advice'}
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ========================================== */}
      {/* Sub-Tab 2: Compare Two Funds (Side-by-Side) */}
      {/* ========================================== */}
      {activeSubTab === 'twoway' && (
        <div className="space-y-6">
          {/* Selector Form */}
          <div className="glass-panel p-6">
            <form onSubmit={handleCompareTwoFunds} className="grid grid-cols-1 md:grid-cols-3 gap-6 items-end">
              <div className="form-group">
                <label className="text-[10px] font-bold text-secondary uppercase tracking-widest">Select Fund A</label>
                <select
                  value={fund1Code}
                  onChange={(e) => setFund1Code(e.target.value)}
                  className="py-2.5 px-3 text-xs w-full bg-[#0d0d12]"
                  required
                >
                  <option value="" disabled>-- Select Fund A --</option>
                  {uniqueFunds.map((fund) => (
                    <option 
                      key={`f1-${fund.id}`} 
                      value={fund.schemeCode}
                      disabled={fund.schemeCode?.toString() === fund2Code}
                    >
                      💼 {fund.name} ({fund.institution})
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="text-[10px] font-bold text-secondary uppercase tracking-widest">Select Fund B</label>
                <select
                  value={fund2Code}
                  onChange={(e) => setFund2Code(e.target.value)}
                  className="py-2.5 px-3 text-xs w-full bg-[#0d0d12]"
                  required
                >
                  <option value="" disabled>-- Select Fund B --</option>
                  {uniqueFunds.map((fund) => (
                    <option 
                      key={`f2-${fund.id}`} 
                      value={fund.schemeCode}
                      disabled={fund.schemeCode?.toString() === fund1Code}
                    >
                      💼 {fund.name} ({fund.institution})
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="submit"
                disabled={twoWayLoading || !fund1Code || !fund2Code}
                className="w-full btn btn-primary font-bold text-xs py-2.5 flex items-center justify-center gap-2"
              >
                {twoWayLoading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Querying Portfolios...
                  </>
                ) : (
                  <>
                    <Layers className="w-4 h-4 text-black" />
                    Compare Holdings
                  </>
                )}
              </button>
            </form>

            {twoWayError && (
              <div className="p-3.5 rounded-xl bg-red-950/20 border border-red-500/20 text-red-300 text-xs flex items-center gap-2 mt-4">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                <span>{twoWayError}</span>
              </div>
            )}
          </div>

          {/* Results Visuals */}
          {twoWayResult && !twoWayLoading && (
            <div className="space-y-8">
              {/* Summary Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className={`glass-panel p-6 flex flex-col justify-between border-l-4 ${getScoreColorClass(twoWayResult.overlap)}`}>
                  <div className="space-y-1">
                    <span className="text-[10px] font-bold text-secondary uppercase tracking-wider">Mutual Fund Overlap</span>
                    <div className="text-4xl font-extrabold font-mono tracking-tight text-white mt-1">
                      {twoWayResult.overlap.toFixed(1)}%
                    </div>
                  </div>
                  <div className="text-[10px] text-secondary mt-4 leading-relaxed font-semibold">
                    Common stock holdings weighted aggregate score.
                  </div>
                </div>

                <div className="glass-panel p-6 md:col-span-2 border border-white/5 flex flex-col justify-between">
                  <div>
                    <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider block mb-1">Diversification Rating</span>
                    <h4 className="text-base font-bold text-white mb-2">{getDiversificationNote(twoWayResult.overlap).title}</h4>
                    <p className="text-xs text-secondary leading-relaxed">{getDiversificationNote(twoWayResult.overlap).description}</p>
                  </div>
                  <div className="text-[10px] text-secondary border-t border-white/5 pt-3 mt-4 flex items-center gap-4">
                    <div><strong className="text-white">{twoWayResult.shared.length}</strong> shared holdings</div>
                    <div><strong className="text-white">{twoWayResult.unique1.length}</strong> unique in Fund A</div>
                    <div><strong className="text-white">{twoWayResult.unique2.length}</strong> unique in Fund B</div>
                  </div>
                </div>
              </div>

              {/* Shared Stocks & Sector Exposure Gaps */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Common Holdings Table */}
                <div className="glass-panel p-6 flex flex-col h-[480px]">
                  <div className="mb-4">
                    <h3 className="text-lg font-bold flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-teal-400"></span>
                      Shared Stocks
                    </h3>
                  </div>
                  <div className="flex-grow overflow-y-auto pr-2">
                    {twoWayResult.shared.length === 0 ? (
                      <div className="h-full flex items-center justify-center text-secondary text-xs">No shared stocks.</div>
                    ) : (
                      <table className="text-xs w-full">
                        <thead>
                          <tr className="border-b border-white/5 text-[10px] font-bold text-secondary uppercase tracking-wider">
                            <th className="py-2 pl-0 text-left">Company</th>
                            <th className="py-2 text-center">Fund A (%)</th>
                            <th className="py-2 text-center">Fund B (%)</th>
                            <th className="py-2 text-right pr-0">Overlap</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {twoWayResult.shared.map((item, idx) => (
                            <tr key={`tw-${idx}`} className="hover:bg-white/[0.01]">
                              <td className="py-2.5 pl-0 text-left">
                                <span className="font-semibold text-white block">{item.name}</span>
                                <span className="text-[10px] text-secondary font-mono">{item.sector}</span>
                              </td>
                              <td className="py-2.5 text-center font-mono text-secondary">{item.weight1.toFixed(2)}%</td>
                              <td className="py-2.5 text-center font-mono text-secondary">{item.weight2.toFixed(2)}%</td>
                              <td className="py-2.5 text-right pr-0 font-mono font-bold text-teal-400">{item.overlap.toFixed(2)}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>

                {/* Sector exposure */}
                <div className="glass-panel p-6 flex flex-col h-[480px]">
                  <div className="mb-4">
                    <h3 className="text-lg font-bold flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-indigo-400"></span>
                      Sector Exposure Gaps
                    </h3>
                  </div>
                  <div className="flex-grow overflow-y-auto pr-2 space-y-4">
                    {twoWayResult.sectors.map((sec, idx) => {
                      const maxWeight = Math.max(sec.weight1, sec.weight2, 1);
                      return (
                        <div key={`twsec-${idx}`} className="space-y-1">
                          <div className="flex justify-between text-xs">
                            <span className="font-semibold text-white">{sec.sector}</span>
                            <span className="font-mono text-secondary text-[11px]">Gap: <strong className="text-indigo-400">{sec.diff.toFixed(1)}%</strong></span>
                          </div>
                          <div className="space-y-1 pl-2 border-l border-white/10">
                            <div className="flex justify-between text-[10px] text-secondary font-mono">
                              <span className="truncate">{twoWayResult.name1.substring(0, 30)}...</span>
                              <span>{sec.weight1.toFixed(1)}%</span>
                            </div>
                            <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                              <div className="h-full bg-teal-400 rounded-full" style={{ width: `${(sec.weight1 / maxWeight) * 100}%` }}></div>
                            </div>
                          </div>
                          <div className="space-y-1 pl-2 border-l border-white/10 mt-1">
                            <div className="flex justify-between text-[10px] text-secondary font-mono">
                              <span className="truncate">{twoWayResult.name2.substring(0, 30)}...</span>
                              <span>{sec.weight2.toFixed(1)}%</span>
                            </div>
                            <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                              <div className="h-full bg-indigo-400 rounded-full" style={{ width: `${(sec.weight2 / maxWeight) * 100}%` }}></div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Unique Assets */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="glass-panel p-6 flex flex-col h-[350px]">
                  <div className="mb-3">
                    <span className="text-[10px] font-bold text-teal-400 uppercase tracking-widest">Unique Exposure</span>
                    <h4 className="text-sm font-bold text-white mt-0.5 truncate">Only in {twoWayResult.name1}</h4>
                  </div>
                  <div className="flex-grow overflow-y-auto pr-2">
                    <table className="text-xs w-full">
                      <thead>
                        <tr className="border-b border-white/5 text-[10px] font-bold text-secondary uppercase tracking-wider">
                          <th className="py-2 pl-0 text-left">Company</th>
                          <th className="py-2 text-right pr-0">Weight (%)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {twoWayResult.unique1.map((item, idx) => (
                          <tr key={`u1-${idx}`}>
                            <td className="py-2 pl-0 text-left text-white font-semibold truncate max-w-[200px]">{item.name}</td>
                            <td className="py-2 text-right pr-0 font-mono text-secondary">{item.weightage.toFixed(2)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="glass-panel p-6 flex flex-col h-[350px]">
                  <div className="mb-3">
                    <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest">Unique Exposure</span>
                    <h4 className="text-sm font-bold text-white mt-0.5 truncate">Only in {twoWayResult.name2}</h4>
                  </div>
                  <div className="flex-grow overflow-y-auto pr-2">
                    <table className="text-xs w-full">
                      <thead>
                        <tr className="border-b border-white/5 text-[10px] font-bold text-secondary uppercase tracking-wider">
                          <th className="py-2 pl-0 text-left">Company</th>
                          <th className="py-2 text-right pr-0">Weight (%)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {twoWayResult.unique2.map((item, idx) => (
                          <tr key={`u2-${idx}`}>
                            <td className="py-2 pl-0 text-left text-white font-semibold truncate max-w-[200px]">{item.name}</td>
                            <td className="py-2 text-right pr-0 font-mono text-secondary">{item.weightage.toFixed(2)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

            </div>
          )}
        </div>
      )}

      {/* ========================================== */}
      {/* Sub-Tab 3: Test a New Fund (Autocomplete Search) */}
      {/* ========================================== */}
      {activeSubTab === 'newfund' && (
        <div className="space-y-6">
          {/* Search form */}
          <div className="glass-panel p-6">
            <form onSubmit={handleCompareNewFund} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-end">
                {/* Autocomplete Name Search */}
                <div className="form-group md:col-span-2 relative">
                  <label className="text-[10px] font-bold text-secondary uppercase tracking-widest">Search Mutual Fund Name</label>
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="Type at least 3 letters (e.g. Parag Parikh, HDFC Index, SBI Midcap)..."
                      value={searchQuery}
                      onChange={(e) => {
                        setSearchQuery(e.target.value);
                        setSelectedNewFund(null); // Reset selected
                      }}
                      className="py-2.5 pl-10 pr-4 text-xs w-full"
                    />
                    <Search className="absolute left-3.5 top-3 w-4 h-4 text-secondary" />
                    
                    {/* Search Results Dropdown Overlay */}
                    {searchResults.length > 0 && !selectedNewFund && (
                      <div className="absolute left-0 right-0 top-full mt-1 bg-[#090a0f] border border-white/10 rounded-xl max-h-[200px] overflow-y-auto z-30 shadow-2xl divide-y">
                        {searchResults.map((item) => (
                          <button
                            key={item.schemeCode}
                            type="button"
                            onClick={() => {
                              setSelectedNewFund(item);
                              setSearchQuery(item.schemeName);
                              setSearchResults([]);
                            }}
                            className="w-full text-left p-3 text-xs text-secondary hover:text-white hover:bg-white/5 transition-colors truncate"
                          >
                            <strong>[{item.schemeCode}]</strong> {item.schemeName}
                          </button>
                        ))}
                      </div>
                    )}
                    
                    {searchingSchemes && (
                      <div className="absolute right-3 top-3">
                        <RefreshCw className="w-4 h-4 animate-spin text-teal-400" />
                      </div>
                    )}
                  </div>
                </div>

                {/* Compare Target Selector */}
                <div className="form-group">
                  <label className="text-[10px] font-bold text-secondary uppercase tracking-widest">Compare Against</label>
                  <select
                    value={compareTarget}
                    onChange={(e) => setCompareTarget(e.target.value)}
                    className="py-2.5 px-3 text-xs w-full bg-[#0d0d12]"
                  >
                    <option value="portfolio">💼 Combined Portfolio (Weighted)</option>
                    {uniqueFunds.map((fund) => (
                      <option key={`target-${fund.id}`} value={fund.schemeCode}>
                        📁 Individual: {fund.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {selectedNewFund && (
                <div className="p-3 bg-teal-950/20 border border-teal-500/20 rounded-xl flex items-center justify-between">
                  <div className="text-xs">
                    <span className="text-[9px] font-bold uppercase text-teal-400 block">Selected External Fund</span>
                    <strong className="text-white">{selectedNewFund.schemeName}</strong> (AMFI Code: {selectedNewFund.schemeCode})
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedNewFund(null);
                      setSearchQuery('');
                    }}
                    className="text-red-400 hover:text-red-300 transition-colors p-1"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              <button
                type="submit"
                disabled={newFundLoading || !selectedNewFund}
                className="btn btn-primary w-full text-xs font-bold py-2.5 flex items-center justify-center gap-2"
              >
                {newFundLoading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Querying constituents & running calculations...
                  </>
                ) : (
                  <>
                    <Layers className="w-4 h-4 text-black" />
                    Run Pre-Buy Overlap Review
                  </>
                )}
              </button>
            </form>

            {newFundError && (
              <div className="p-3.5 rounded-xl bg-red-950/20 border border-red-500/20 text-red-300 text-xs flex items-center gap-2 mt-4">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                <span>{newFundError}</span>
              </div>
            )}
          </div>

          {/* New Fund comparison results rendering */}
          {newFundResult && !newFundLoading && (
            <div className="space-y-8">
              {/* Summary Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className={`glass-panel p-6 flex flex-col justify-between border-l-4 ${getScoreColorClass(newFundResult.overlap)}`}>
                  <div className="space-y-1">
                    <span className="text-[10px] font-bold text-secondary uppercase tracking-wider">Aggregated Overlap introduced</span>
                    <div className="text-4xl font-extrabold font-mono tracking-tight text-white mt-1">
                      {newFundResult.overlap.toFixed(1)}%
                    </div>
                  </div>
                  <div className="text-[10px] text-secondary mt-4 leading-relaxed font-semibold">
                    Shows overlapping stock weightages introduced if you buy this scheme.
                  </div>
                </div>

                <div className="glass-panel p-6 md:col-span-2 border border-white/5 flex flex-col justify-between">
                  <div>
                    <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider block mb-1">Pre-Buy Diversification Rating</span>
                    <h4 className="text-base font-bold text-white mb-2">
                      {newFundResult.overlap < 20 ? 'High Diversification value' : newFundResult.overlap < 40 ? 'Moderate exposure gap' : 'Significant redundancy warning'}
                    </h4>
                    <p className="text-xs text-secondary leading-relaxed">
                      {newFundResult.overlap < 20 
                        ? `Adding ${newFundResult.newFundName} will add mostly unique assets to your portfolio, expanding your sector/holding diversification.`
                        : newFundResult.overlap < 40 
                        ? `Adding this fund will share a moderate exposure with your existing portfolio (${newFundResult.overlap.toFixed(1)}%). Review the overlapping stock table below.`
                        : `Warning: This fund shares high overlaps with your portfolio. It will introduce redundant positions, reducing overall diversification.`}
                    </p>
                  </div>
                  <div className="text-[10px] text-secondary border-t border-white/5 pt-3 mt-4 flex items-center gap-4">
                    <div><strong className="text-white">{newFundResult.shared.length}</strong> overlapping stocks</div>
                    <div><strong className="text-white">{newFundResult.uniquePortfolio.length}</strong> unique assets in your selection</div>
                    <div><strong className="text-white">{newFundResult.uniqueNewFund.length}</strong> unique in the new fund</div>
                  </div>
                </div>
              </div>

              {/* Shared Stocks and Sectors exposure */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Common Stocks */}
                <div className="glass-panel p-6 flex flex-col h-[480px]">
                  <div className="mb-4">
                    <h3 className="text-lg font-bold flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-teal-400"></span>
                      Overlapping Stock Details
                    </h3>
                  </div>
                  <div className="flex-grow overflow-y-auto pr-2">
                    {newFundResult.shared.length === 0 ? (
                      <div className="h-full flex items-center justify-center text-secondary text-xs">No overlapping stock holdings.</div>
                    ) : (
                      <table className="text-xs w-full">
                        <thead>
                          <tr className="border-b border-white/5 text-[10px] font-bold text-secondary uppercase tracking-wider">
                            <th className="py-2 pl-0 text-left">Company</th>
                            <th className="py-2 text-center">Portfolio (%)</th>
                            <th className="py-2 text-center">New Fund (%)</th>
                            <th className="py-2 text-right pr-0">Overlap</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {newFundResult.shared.map((item, idx) => (
                            <tr key={`nf-${idx}`} className="hover:bg-white/[0.01]">
                              <td className="py-2.5 pl-0 text-left">
                                <span className="font-semibold text-white block">{item.name}</span>
                                <span className="text-[10px] text-secondary font-mono">{item.sector}</span>
                              </td>
                              <td className="py-2.5 text-center font-mono text-secondary">{item.weight1.toFixed(2)}%</td>
                              <td className="py-2.5 text-center font-mono text-secondary">{item.weight2.toFixed(2)}%</td>
                              <td className="py-2.5 text-right pr-0 font-mono font-bold text-teal-400">{item.overlap.toFixed(2)}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>

                {/* Sector Gap comparisons */}
                <div className="glass-panel p-6 flex flex-col h-[480px]">
                  <div className="mb-4">
                    <h3 className="text-lg font-bold flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-indigo-400"></span>
                      Sectors exposure side-by-side
                    </h3>
                  </div>
                  <div className="flex-grow overflow-y-auto pr-2 space-y-4">
                    {newFundResult.sectors.map((sec, idx) => {
                      const maxWeight = Math.max(sec.weightPortfolio, sec.weightNewFund, 1);
                      return (
                        <div key={`nfsec-${idx}`} className="space-y-1">
                          <div className="flex justify-between text-xs">
                            <span className="font-semibold text-white">{sec.sector}</span>
                            <span className="font-mono text-secondary text-[11px]">Gap: <strong className="text-indigo-400">{sec.diff.toFixed(1)}%</strong></span>
                          </div>
                          
                          <div className="space-y-1 pl-2 border-l border-white/10">
                            <div className="flex justify-between text-[10px] text-secondary font-mono">
                              <span className="truncate">{newFundResult.targetName}</span>
                              <span>{sec.weightPortfolio.toFixed(1)}%</span>
                            </div>
                            <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                              <div className="h-full bg-teal-400 rounded-full" style={{ width: `${(sec.weightPortfolio / maxWeight) * 100}%` }}></div>
                            </div>
                          </div>

                          <div className="space-y-1 pl-2 border-l border-white/10 mt-1">
                            <div className="flex justify-between text-[10px] text-secondary font-mono">
                              <span className="truncate">{newFundResult.newFundName.substring(0, 30)}...</span>
                              <span>{sec.weightNewFund.toFixed(1)}%</span>
                            </div>
                            <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                              <div className="h-full bg-indigo-400 rounded-full" style={{ width: `${(sec.weightNewFund / maxWeight) * 100}%` }}></div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
