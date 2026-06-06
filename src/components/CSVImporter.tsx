import React, { useState, useRef } from 'react';
import type { InvestmentType, InvestmentRegion, InvestmentCurrency } from '../types';
import { collection, writeBatch, doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';
import { FileSpreadsheet, Upload, CheckCircle2, AlertTriangle, HelpCircle, Sparkles, Trash2, RotateCw } from 'lucide-react';
import confetti from 'canvas-confetti';

interface CSVImporterProps {
  portfolioId: string;
  onImportSuccess: () => void;
}

interface ParsedRow {
  [key: string]: string;
}

export const CSVImporter: React.FC<CSVImporterProps> = ({ portfolioId, onImportSuccess }) => {
  const { user } = useAuth();
  const isOwner = user?.email?.toLowerCase() === 'admin@example.com';

  const [importMode, setImportMode] = useState<'csv' | 'ai'>('csv');
  
  // CSV Mode States
  const [csvText, setCsvText] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({
    name: '',
    type: '',
    region: '',
    currency: '',
    amountInvested: '',
    currentValue: '',
    institution: '',
    notes: '',
    ticker: '',
    schemeCode: ''
  });
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Global fallbacks if column is missing
  const [defaultType, setDefaultType] = useState<InvestmentType>('stock');
  const [defaultRegion, setDefaultRegion] = useState<InvestmentRegion>('India');
  const [defaultCurrency, setDefaultCurrency] = useState<InvestmentCurrency>('INR');
  const [defaultInstitution, setDefaultInstitution] = useState('My Bank');

  // AI Mode States
  const [aiPrompt, setAiPrompt] = useState('');
  const [isAiParsing, setIsAiParsing] = useState(false);

  // Unified Preview & Status
  const [previewData, setPreviewData] = useState<any[]>([]);
  const [isResolvingMetadata, setIsResolvingMetadata] = useState(false);
  const [status, setStatus] = useState<{ type: 'idle' | 'success' | 'error' | 'uploading'; message: string }>({ type: 'idle', message: '' });

  // Example Prompt Pills
  const examplePrompts = [
    {
      label: "Bought Stocks",
      text: "I bought 15 shares of Reliance Industries (ticker: RELIANCE.NS) on Zerodha today for 36000 INR."
    },
    {
      label: "Mutual Fund",
      text: "Add Parag Parikh Flexi Cap Fund (AMFI: 122639) value 25000 INR. Institution is Groww, Region India."
    },
    {
      label: "Fixed Deposit",
      text: "Opened a Fixed Deposit of 5 Lakhs INR at SBI Bank on 2026-06-01 for 1 year at 7.15% simple interest."
    },
    {
      label: "European Savings",
      text: "Deposited 1200 EUR into my Revolut Savings account. Region is Europe."
    }
  ];

  // Helper to load Gemini API Key
  const loadGeminiKey = async () => {
    if (!isOwner) return '';

    // 1. Env Key
    const envKey = (import.meta.env.VITE_GEMINI_API_KEY as string) || '';
    if (envKey) return envKey;

    // 2. Firestore Secrets Secure Collection
    try {
      const docRef = doc(db, 'secrets', 'gemini');
      const docSnap = await getDoc(docRef);
      if (docSnap.exists() && docSnap.data().key) {
        return docSnap.data().key;
      }
    } catch (e) {
      console.warn("Could not read Gemini key from Firestore secure store.");
    }

    // 3. LocalStorage
    return localStorage.getItem('gemini_api_key') || '';
  };

  // Standard CSV row splitting logic
  const parseCSV = (text: string) => {
    setStatus({ type: 'idle', message: '' });
    try {
      const lines = text.split(/\r?\n/).map(line => line.trim()).filter(line => line !== '');
      if (lines.length < 2) {
        throw new Error('CSV must contain at least a header row and one data row.');
      }

      // Simple parser handling quotes
      const parseRow = (rowText: string): string[] => {
        const result: string[] = [];
        let insideQuote = false;
        let entry = '';
        for (let i = 0; i < rowText.length; i++) {
          const char = rowText[i];
          if (char === '"' || char === "'") {
            insideQuote = !insideQuote;
          } else if (char === ',' && !insideQuote) {
            result.push(entry.trim());
            entry = '';
          } else {
            entry += char;
          }
        }
        result.push(entry.trim());
        return result;
      };

      const parsedHeaders = parseRow(lines[0]);
      const rows: ParsedRow[] = [];

      for (let i = 1; i < lines.length; i++) {
        const values = parseRow(lines[i]);
        const row: ParsedRow = {};
        parsedHeaders.forEach((header, idx) => {
          row[header] = values[idx] || '';
        });
        rows.push(row);
      }

      setHeaders(parsedHeaders);
      setParsedRows(rows);

      // Guess initial mapping based on keywords
      const initialMap: Record<string, string> = {};
      const fields = ['name', 'type', 'region', 'currency', 'amountInvested', 'currentValue', 'institution', 'notes', 'ticker', 'schemeCode'];
      
      fields.forEach((field) => {
        const foundHeader = parsedHeaders.find((h) => {
          const lh = h.toLowerCase();
          const lf = field.toLowerCase();
          return lh.includes(lf) || lf.includes(lh) || 
            (field === 'amountInvested' && (lh.includes('invested') || lh.includes('cost') || lh.includes('capital') || lh.includes('amount') || lh.includes('price'))) ||
            (field === 'currentValue' && (lh.includes('current') || lh.includes('value') || lh.includes('valuation') || lh.includes('market'))) ||
            (field === 'institution' && (lh.includes('bank') || lh.includes('broker') || lh.includes('provider') || lh.includes('platform') || lh.includes('demat'))) ||
            (field === 'schemeCode' && (lh.includes('amfi') || lh.includes('scheme') || lh.includes('code') || lh.includes('mutual'))) ||
            (field === 'ticker' && (lh.includes('symbol') || lh.includes('ticker') || lh.includes('stock')));
        });
        initialMap[field] = foundHeader || '';
      });

      setMapping(initialMap);
      generatePreview(rows, initialMap);
    } catch (err: any) {
      setStatus({ type: 'error', message: err.message || 'Failed to parse CSV' });
    }
  };

  // Drag and drop handlers
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  };

  const handleFile = (file: File) => {
    if (file.type !== "text/csv" && !file.name.endsWith(".csv")) {
      setStatus({ type: 'error', message: 'Only CSV files are supported.' });
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setCsvText(text);
      parseCSV(text);
    };
    reader.readAsText(file);
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setCsvText(e.target.value);
    if (e.target.value.trim()) {
      parseCSV(e.target.value);
    } else {
      setHeaders([]);
      setParsedRows([]);
      setPreviewData([]);
    }
  };

  const handleMappingChange = (field: string, header: string) => {
    const newMapping = { ...mapping, [field]: header };
    setMapping(newMapping);
    generatePreview(parsedRows, newMapping);
  };

  // Build the preview list and trigger background metadata queries
  const generatePreview = (rows: ParsedRow[], currentMap: Record<string, string>) => {
    const previewList = rows.map((row) => {
      const name = row[currentMap.name] || 'Unnamed Asset';
      
      // Parse type
      let type: InvestmentType = defaultType;
      const typeRaw = (row[currentMap.type] || '').toLowerCase();
      if (typeRaw.includes('stock') || typeRaw.includes('equity') || typeRaw.includes('share')) type = 'stock';
      else if (typeRaw.includes('fund') || typeRaw.includes('mutual') || typeRaw.includes('mf')) type = 'mutual_fund';
      else if (typeRaw.includes('fd') || typeRaw.includes('deposit') || typeRaw.includes('fixed')) type = 'fd';
      else if (typeRaw.includes('save') || typeRaw.includes('account') || typeRaw.includes('bank')) type = 'savings';
      else if (typeRaw.trim()) type = 'other';

      // Parse region
      let region: InvestmentRegion = defaultRegion;
      const regionRaw = (row[currentMap.region] || '').toLowerCase();
      if (regionRaw.includes('india') || regionRaw.includes('in')) region = 'India';
      else if (regionRaw.includes('europe') || regionRaw.includes('eu')) region = 'Europe';
      else if (regionRaw.trim()) region = 'Other';

      // Parse currency
      let currency: InvestmentCurrency = defaultCurrency;
      const currRaw = (row[currentMap.currency] || '').toUpperCase();
      if (currRaw.includes('INR') || currRaw.includes('RS') || currRaw.includes('₹')) currency = 'INR';
      else if (currRaw.includes('EUR') || currRaw.includes('€')) currency = 'EUR';
      else if (currRaw.includes('USD') || currRaw.includes('$')) currency = 'USD';

      // Parse amounts
      const cleanNum = (str: string) => parseFloat(str.replace(/[^0-9.-]/g, '')) || 0;
      const amountInvested = currentMap.amountInvested ? cleanNum(row[currentMap.amountInvested]) : 0;
      const currentValue = currentMap.currentValue ? cleanNum(row[currentMap.currentValue]) : amountInvested;

      const institution = row[currentMap.institution] || defaultInstitution;
      const notes = row[currentMap.notes] || '';
      
      const ticker = currentMap.ticker ? (row[currentMap.ticker] || '').trim() : '';
      const schemeCodeRaw = currentMap.schemeCode ? row[currentMap.schemeCode] : '';
      const schemeCode = schemeCodeRaw ? parseInt(schemeCodeRaw) : undefined;

      return {
        name,
        type,
        region,
        currency,
        amountInvested,
        currentValue,
        institution,
        notes,
        ticker,
        schemeCode
      };
    });

    setPreviewData(previewList);

    // Trigger background lookup of missing mutual fund scheme codes
    const hasMissingCodes = previewList.some(item => item.type === 'mutual_fund' && !item.schemeCode);
    if (hasMissingCodes) {
      resolveMissingSchemeCodes(previewList);
    }
  };

  // Background resolver for AMFI codes
  const resolveMissingSchemeCodes = async (items: any[]) => {
    setIsResolvingMetadata(true);
    const updated = [...items];
    let changed = false;

    // Resolve in small batches to prevent rate limits
    for (let i = 0; i < updated.length; i++) {
      const item = updated[i];
      if (item.type === 'mutual_fund' && !item.schemeCode) {
        try {
          const query = item.name.replace(/growth|dividend|direct|regular|plan|idcw/gi, '').trim();
          const response = await fetch(`https://api.mfapi.in/mf/search?q=${encodeURIComponent(query)}`);
          if (response.ok) {
            const data = await response.json();
            if (data && data.length > 0) {
              const code = parseInt(data[0].schemeCode);
              if (code) {
                updated[i] = { ...item, schemeCode: code };
                changed = true;
              }
            }
          }
          // Brief sleep to be polite to the public API
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (err) {
          console.warn("Could not automatically resolve AMFI code for", item.name, err);
        }
      }
    }

    if (changed) {
      setPreviewData(updated);
    }
    setIsResolvingMetadata(false);
  };

  // AI Prompt Parser using Gemini
  const handleAIParsing = async () => {
    if (!aiPrompt.trim()) return;
    setIsAiParsing(true);
    setStatus({ type: 'idle', message: '' });

    try {
      const apiKey = await loadGeminiKey();
      if (!apiKey) {
        throw new Error("Gemini API key is not configured. Please add a key in the Aura AI Advisor settings first.");
      }

      const systemInstruction = `
        You are an expert investment transaction extractor. Parse the unstructured text (e.g. natural language, copy-pasted email confirmations, bank alerts, trade ledgers) and extract a list of investments.
        Format your response ONLY as a raw JSON array containing objects matching this schema:
        {
          "name": string (name of the asset, e.g. "Parag Parikh Flexi Cap Fund", "HDFC Bank Shares"),
          "type": "stock" | "mutual_fund" | "fd" | "savings" | "other",
          "region": "India" | "Europe" | "Other" (India is standard if currency is INR or RS. Europe if EUR. Guess region if not specified),
          "currency": "INR" | "EUR" | "USD",
          "amountInvested": number (total cost or amount originally spent),
          "currentValue": number (current market value. If not specified, default to amountInvested),
          "units": number (optional, number of units/shares purchased),
          "purchasePrice": number (optional, cost per unit),
          "interestRate": number (optional, interest rate percentage e.g. 7.15 for FDs),
          "startDate": string (optional, YYYY-MM-DD),
          "maturityDate": string (optional, YYYY-MM-DD),
          "institution": string (bank or broker name, e.g. "Zerodha", "SBI", "Trade Republic", default to "Unknown" if not mentioned),
          "notes": string (optional, notes containing transaction details),
          "ticker": string (optional, for stocks, e.g. "RELIANCE.NS"),
          "schemeCode": number (optional, for mutual funds, AMFI scheme code if known)
        }
        Return ONLY the raw JSON string. Do not wrap it in backticks, do not include "json" markup, and do not write any explanation.
      `;

      const modelName = "gemini-2.5-flash";
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: aiPrompt }] }],
          systemInstruction: { parts: [{ text: systemInstruction }] }
        })
      });

      if (!response.ok) {
        throw new Error(`Gemini API returned status code ${response.status}`);
      }

      const result = await response.json();
      const textResponse = result.candidates?.[0]?.content?.parts?.[0]?.text || '';
      
      // Clean potential JSON markdown blocks if Gemini ignored instructions
      const cleanJsonText = textResponse.replace(/```json|```/gi, '').trim();
      const parsedData = JSON.parse(cleanJsonText);

      if (Array.isArray(parsedData)) {
        setPreviewData(parsedData);
        setStatus({ type: 'success', message: `Extracted ${parsedData.length} records from prompt! Review them below.` });
        
        // Trigger AMFI lookup for any AI-imported funds lacking codes
        const hasMissingCodes = parsedData.some(item => item.type === 'mutual_fund' && !item.schemeCode);
        if (hasMissingCodes) {
          resolveMissingSchemeCodes(parsedData);
        }
      } else {
        throw new Error("Invalid response format. AI did not return a JSON array.");
      }
    } catch (err: any) {
      console.error(err);
      setStatus({ type: 'error', message: err.message || 'Failed to extract investments using AI.' });
    } finally {
      setIsAiParsing(false);
    }
  };

  // Editable Preview cell callback
  const handlePreviewItemChange = (index: number, key: string, value: any) => {
    const updated = [...previewData];
    updated[index] = { ...updated[index], [key]: value };
    setPreviewData(updated);
  };

  const handleRemovePreviewItem = (index: number) => {
    setPreviewData(previewData.filter((_, idx) => idx !== index));
  };

  // Commit batch of investments to Firestore
  const handleBulkUpload = async () => {
    if (previewData.length === 0) return;
    setStatus({ type: 'uploading', message: 'Saving investments to your cloud portfolio...' });

    try {
      const batch = writeBatch(db);
      
      previewData.forEach((item) => {
        const colRef = collection(db, `portfolios/${portfolioId}/investments`);
        const docRef = doc(colRef);
        
        // Clean undefined elements to satisfy Firestore
        const cleanItem: any = {};
        Object.entries(item).forEach(([key, val]) => {
          if (val !== undefined && val !== null) {
            cleanItem[key] = val;
          }
        });

        batch.set(docRef, {
          ...cleanItem,
          id: docRef.id,
          portfolioId,
          createdAt: new Date(),
          updatedAt: new Date()
        });
      });

      await batch.commit();
      
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.8 },
        colors: ['#10B981', '#00F2FE', '#8A57FE']
      });

      setStatus({ type: 'success', message: `Successfully imported ${previewData.length} investments!` });
      setCsvText('');
      setAiPrompt('');
      setParsedRows([]);
      setPreviewData([]);
      onImportSuccess();
    } catch (err: any) {
      console.error(err);
      setStatus({ type: 'error', message: err.message || 'Failed to complete bulk upload.' });
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h2 className="text-3xl font-extrabold tracking-tight">Bulk Ingestion Hub</h2>
        <p className="text-secondary text-sm">Ingest new assets into your portfolio using file uploads or AI-powered parsing.</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 p-1 bg-white/[0.02] border border-white/5 rounded-xl w-fit shrink-0">
        <button
          onClick={() => { setImportMode('csv'); setStatus({ type: 'idle', message: '' }); }}
          className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg transition-all duration-200 ${
            importMode === 'csv' ? 'bg-white/5 text-teal-400' : 'text-secondary hover:text-white'
          }`}
        >
          <FileSpreadsheet className="w-3.5 h-3.5" />
          CSV File Upload
        </button>
        <button
          onClick={() => { setImportMode('ai'); setStatus({ type: 'idle', message: '' }); }}
          className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg transition-all duration-200 ${
            importMode === 'ai' ? 'bg-white/5 text-teal-400' : 'text-secondary hover:text-white'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5" />
          Aura AI Smart Ingest
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* CSV Mode Inputs */}
        {importMode === 'csv' && (
          <>
            <div className="lg:col-span-2 space-y-4">
              {/* File Dropzone */}
              <div 
                onDragEnter={handleDrag}
                onDragOver={handleDrag}
                onDragLeave={handleDrag}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`glass-panel p-8 border-2 border-dashed rounded-2xl flex flex-col items-center justify-center gap-3 cursor-pointer transition-all duration-300 ${
                  dragActive 
                    ? 'border-teal-500 bg-teal-500/5 shadow-lg shadow-teal-500/5' 
                    : 'border-white/5 hover:border-white/20 bg-white/[0.01]'
                }`}
              >
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleFileInput} 
                  accept=".csv" 
                  className="hidden" 
                />
                <div className="w-12 h-12 rounded-xl bg-teal-500/10 flex items-center justify-center text-teal-400">
                  <Upload className="w-6 h-6 animate-bounce" />
                </div>
                <div className="text-center space-y-1">
                  <p className="text-sm font-semibold">Drag & drop your CSV file here</p>
                  <p className="text-xs text-secondary">or click to browse your local filesystem</p>
                </div>
              </div>

              {/* Raw CSV Text Ingestion */}
              <div className="glass-panel p-6 border-white/5 space-y-4">
                <div className="flex items-center justify-between font-semibold">
                  <span className="flex items-center gap-2 text-sm">
                    <FileSpreadsheet className="w-4.5 h-4.5 text-teal-400" />
                    Or Paste CSV Data Directly
                  </span>
                  {csvText && (
                    <button 
                      onClick={() => { setCsvText(''); setHeaders([]); setParsedRows([]); setPreviewData([]); }}
                      className="text-[10px] text-red-400 hover:text-red-300 font-bold uppercase tracking-wider"
                    >
                      Clear Data
                    </button>
                  )}
                </div>
                
                <textarea
                  rows={6}
                  className="font-mono text-xs bg-black/50 p-4 border border-white/5 rounded-xl resize-none w-full"
                  placeholder="Asset Name,Asset Type,Region,Currency,Amount Invested,Current Value,Institution,Notes&#10;HDFC Shares,Stock,India,INR,15000,18500,Zerodha,Purchase July 2024&#10;Allianz Bond,Mutual Fund,Europe,EUR,500,530,Trade Republic,Monthly plan"
                  value={csvText}
                  onChange={handleTextChange}
                />

                <div className="text-[11px] text-muted leading-relaxed flex gap-2 items-start bg-white/[0.01] p-3 rounded-lg border border-white/5">
                  <HelpCircle className="w-4 h-4 text-teal-400 shrink-0 mt-0.5" />
                  <div>
                    Ensure the first line contains header keys. Missing parameters can be filled using defaults or mapped to existing columns on the right.
                  </div>
                </div>
              </div>
            </div>

            {/* Column Mapper panel */}
            <div className="space-y-4">
              <div className="glass-panel p-6 border-white/5 space-y-4">
                <h3 className="text-lg font-bold flex items-center gap-2">
                  <Upload className="w-4 h-4 text-indigo-400" />
                  Column Mapper
                </h3>

                {headers.length === 0 ? (
                  <div className="text-xs text-secondary py-12 text-center border border-dashed border-white/5 rounded-xl">
                    Import a CSV file or paste raw text to configure mappings.
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Field Map Selectors */}
                    <div className="space-y-2.5 max-h-[300px] overflow-y-auto pr-1">
                      {[
                        { key: 'name', label: 'Asset Name (Required)', required: true },
                        { key: 'amountInvested', label: 'Amount Invested (Required)', required: true },
                        { key: 'currentValue', label: 'Current Value (Optional)' },
                        { key: 'type', label: 'Asset Type (Optional)' },
                        { key: 'region', label: 'Region (Optional)' },
                        { key: 'currency', label: 'Currency (Optional)' },
                        { key: 'institution', label: 'Institution (Optional)' },
                        { key: 'ticker', label: 'Ticker Symbol (For Stocks)' },
                        { key: 'schemeCode', label: 'AMFI Scheme Code (For Mutual Funds)' },
                        { key: 'notes', label: 'Notes (Optional)' }
                      ].map((field) => (
                        <div key={field.key} className="flex flex-col">
                          <label className="text-[10px] font-semibold text-secondary mb-1">
                            {field.label}
                          </label>
                          <select
                            className="py-1 px-3 text-xs bg-black/45"
                            value={mapping[field.key]}
                            onChange={(e) => handleMappingChange(field.key, e.target.value)}
                          >
                            <option value="">-- Use Default Override --</option>
                            {headers.map((h) => (
                              <option key={h} value={h}>{h}</option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </div>

                    {/* Defaults Overrides */}
                    <div className="pt-4 border-t border-white/5 space-y-3">
                      <div className="text-[10px] font-bold text-secondary uppercase tracking-wider">Default Overrides</div>
                      
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[9px] text-secondary">Default Type</label>
                          <select 
                            className="py-1 px-2 text-[10px]" 
                            value={defaultType} 
                            onChange={(e) => { setDefaultType(e.target.value as any); generatePreview(parsedRows, mapping); }}
                          >
                            <option value="stock">Stock</option>
                            <option value="mutual_fund">Mutual Fund</option>
                            <option value="fd">Fixed Deposit</option>
                            <option value="savings">Savings Account</option>
                            <option value="other">Other Savings</option>
                          </select>
                        </div>
                        <div>
                          <label className="text-[9px] text-secondary">Default Region</label>
                          <select 
                            className="py-1 px-2 text-[10px]" 
                            value={defaultRegion} 
                            onChange={(e) => { setDefaultRegion(e.target.value as any); generatePreview(parsedRows, mapping); }}
                          >
                            <option value="India">India</option>
                            <option value="Europe">Europe</option>
                            <option value="Other">Other</option>
                          </select>
                        </div>
                        <div>
                          <label className="text-[9px] text-secondary">Default Currency</label>
                          <select 
                            className="py-1 px-2 text-[10px]" 
                            value={defaultCurrency} 
                            onChange={(e) => { setDefaultCurrency(e.target.value as any); generatePreview(parsedRows, mapping); }}
                          >
                            <option value="INR">INR (₹)</option>
                            <option value="EUR">EUR (€)</option>
                            <option value="USD">USD ($)</option>
                          </select>
                        </div>
                        <div>
                          <label className="text-[9px] text-secondary">Default Institution</label>
                          <input 
                            type="text"
                            className="py-1 px-2 text-[10px] bg-black/40" 
                            value={defaultInstitution} 
                            onChange={(e) => { setDefaultInstitution(e.target.value); generatePreview(parsedRows, mapping); }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {/* AI Mode Inputs */}
        {importMode === 'ai' && (
          <div className="lg:col-span-3 space-y-4">
            <div className="glass-panel p-6 border-white/5 space-y-4">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Sparkles className="w-5 h-5 text-teal-400 animate-pulse" />
                <span>Ask Aura to Ingest Transactions</span>
              </div>

              {/* Prompt Pills */}
              <div className="flex flex-wrap gap-2">
                {examplePrompts.map((p, idx) => (
                  <button
                    key={idx}
                    onClick={() => setAiPrompt(p.text)}
                    className="px-3 py-1 bg-white/[0.02] border border-white/5 rounded-full text-[10px] text-secondary hover:text-white hover:bg-white/5 transition-colors font-semibold"
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              <textarea
                rows={5}
                className="font-sans text-sm bg-black/50 p-4 border border-white/5 rounded-xl resize-none w-full"
                placeholder="Example: I opened a Fixed Deposit of 1,00,000 INR at SBI at 7.2% for 1 year starting from 2026-05-15. Also bought 10 units of Parag Parikh Flexi Cap Fund on Groww."
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
              />

              <div className="flex justify-between items-center pt-2">
                <div className="text-[10px] text-secondary max-w-[70%]">
                  💡 You can paste emails from Groww, transaction SMS alerts, ledger logs, or just tell Aura what you bought.
                </div>
                <button
                  onClick={handleAIParsing}
                  disabled={isAiParsing || !aiPrompt.trim()}
                  className="btn btn-primary flex items-center gap-2 text-xs py-2 px-5"
                >
                  {isAiParsing ? (
                    <>
                      <RotateCw className="w-3.5 h-3.5 animate-spin" />
                      Parsing...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5" />
                      Analyze with Aura
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Progress / Status Block */}
      {status.type !== 'idle' && (
        <div className={`p-4 rounded-xl flex items-center gap-3 border ${
          status.type === 'success' ? 'bg-green-950/20 border-green-500/20 text-green-400' :
          status.type === 'error' ? 'bg-red-950/20 border-red-500/20 text-red-400' :
          'bg-indigo-950/20 border-indigo-500/20 text-indigo-400'
        }`}>
          {status.type === 'success' && <CheckCircle2 className="w-5 h-5 shrink-0" />}
          {status.type === 'error' && <AlertTriangle className="w-5 h-5 shrink-0" />}
          {status.type === 'uploading' && <span className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin shrink-0"></span>}
          <span className="text-sm font-medium">{status.message}</span>
        </div>
      )}

      {/* Inline Editable Preview Grid */}
      {previewData.length > 0 && (
        <div className="glass-panel p-6 border-white/5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <h3 className="text-lg font-bold flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-teal-400"></span>
                Verify Assets ({previewData.length} records)
              </h3>
              {isResolvingMetadata && (
                <div className="text-[10px] text-teal-400 flex items-center gap-1.5 animate-pulse">
                  <RotateCw className="w-3 h-3 animate-spin" />
                  Auto-searching missing mutual fund AMFI codes in background...
                </div>
              )}
            </div>
            <button
              onClick={handleBulkUpload}
              className="btn btn-primary text-xs py-2 px-6"
              disabled={status.type === 'uploading'}
            >
              Confirm Import
            </button>
          </div>

          <div className="overflow-x-auto border border-white/5 rounded-xl">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-white/[0.02] border-b border-white/5 font-semibold text-secondary">
                  <th className="p-3 w-[25%]">Asset Name</th>
                  <th className="p-3 w-[12%]">Type</th>
                  <th className="p-3 w-[10%]">Region</th>
                  <th className="p-3 w-[10%]">Currency</th>
                  <th className="p-3 w-[12%] text-right">Invested Value</th>
                  <th className="p-3 w-[12%] text-right">Current Value</th>
                  <th className="p-3 w-[12%]">AMFI Code / Ticker</th>
                  <th className="p-3 w-[7%] text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {previewData.map((item, idx) => (
                  <tr key={idx} className="hover:bg-white/[0.01]">
                    {/* Editable Name */}
                    <td className="p-2">
                      <input 
                        type="text" 
                        value={item.name} 
                        onChange={(e) => handlePreviewItemChange(idx, 'name', e.target.value)}
                        className="w-full bg-transparent border-0 hover:bg-white/5 focus:bg-black/50 py-1.5 px-2 font-sans font-semibold text-white rounded text-xs" 
                      />
                    </td>
                    
                    {/* Editable Type */}
                    <td className="p-2">
                      <select 
                        value={item.type} 
                        onChange={(e) => handlePreviewItemChange(idx, 'type', e.target.value as any)}
                        className="w-full bg-transparent border-0 hover:bg-white/5 focus:bg-black/50 py-1.5 px-2 rounded text-xs"
                      >
                        <option value="stock">Stock</option>
                        <option value="mutual_fund">Mutual Fund</option>
                        <option value="fd">Fixed Deposit</option>
                        <option value="savings">Savings</option>
                        <option value="other">Other</option>
                      </select>
                    </td>

                    {/* Editable Region */}
                    <td className="p-2">
                      <select 
                        value={item.region} 
                        onChange={(e) => handlePreviewItemChange(idx, 'region', e.target.value as any)}
                        className="w-full bg-transparent border-0 hover:bg-white/5 focus:bg-black/50 py-1.5 px-2 rounded text-xs"
                      >
                        <option value="India">India</option>
                        <option value="Europe">Europe</option>
                        <option value="Other">Other</option>
                      </select>
                    </td>

                    {/* Editable Currency */}
                    <td className="p-2">
                      <select 
                        value={item.currency} 
                        onChange={(e) => handlePreviewItemChange(idx, 'currency', e.target.value as any)}
                        className="w-full bg-transparent border-0 hover:bg-white/5 focus:bg-black/50 py-1.5 px-2 rounded text-xs font-mono"
                      >
                        <option value="INR">INR</option>
                        <option value="EUR">EUR</option>
                        <option value="USD">USD</option>
                      </select>
                    </td>

                    {/* Editable Invested */}
                    <td className="p-2">
                      <input 
                        type="number" 
                        value={item.amountInvested} 
                        onChange={(e) => handlePreviewItemChange(idx, 'amountInvested', parseFloat(e.target.value) || 0)}
                        className="w-full bg-transparent border-0 hover:bg-white/5 focus:bg-black/50 py-1.5 px-2 rounded text-xs font-mono text-right text-white" 
                      />
                    </td>

                    {/* Editable Current Value */}
                    <td className="p-2">
                      <input 
                        type="number" 
                        value={item.currentValue} 
                        onChange={(e) => handlePreviewItemChange(idx, 'currentValue', parseFloat(e.target.value) || 0)}
                        className="w-full bg-transparent border-0 hover:bg-white/5 focus:bg-black/50 py-1.5 px-2 rounded text-xs font-mono text-right text-teal-400 font-bold" 
                      />
                    </td>

                    {/* Editable Scheme Code or Ticker */}
                    <td className="p-2">
                      {item.type === 'mutual_fund' ? (
                        <div className="relative">
                          <input 
                            type="number" 
                            placeholder="AMFI Code" 
                            value={item.schemeCode || ''} 
                            onChange={(e) => handlePreviewItemChange(idx, 'schemeCode', parseInt(e.target.value) || undefined)}
                            className={`w-full bg-transparent border-0 hover:bg-white/5 focus:bg-black/50 py-1.5 px-2 rounded text-xs font-mono text-white ${
                              !item.schemeCode ? 'border border-dashed border-yellow-500/50 bg-yellow-500/5' : ''
                            }`} 
                          />
                          {!item.schemeCode && (
                            <span className="absolute right-2 top-2.5 text-[8px] text-yellow-400 font-sans font-bold uppercase pointer-events-none">Missing</span>
                          )}
                        </div>
                      ) : item.type === 'stock' ? (
                        <div className="relative">
                          <input 
                            type="text" 
                            placeholder="Ticker (e.g. RELIANCE.NS)" 
                            value={item.ticker || ''} 
                            onChange={(e) => handlePreviewItemChange(idx, 'ticker', e.target.value)}
                            className={`w-full bg-transparent border-0 hover:bg-white/5 focus:bg-black/50 py-1.5 px-2 rounded text-xs font-mono text-white ${
                              !item.ticker ? 'border border-dashed border-yellow-500/50 bg-yellow-500/5' : ''
                            }`} 
                          />
                          {!item.ticker && (
                            <span className="absolute right-2 top-2.5 text-[8px] text-yellow-400 font-sans font-bold uppercase pointer-events-none">Missing</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-secondary text-[10px] italic pl-2">N/A</span>
                      )}
                    </td>

                    {/* Delete Preview Row */}
                    <td className="p-2 text-center">
                      <button 
                        onClick={() => handleRemovePreviewItem(idx)}
                        className="text-red-400 hover:text-red-300 p-1 hover:bg-red-500/10 rounded transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
