import React, { useState, useEffect, useRef } from 'react';
import type { Investment, ExchangeRates, InvestmentCurrency } from '../types';
import { convertCurrency, formatCurrency } from '../utils/exchangeRates';
import { 
  Sparkles, MessageSquare, Send, Key, X, RefreshCw, Cpu
} from 'lucide-react';
import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../firebase';

interface AuraAdvisorProps {
  investments: Investment[];
  rates: ExchangeRates;
  displayCurrency: InvestmentCurrency;
}

interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

export const AuraAdvisor: React.FC<AuraAdvisorProps> = ({
  investments,
  rates,
  displayCurrency
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'chat' | 'optimize'>('chat');
  
  // AI & Chat States
  const [apiKey, setApiKey] = useState<string>('');
  const [showKeyInput, setShowKeyInput] = useState<boolean>(false);
  const [tempKey, setTempKey] = useState<string>('');
  const [isEnvKey, setIsEnvKey] = useState<boolean>(false);
  
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState<string>('');
  const [isChatLoading, setIsChatLoading] = useState<boolean>(false);

  // Portfolio Optimizer States
  const [optimizationResult, setOptimizationResult] = useState<string>('');
  const [isOptimizing, setIsOptimizing] = useState<boolean>(false);
  const [optimizerStep, setOptimizerStep] = useState<string>('');

  const chatEndRef = useRef<HTMLDivElement>(null);

  // Load API Key from environment, Firestore, or local storage on mount
  useEffect(() => {
    const loadKey = async () => {
      // 1. Try local dev environment variable first
      const envKey = (import.meta.env.VITE_GEMINI_API_KEY as string) || '';
      if (envKey) {
        setApiKey(envKey);
        setTempKey(envKey);
        setIsEnvKey(true);
        setShowKeyInput(false);
        return;
      }

      // 2. Try fetching securely from Firestore secrets document (for deployed app)
      try {
        const secretDocRef = doc(db, 'secrets', 'gemini');
        const secretSnap = await getDoc(secretDocRef);
        if (secretSnap.exists()) {
          const keyData = secretSnap.data().key;
          if (keyData) {
            setApiKey(keyData);
            setTempKey(keyData);
            setIsEnvKey(true); // Treat as system-level key
            setShowKeyInput(false);
            return;
          }
        }
      } catch (err) {
        console.warn("Could not read secure key from Firestore. Falling back to local storage.", err);
      }

      // 3. Fall back to local storage
      const savedKey = localStorage.getItem('gemini_api_key') || '';
      if (savedKey) {
        setApiKey(savedKey);
        setTempKey(savedKey);
        setIsEnvKey(false);
        setShowKeyInput(false);
      } else {
        setShowKeyInput(true);
      }
    };

    loadKey();
  }, []);

  // Scroll to bottom of chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, isChatLoading]);

  // Save API Key
  const handleSaveKey = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanKey = tempKey.trim();
    
    // Save locally
    localStorage.setItem('gemini_api_key', cleanKey);
    setApiKey(cleanKey);
    setShowKeyInput(false);
    
    // Save securely to Firestore (only admin@example.com can write)
    try {
      const docRef = doc(db, 'secrets', 'gemini');
      await setDoc(docRef, { key: cleanKey, updatedAt: new Date() });
      setIsEnvKey(true); // Treat as system-level key
      console.log("Gemini API key saved securely to Firestore.");
    } catch (err) {
      console.warn("Could not save key to Firestore. Storing locally instead.", err);
    }
  };

  // Clear API Key
  const handleClearKey = async () => {
    localStorage.removeItem('gemini_api_key');
    setApiKey('');
    setTempKey('');
    setShowKeyInput(true);
    
    try {
      const docRef = doc(db, 'secrets', 'gemini');
      await deleteDoc(docRef);
      setIsEnvKey(false);
      console.log("Gemini API key removed from Firestore.");
    } catch (err) {
      console.warn("Could not delete key from Firestore.", err);
    }
  };

  // Helper to call Gemini API
  const callGemini = async (prompt: string, systemInstruction?: string) => {
    const modelName = "gemini-2.5-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
    
    const requestBody: any = {
      contents: [
        {
          parts: [{ text: prompt }]
        }
      ]
    };

    if (systemInstruction) {
      requestBody.systemInstruction = {
        parts: [{ text: systemInstruction }]
      };
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errData = await response.json();
      throw new Error(errData?.error?.message || 'Gemini API call failed');
    }

    const data = await response.json();
    return data.candidates[0].content.parts[0].text;
  };

  // Portfolio Optimization logic
  const handleOptimizePortfolio = async () => {
    if (!apiKey) {
      setShowKeyInput(true);
      return;
    }

    setIsOptimizing(true);
    setOptimizationResult('');
    
    try {
      setOptimizerStep('Aggregating portfolio statistics...');
      await new Promise(r => setTimeout(r, 600));
      
      setOptimizerStep('Evaluating geographic and currency exposure...');
      await new Promise(r => setTimeout(r, 600));

      setOptimizerStep('Running Aura Optimizer models...');
      
      // Calculate totals
      const totalInvested = investments.reduce((sum, inv) => {
        return sum + convertCurrency(inv.amountInvested, inv.currency, displayCurrency, rates);
      }, 0);

      const totalCurrentValue = investments.reduce((sum, inv) => {
        return sum + convertCurrency(inv.currentValue, inv.currency, displayCurrency, rates);
      }, 0);

      const absoluteGainLoss = totalCurrentValue - totalInvested;
      const gainLossPercentage = totalInvested > 0 ? (absoluteGainLoss / totalInvested) * 100 : 0;

      const portfolioSummary = investments.map(inv => {
        const val = convertCurrency(inv.currentValue, inv.currency, displayCurrency, rates);
        const invVal = convertCurrency(inv.amountInvested, inv.currency, displayCurrency, rates);
        return `- ${inv.name}: Type: ${inv.type}, Institution: ${inv.institution}, Region: ${inv.region}, Invested: ${formatCurrency(invVal, displayCurrency)}, Current Value: ${formatCurrency(val, displayCurrency)}`;
      }).join('\n');

      const systemPrompt = `You are Aura, an elite personal AI financial advisor. 
Analyze the user's portfolio and provide professional, actionable asset-allocation and optimization recommendations.
Always act as a senior wealth advisor and incorporate a clear disclaimer stating that this is not official financial advice.`;

      const prompt = `Here is my current investment portfolio:
Total Net Worth: ${formatCurrency(totalCurrentValue, displayCurrency)}
Total Capital Invested: ${formatCurrency(totalInvested, displayCurrency)}
Overall Profit/Loss: ${formatCurrency(absoluteGainLoss, displayCurrency)} (${gainLossPercentage.toFixed(2)}%)
Display Currency: ${displayCurrency}

Asset breakdown:
${portfolioSummary}

Please analyze this portfolio and provide:
1. **Asset Allocation Analysis**: How is the asset mix (stocks, mutual funds, FDs, savings)? Is it balanced?
2. **Geographic & Currency Risk**: Evaluate the exposure to India vs Europe, and the INR/EUR currency exposure.
3. **Actionable Suggestions**: Provide 3-4 specific, professional recommendations to optimize returns, balance risk, and improve liquidity based on this exact asset list.

Keep the output professional, clear, and structured in clean markdown.`;

      const result = await callGemini(prompt, systemPrompt);
      setOptimizationResult(result);
    } catch (err: any) {
      console.error(err);
      setOptimizationResult(`### Optimization Error\n\nFailed to complete analysis: ${err.message || 'Unknown network error'}`);
    } finally {
      setIsOptimizing(false);
      setOptimizerStep('');
    }
  };

  // Chat message submit
  const handleSendChatMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || isChatLoading) return;

    const userText = chatInput.trim();
    setChatInput('');
    
    // Add user message to state
    const updatedMessages = [...chatMessages, { role: 'user' as const, text: userText }];
    setChatMessages(updatedMessages);
    setIsChatLoading(true);

    try {
      const portfolioContext = investments.map(inv => {
        const val = convertCurrency(inv.currentValue, inv.currency, displayCurrency, rates);
        return `- ${inv.name} (${inv.type}) in ${inv.region}: Current Value: ${formatCurrency(val, displayCurrency)} (via ${inv.institution})`;
      }).join('\n');

      const systemPrompt = `You are Aura, a premium personal AI financial advisor. 
You help the user analyze stocks, mutual funds, and their current portfolio. 
Provide professional, insightful, and clear financial analysis.
Always act as a professional advisor and include a concise disclaimer at the end ("Not financial advice, do your own research").
Be professional, elegant, and concise.

The user's current portfolio contains the following investments:
${portfolioContext}`;

      const historyPrompt = updatedMessages.map(msg => `${msg.role === 'user' ? 'User' : 'Aura'}: ${msg.text}`).join('\n\n');
      const finalPrompt = `${historyPrompt}\n\nProvide the next response as Aura:`;

      const responseText = await callGemini(finalPrompt, systemPrompt);
      
      setChatMessages([...updatedMessages, { role: 'model', text: responseText }]);
    } catch (err: any) {
      console.error(err);
      setChatMessages([...updatedMessages, { role: 'model', text: `Sorry, I encountered an error: ${err.message || 'Please check your API key or network connection.'}` }]);
    } finally {
      setIsChatLoading(false);
    }
  };

  // Custom Markdown parser for React UI
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

  return (
    <>
      {/* Floating AI Chat Trigger Button - Placed on the RIGHT-hand side */}
      <div className="fixed bottom-6 right-6 z-50 transition-all duration-200">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="w-14 h-14 rounded-full bg-gradient-to-tr from-teal-500 to-indigo-600 text-black flex items-center justify-center shadow-2xl hover:scale-105 transition-all duration-200 group active:scale-95 relative"
          style={{ boxShadow: '0 8px 30px rgba(0, 242, 254, 0.25)' }}
          title="AURA AI Advisor"
        >
          {isOpen ? <X className="w-6 h-6 text-black" /> : <Sparkles className="w-6 h-6 text-black animate-pulse" />}
          
          {/* Unread badge */}
          {!isOpen && chatMessages.length === 0 && (
            <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-teal-400 rounded-full border-2 border-[#090a0f] animate-ping"></span>
          )}
        </button>
      </div>

      {/* AI Chat / Advisor Popover Window - aligned to the RIGHT-hand side above the button */}
      {isOpen && (
        <div 
          className="fixed bottom-24 right-6 w-[380px] h-[550px] rounded-2xl border border-white/10 shadow-2xl z-50 flex flex-col bg-[#090a0f]/95 backdrop-blur-md overflow-hidden animate-fade-in"
          style={{ boxShadow: '0 10px 40px -10px rgba(0, 0, 0, 0.8)' }}
        >
          {/* Header */}
          <div className="p-4 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-teal-500 to-indigo-500 flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-black" />
              </div>
              <div>
                <span className="font-bold text-xs text-white block">AURA AI Hub</span>
                <span className="text-[9px] text-green-400 flex items-center gap-1 font-semibold">
                  <span className="w-1.5 h-1.5 bg-green-400 rounded-full inline-block animate-ping"></span>
                  Online & Context-aware
                </span>
              </div>
            </div>
            
            <div className="flex items-center gap-1.5">
              <button 
                onClick={() => setShowKeyInput(!showKeyInput)}
                className={`p-1.5 rounded-lg hover:bg-white/5 transition-colors ${apiKey ? 'text-teal-400' : 'text-yellow-500 animate-pulse'}`}
                title="API Key Settings"
              >
                <Key className="w-4 h-4" />
              </button>
              <button 
                onClick={() => setIsOpen(false)}
                className="p-1.5 rounded-lg hover:bg-white/5 text-secondary hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Tab Selection */}
          {!showKeyInput && apiKey && (
            <div className="flex border-b border-white/5 bg-white/[0.01]">
              <button
                onClick={() => setActiveTab('chat')}
                className={`flex-1 py-2.5 text-xs font-bold transition-all ${
                  activeTab === 'chat'
                    ? 'text-teal-400 border-b-2 border-teal-500 bg-teal-500/5'
                    : 'text-secondary hover:text-white'
                }`}
              >
                Ask Advisor (Chat)
              </button>
              <button
                onClick={() => setActiveTab('optimize')}
                className={`flex-1 py-2.5 text-xs font-bold transition-all ${
                  activeTab === 'optimize'
                    ? 'text-teal-400 border-b-2 border-teal-500 bg-teal-500/5'
                    : 'text-secondary hover:text-white'
                }`}
              >
                Optimize Portfolio
              </button>
            </div>
          )}

          {/* API Key settings panel */}
          {showKeyInput && (
            <div className="absolute inset-0 bg-[#090a0f]/90 z-20 p-6 flex flex-col justify-center text-center space-y-4">
              <div className="w-12 h-12 rounded-2xl bg-teal-500/10 border border-teal-500/20 flex items-center justify-center text-teal-400 mx-auto">
                <Key className="w-6 h-6" />
              </div>
              <div>
                <h4 className="font-bold text-white text-sm">Gemini API Key Required</h4>
                <p className="text-[11px] text-secondary mt-1 max-w-[280px] mx-auto">
                  Aura calls the Google Gemini API directly from your browser. Input your developer key to get started for free.
                </p>
              </div>

              <form onSubmit={handleSaveKey} className="space-y-3 text-left">
                <div>
                  <input
                    type="password"
                    required
                    placeholder="AIzaSy..."
                    value={tempKey}
                    onChange={(e) => setTempKey(e.target.value)}
                    className="w-full text-xs"
                  />
                </div>
                <div className="flex gap-2">
                  {apiKey && (
                    <button 
                      type="button" 
                      onClick={() => setShowKeyInput(false)}
                      className="btn btn-secondary w-full text-xs py-2"
                    >
                      Cancel
                    </button>
                  )}
                  <button type="submit" className="btn btn-primary w-full text-xs py-2 font-bold">
                    Save API Key
                  </button>
                </div>
              </form>
              <a 
                href="https://aistudio.google.com/" 
                target="_blank" 
                rel="noreferrer" 
                className="text-[10px] text-teal-400 hover:underline inline-block mt-2 font-semibold"
              >
                Get a free API Key from Google AI Studio ↗
              </a>
            </div>
          )}

          {/* Tab Content 1: Chat Message Log */}
          {activeTab === 'chat' && !showKeyInput && (
            <div className="flex-grow flex flex-col min-h-0 overflow-hidden">
              <div className="flex-grow p-4 overflow-y-auto space-y-4">
                {chatMessages.length === 0 && (
                  <div className="h-full flex flex-col items-center justify-center text-center space-y-3 p-4 opacity-80">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-teal-500/10 to-indigo-500/10 border border-teal-500/20 flex items-center justify-center text-teal-400">
                      <MessageSquare className="w-5.5 h-5.5" />
                    </div>
                    <p className="text-xs font-semibold text-white">Ask Aura AI Advisor</p>
                    <p className="text-[10px] text-secondary max-w-[220px]">
                      "Is my exposure to FDs too high?" or "Analyze ticker INFY.NS" or "Should I rebalance?"
                    </p>
                  </div>
                )}
                
                {chatMessages.map((msg, idx) => (
                  <div 
                    key={idx} 
                    className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-fade-in`}
                  >
                    <div className={`max-w-[85%] rounded-2xl p-3 text-xs leading-relaxed ${
                      msg.role === 'user' 
                        ? 'bg-gradient-to-tr from-teal-500/10 to-teal-400/10 border border-teal-500/20 text-white rounded-br-none' 
                        : 'bg-white/5 border border-white/5 text-secondary rounded-bl-none'
                    }`}>
                      {msg.role === 'model' ? (
                        <div className="prose prose-invert prose-xs leading-relaxed">
                          {parseMarkdownToReact(msg.text)}
                        </div>
                      ) : (
                        msg.text
                      )}
                    </div>
                  </div>
                ))}

                {isChatLoading && (
                  <div className="flex justify-start items-center gap-2 animate-pulse">
                    <div className="bg-white/5 border border-white/5 rounded-2xl rounded-bl-none p-3 text-xs text-secondary flex items-center gap-2">
                      <div className="flex gap-1">
                        <span className="w-1.5 h-1.5 bg-teal-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                        <span className="w-1.5 h-1.5 bg-teal-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                        <span className="w-1.5 h-1.5 bg-teal-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                      </div>
                      <span className="text-[10px] text-secondary font-mono">Aura is thinking...</span>
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              {/* Chat settings indicator footer */}
              {apiKey && (
                <div className="px-4 py-1.5 border-t border-white/5 bg-white/[0.01] flex items-center justify-between text-[10px] text-secondary shrink-0">
                  {isEnvKey ? (
                    <span className="truncate text-teal-400 font-semibold">Loaded from .env config</span>
                  ) : (
                    <>
                      <span className="truncate">Key active: ...{apiKey.substring(apiKey.length - 6)}</span>
                      <button 
                        onClick={handleClearKey}
                        className="text-red-400 hover:text-red-300 transition-colors font-semibold"
                      >
                        Remove Key
                      </button>
                    </>
                  )}
                </div>
              )}

              {/* Chat Input Field */}
              <form onSubmit={handleSendChatMessage} className="p-3 border-t border-white/5 bg-white/[0.01] flex gap-2 shrink-0">
                <input
                  type="text"
                  required
                  placeholder="Ask Aura anything..."
                  disabled={isChatLoading}
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  className="flex-grow text-xs py-2"
                />
                <button
                  type="submit"
                  disabled={!chatInput.trim() || isChatLoading}
                  className="btn btn-primary p-2 flex items-center justify-center shrink-0"
                >
                  <Send className="w-4 h-4 text-black" />
                </button>
              </form>
            </div>
          )}

          {/* Tab Content 2: Portfolio Optimizer */}
          {activeTab === 'optimize' && !showKeyInput && (
            <div className="flex-grow flex flex-col p-4 min-h-0 overflow-y-auto space-y-4">
              <div className="flex items-start gap-3 bg-white/5 p-3 rounded-xl border border-white/5">
                <div className="w-8 h-8 rounded-lg bg-teal-500/10 border border-teal-500/20 flex items-center justify-center text-teal-400 shrink-0">
                  <Cpu className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-white">AI Portfolio Optimizer</h4>
                  <p className="text-[10px] text-secondary mt-0.5 leading-relaxed">
                    Aura will analyze your asset diversification, geographical allocation, and risk metrics to draft concrete recommendations.
                  </p>
                </div>
              </div>

              {/* Action trigger button */}
              {!isOptimizing && !optimizationResult && (
                <div className="flex flex-col items-center justify-center py-12 text-center space-y-4">
                  <Sparkles className="w-12 h-12 text-teal-400 animate-pulse" />
                  <button
                    onClick={handleOptimizePortfolio}
                    className="btn btn-primary font-bold text-xs py-2.5 px-6"
                  >
                    Run Optimization Review
                  </button>
                </div>
              )}

              {/* Loading progress step indicator */}
              {isOptimizing && (
                <div className="flex flex-col items-center justify-center py-12 text-center space-y-3">
                  <RefreshCw className="w-8 h-8 text-teal-400 animate-spin" />
                  <p className="text-xs font-bold text-white font-mono animate-pulse">{optimizerStep}</p>
                  <p className="text-[10px] text-secondary">Checking allocations...</p>
                </div>
              )}

              {/* Optimization report layout */}
              {optimizationResult && !isOptimizing && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] font-bold text-teal-400 uppercase tracking-widest">Aura Advisory Report</span>
                    <button
                      onClick={handleOptimizePortfolio}
                      className="text-[10px] text-secondary hover:text-white flex items-center gap-1 font-semibold"
                    >
                      <RefreshCw className="w-3 h-3" /> Re-Run
                    </button>
                  </div>

                  <div className="p-3 bg-white/5 border border-white/5 rounded-xl text-secondary overflow-x-hidden leading-relaxed prose prose-invert prose-xs">
                    {parseMarkdownToReact(optimizationResult)}
                  </div>

                  <button
                    onClick={() => setOptimizationResult('')}
                    className="w-full btn btn-secondary text-xs py-2 border-white/5"
                  >
                    Reset Optimization View
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
};
