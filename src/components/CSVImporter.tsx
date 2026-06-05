import React, { useState } from 'react';
import type { InvestmentType, InvestmentRegion, InvestmentCurrency } from '../types';
import { collection, writeBatch, doc } from 'firebase/firestore';
import { db } from '../firebase';
import { FileSpreadsheet, Upload, CheckCircle2, AlertTriangle, HelpCircle } from 'lucide-react';
import confetti from 'canvas-confetti';

interface CSVImporterProps {
  portfolioId: string;
  onImportSuccess: () => void;
}

interface ParsedRow {
  [key: string]: string;
}

export const CSVImporter: React.FC<CSVImporterProps> = ({ portfolioId, onImportSuccess }) => {
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
    notes: ''
  });

  // Global fallbacks if column is missing
  const [defaultType, setDefaultType] = useState<InvestmentType>('stock');
  const [defaultRegion, setDefaultRegion] = useState<InvestmentRegion>('India');
  const [defaultCurrency, setDefaultCurrency] = useState<InvestmentCurrency>('INR');
  const [defaultInstitution, setDefaultInstitution] = useState('My Bank');

  const [previewData, setPreviewData] = useState<any[]>([]);
  const [status, setStatus] = useState<{ type: 'idle' | 'success' | 'error' | 'uploading'; message: string }>({ type: 'idle', message: '' });

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
      const fields = ['name', 'type', 'region', 'currency', 'amountInvested', 'currentValue', 'institution', 'notes'];
      
      fields.forEach((field) => {
        const foundHeader = parsedHeaders.find((h) => {
          const lh = h.toLowerCase();
          const lf = field.toLowerCase();
          return lh.includes(lf) || lf.includes(lh) || 
            (field === 'amountInvested' && (lh.includes('invested') || lh.includes('cost') || lh.includes('capital'))) ||
            (field === 'currentValue' && (lh.includes('current') || lh.includes('value') || lh.includes('price'))) ||
            (field === 'institution' && (lh.includes('bank') || lh.includes('broker') || lh.includes('provider')));
        });
        initialMap[field] = foundHeader || '';
      });

      setMapping(initialMap);
      generatePreview(rows, initialMap);
    } catch (err: any) {
      setStatus({ type: 'error', message: err.message || 'Failed to parse CSV' });
    }
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

  // Build the list of items to upload
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

      return {
        name,
        type,
        region,
        currency,
        amountInvested,
        currentValue,
        institution,
        notes
      };
    });

    setPreviewData(previewList);
  };

  const handleBulkUpload = async () => {
    if (previewData.length === 0) return;
    setStatus({ type: 'uploading', message: 'Saving investments in bulk...' });

    try {
      const batch = writeBatch(db);
      
      previewData.forEach((item) => {
        const colRef = collection(db, `portfolios/${portfolioId}/investments`);
        // Generate new document reference with auto ID
        const docRef = doc(colRef);
        batch.set(docRef, {
          ...item,
          id: docRef.id,
          portfolioId,
          createdAt: new Date(),
          updatedAt: new Date()
        });
      });

      await batch.commit();
      
      // Fire confetti animation
      confetti({
        particleCount: 80,
        spread: 60,
        origin: { y: 0.8 },
        colors: ['#00F2FE', '#8A57FE', '#10B981']
      });

      setStatus({ type: 'success', message: `Successfully imported ${previewData.length} investments!` });
      setCsvText('');
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
        <h2 className="text-3xl font-extrabold tracking-tight">CSV Importer</h2>
        <p className="text-secondary text-sm">Bulk import your investments using CSV exports from platform files.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Input panel */}
        <div className="lg:col-span-2 space-y-4">
          <div className="glass-panel p-6 border-white/5 space-y-4">
            <div className="flex items-center gap-2 font-semibold">
              <FileSpreadsheet className="w-5 h-5 text-teal-400" />
              <span>Paste CSV Data</span>
            </div>
            
            <textarea
              rows={10}
              className="font-mono text-xs bg-black/50 p-4 border-white/5 resize-none w-full"
              placeholder="Asset Name,Asset Type,Region,Currency,Amount Invested,Current Value,Institution,Notes&#10;HDFC Shares,Stock,India,INR,15000,18500,Zerodha,Purchase July 2024&#10;Allianz Bond,Mutual Fund,Europe,EUR,500,530,Trade Republic,Monthly plan&#10;SBI Fixed Deposit,FD,India,INR,100000,105300,SBI,1 Year Term"
              value={csvText}
              onChange={handleTextChange}
            />

            <div className="text-xs text-muted leading-relaxed flex gap-2 items-start bg-white/[0.01] p-3 rounded-lg border border-white/5">
              <HelpCircle className="w-4 h-4 text-teal-400 shrink-0 mt-0.5" />
              <div>
                <strong>Tips:</strong> Make sure the first line contains headers (e.g. Asset Name, Cost, etc.). Any fields that are not in the CSV columns can be assigned standard default values in the mapping selectors on the right.
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
              <div className="text-sm text-secondary py-6 text-center border-2 border-dashed border-white/5 rounded-xl">
                Paste CSV data on the left to map headers.
              </div>
            ) : (
              <div className="space-y-4">
                {/* Field Map Selectors */}
                <div className="space-y-3">
                  {[
                    { key: 'name', label: 'Asset Name (Required)', required: true },
                    { key: 'amountInvested', label: 'Amount Invested (Required)', required: true },
                    { key: 'currentValue', label: 'Current Value (Optional)' },
                    { key: 'type', label: 'Asset Type (Optional)' },
                    { key: 'region', label: 'Region (Optional)' },
                    { key: 'currency', label: 'Currency (Optional)' },
                    { key: 'institution', label: 'Institution (Optional)' },
                    { key: 'notes', label: 'Notes (Optional)' }
                  ].map((field) => (
                    <div key={field.key} className="flex flex-col">
                      <label className="text-[11px] font-semibold text-secondary lowercase tracking-wide mb-1 flex items-center justify-between">
                        <span>{field.label}</span>
                      </label>
                      <select
                        className="py-1 px-3 text-xs bg-black/45"
                        value={mapping[field.key]}
                        onChange={(e) => handleMappingChange(field.key, e.target.value)}
                      >
                        <option value="">-- Ignore (Use Default) --</option>
                        {headers.map((h) => (
                          <option key={h} value={h}>{h}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>

                {/* Defaults Overrides */}
                <div className="pt-4 border-t border-white/5 space-y-3">
                  <div className="text-xs font-bold text-secondary uppercase tracking-wider">Default Overrides</div>
                  
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px]">Default Type</label>
                      <select 
                        className="py-1 px-2 text-[11px]" 
                        value={defaultType} 
                        onChange={(e) => { setDefaultType(e.target.value as any); parseCSV(csvText); }}
                      >
                        <option value="stock">Stock</option>
                        <option value="mutual_fund">Mutual Fund</option>
                        <option value="fd">Fixed Deposit</option>
                        <option value="savings">Savings Account</option>
                        <option value="other">Other Savings</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px]">Default Region</label>
                      <select 
                        className="py-1 px-2 text-[11px]" 
                        value={defaultRegion} 
                        onChange={(e) => { setDefaultRegion(e.target.value as any); parseCSV(csvText); }}
                      >
                        <option value="India">India</option>
                        <option value="Europe">Europe</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px]">Default Currency</label>
                      <select 
                        className="py-1 px-2 text-[11px]" 
                        value={defaultCurrency} 
                        onChange={(e) => { setDefaultCurrency(e.target.value as any); parseCSV(csvText); }}
                      >
                        <option value="INR">INR (₹)</option>
                        <option value="EUR">EUR (€)</option>
                        <option value="USD">USD ($)</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px]">Default Bank</label>
                      <input 
                        type="text"
                        className="py-1 px-2 text-[11px]" 
                        value={defaultInstitution} 
                        onChange={(e) => { setDefaultInstitution(e.target.value); parseCSV(csvText); }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
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

      {/* Visual Preview Grid */}
      {previewData.length > 0 && (
        <div className="glass-panel p-6 border-white/5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-teal-400"></span>
              Bulk Upload Preview ({previewData.length} records)
            </h3>
            <button
              onClick={handleBulkUpload}
              className="btn btn-primary"
              disabled={status.type === 'uploading'}
            >
              Confirm Import
            </button>
          </div>

          <div className="overflow-x-auto max-h-[300px] border border-white/5 rounded-lg">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-white/[0.02] border-b border-white/5 font-semibold text-secondary">
                  <th className="p-3">Asset Name</th>
                  <th className="p-3">Type</th>
                  <th className="p-3">Region</th>
                  <th className="p-3">Currency</th>
                  <th className="p-3 text-right">Invested Value</th>
                  <th className="p-3 text-right">Current Value</th>
                  <th className="p-3">Institution</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-[11px] font-mono">
                {previewData.map((item, idx) => (
                  <tr key={idx} className="hover:bg-white/[0.01]">
                    <td className="p-3 text-white font-sans font-semibold">{item.name}</td>
                    <td className="p-3 capitalize">{item.type}</td>
                    <td className="p-3">{item.region}</td>
                    <td className="p-3">{item.currency}</td>
                    <td className="p-3 text-right">{item.amountInvested.toLocaleString()}</td>
                    <td className="p-3 text-right text-white font-bold">{item.currentValue.toLocaleString()}</td>
                    <td className="p-3 font-sans text-secondary">{item.institution}</td>
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
