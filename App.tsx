
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  BusinessConfig, SavedWidget, 
  AppTabType, ManualPriceItem, RecommendedService 
} from './types.ts';
import AIWidget from './components/AIWidget.tsx';
import { 
  performMasterScan
} from './services/geminiService.ts';
import { 
  supabase, isSupabaseConfigured, updateSupabaseConfig, 
  getSupabaseConfig 
} from './services/supabaseClient.ts';

const INITIAL_CONFIG: BusinessConfig = {
  name: 'Apex Roofing Local',
  industry: 'Roofing & Exterior Siding',
  primaryColor: '#b91c1c',
  headerTitle: 'RoofBot Estimator',
  headerSubtitle: 'Instant Roofing Quotes',
  profilePic: 'https://images.unsplash.com/photo-1632759145351-1d592919f522?q=80&w=256&h=256&auto=format&fit=crop',
  hoverTitle: 'Get Roof Quote',
  hoverTitleBgColor: '#0f172a',
  widgetIcon: 'home',
  services: ['Asphalt Shingle Roof', 'Metal Roofing', 'Roof Repair', 'Gutter Installation', 'Skylight Replacement'],
  locationContext: 'Serving the greater metropolitan area',
  pricingRules: `
    - Base Price Per Square (Low): $450
    - Base Price Per Square (High): $550
    - Waste Factor Multiplier: 1.35 (Converts Floor SqFt to Roof SqFt)
    - Steep Pitch Surcharge: 20% (Multiplier 1.2)
    - Metal Material Multiplier: 2.5x (relative to Shingles)
    - Minimum Job Price: $6,000
    - Logic: (Floor SqFt * 1.35 / 100) = Total Squares. Estimate = Squares * Base. Apply Pitch/Material factors.
  `,
  pricingKnowledgeBase: 'Standard architectural shingles are the baseline. Metal roofs (standing seam) are premium. Pricing includes tear-off and disposal of one layer.',
  customAgentInstruction: `
    You are "RoofBot," a friendly, professional, and helpful AI Estimator for Apex Roofing.
    Your goal is to provide website visitors with a ballpark cost estimate.
    
    CRITICAL MATH STEPS:
    1. Calculate Roof Squares: (Floor SqFt * 1.35) / 100. Round up.
    2. Base Range: Squares * $450 (Low) and Squares * $550 (High).
    3. Apply Pitch: If "Steep", multiply by 1.2.
    4. Apply Material: If "Metal", multiply by 2.5.
    5. Check Minimum: Minimum estimate is $6,000.
    
    Always present results as a RANGE. Never a single number.
  `,
  googleSheetUrl: '',
  useSheetData: false,
  manualPriceList: [
    { id: '1', label: 'Asphalt Shingle (per square)', price: '$450 - $550' },
    { id: '2', label: 'Metal Standing Seam (per square)', price: '$1,125 - $1,375' },
    { id: '3', label: 'Gutter Guard (per linear foot)', price: '$15' },
    { id: '4', label: 'Roof Tune-up / Maintenance', price: '$495' }
  ],
  curatedRecommendations: [
    { id: 'upsell-1', label: 'Seamless Gutters', description: 'Upgrade to 6" seamless aluminum gutters with your new roof.', suggestedPrice: '$1,250', isApproved: true },
    { id: 'upsell-2', label: 'Ridge Vent Upgrade', description: 'Enhanced attic ventilation to extend shingle life.', suggestedPrice: '$650', isApproved: true },
    { id: 'upsell-3', label: 'Skylight Replacement', description: 'Replace old skylights while the roof is open to prevent future leaks.', suggestedPrice: '$1,800', isApproved: true }
  ],
  suggestedQuestions: ['Estimate for 2000 sq ft home?', 'How much for a metal roof?', 'What is the cost for a steep roof?', 'Do you have financing?'],
  intelligenceSources: [],
  leadGenConfig: {
    enabled: true,
    destination: 'email',
    targetEmail: 'sales@apexroofing.com',
    resendApiKey: '',
    webhookUrl: '',
    slackWebhookUrl: '',
    twilioConfig: { accountSid: '', authToken: '', fromNumber: '', toNumber: '' },
    fields: {
      name: { visible: true, required: true },
      email: { visible: true, required: true },
      phone: { visible: true, required: true },
      city: { visible: true, required: false },
      company: { visible: false, required: false },
      notes: { visible: true, required: false },
      customField: { visible: false, required: false },
      serviceType: { visible: true, required: true },
      date: { visible: true, required: false },
      time: { visible: false, required: false },
    }
  },
  defaultLanguage: 'en',
  supportedLanguages: ['en', 'es'],
};

const CREW_AGENTS = [
  { name: 'Digital Investigator', role: 'Business identity & search extraction', icon: '🔍' },
  { name: 'Market Analyst', role: 'Regional trends & competitor research', icon: '📊' },
  { name: 'Pricing Strategist', role: 'Logical cost modeling & rate engine', icon: '💰' },
  { name: 'Content Copywriter', role: 'High-conversion hooks & branding', icon: '✍️' },
];

const App: React.FC = () => {
  const [config, setConfig] = useState<BusinessConfig>(INITIAL_CONFIG);
  const [activeTab, setActiveTab] = useState<AppTabType>('dashboard');
  const [isScanningUrl, setIsScanningUrl] = useState(false);
  const [isSyncingSheet, setIsSyncingSheet] = useState(false);
  const [urlToScan, setUrlToScan] = useState('');
  const [savedWidgets, setSavedWidgets] = useState<SavedWidget[]>([]);
  const [leads, setLeads] = useState<any[]>([]);
  const [activeWidgetId, setActiveWidgetId] = useState<string | null>(null);
  const [cloudEnabled, setCloudEnabled] = useState(isSupabaseConfigured());
  const [tempSupabaseUrl, setTempSupabaseUrl] = useState(getSupabaseConfig().url || '');
  const [tempSupabaseKey, setTempSupabaseKey] = useState(getSupabaseConfig().key || '');

  const lastSyncedUrl = useRef<string>('');

  useEffect(() => { 
    if (cloudEnabled) {
      fetchWidgets();
      fetchLeads();
    }
  }, [cloudEnabled]);

  const fetchWidgets = async () => {
    try {
      const { data, error } = await supabase.from('widgets').select('*').order('updated_at', { ascending: false });
      if (!error) setSavedWidgets(data || []);
    } catch (e) { console.error(e); }
  };

  const fetchLeads = async () => {
    try {
      const { data, error } = await supabase.from('leads').select('*').order('created_at', { ascending: false });
      if (!error) setLeads(data || []);
    } catch (e) { console.error(e); }
  };

  const parseCSV = (str: string) => {
    const arr = [];
    let quote = false;
    let row: string[] = [''];
    let col = 0;
    for (let c = 0; c < str.length; c++) {
      const char = str[c];
      const next = str[c+1];
      if (char === '"' && quote && next === '"') { row[col] += char; c++; }
      else if (char === '"') { quote = !quote; }
      else if (char === ',' && !quote) { row[++col] = ''; }
      else if (char === '\n' && !quote) { arr.push(row); row = ['']; col = 0; }
      else if (char === '\r' && !quote) { /* skip */ }
      else { row[col] += char; }
    }
    if (row.length > 1 || row[0] !== '') arr.push(row);
    return arr;
  };

  const syncGoogleSheet = useCallback(async (url: string) => {
    if (!url || !url.includes('docs.google.com/spreadsheets')) return;
    setIsSyncingSheet(true);
    try {
      let csvUrl = '';
      if (url.includes('/d/e/')) {
        csvUrl = url.replace(/\/pubhtml($|\?|#)/, '/pub$1');
        if (!csvUrl.includes('output=csv')) {
          csvUrl += (csvUrl.includes('?') ? '&' : '?') + 'output=csv';
        }
      } else {
        const idMatch = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
        const sheetId = idMatch ? idMatch[1] : null;
        if (!sheetId) throw new Error("Could not parse Spreadsheet ID.");
        csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=0`;
      }

      const response = await fetch(csvUrl, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Google Sheets access denied (Status: ${response.status}).`);
      
      const text = await response.text();
      if (text.trim().toLowerCase().startsWith('<!doctype html') || text.trim().toLowerCase().includes('<html')) {
        throw new Error("Access Error: The link is private.");
      }

      const allRows = parseCSV(text);
      const rows = allRows.filter(r => r.some(cell => cell && cell.trim() !== ''));
      if (rows.length < 1) throw new Error("Spreadsheet appears to be empty.");

      const newManualPrices: ManualPriceItem[] = [];
      const newUpsells: RecommendedService[] = [];

      const firstRow = rows[0].map(c => (c || '').toLowerCase().trim());
      const hasHeader = firstRow.includes('type') || firstRow.includes('label') || firstRow.includes('price');
      const startIndex = hasHeader ? 1 : 0;

      for (let i = startIndex; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length < 2) continue;
        const typeStr = (row[0] || 'Core').trim();
        const label = (row[1] || '').trim();
        const price = (row[2] || '').trim();
        const description = (row[3] || '').trim();

        if (!label) continue;

        const isAddon = typeStr.toLowerCase().includes('add-on') || 
                        typeStr.toLowerCase().includes('upsell') || 
                        typeStr.toLowerCase().includes('recommend');

        if (isAddon) {
          newUpsells.push({ 
            id: `addon-${i}-${Date.now()}`, 
            label, 
            description: description || 'Professional add-on service.', 
            suggestedPrice: price, 
            isApproved: true 
          });
        } else {
          newManualPrices.push({ 
            id: `core-${i}-${Date.now()}`, 
            label, 
            price: price 
          });
        }
      }

      setConfig(prev => ({
        ...prev,
        manualPriceList: newManualPrices.length > 0 ? newManualPrices : prev.manualPriceList,
        curatedRecommendations: newUpsells.length > 0 ? newUpsells : prev.curatedRecommendations,
        useSheetData: true
      }));

      lastSyncedUrl.current = url;
    } catch (error: any) {
      console.error("Sync Failure:", error);
      alert("Sync Error: " + error.message);
    } finally {
      setIsSyncingSheet(false);
    }
  }, []);

  useEffect(() => {
    if (config.googleSheetUrl && config.googleSheetUrl !== lastSyncedUrl.current) {
      const t = setTimeout(() => syncGoogleSheet(config.googleSheetUrl!), 800);
      return () => clearTimeout(t);
    }
  }, [config.googleSheetUrl, syncGoogleSheet]);

  const generateSheetsUrl = () => {
    const data = [
      ["Type", "Label", "Price", "Description"],
      ...config.manualPriceList.map(item => ["Core", item.label, item.price, ""]),
      ...config.curatedRecommendations.map(item => ["Add-on", item.label, item.suggestedPrice, item.description])
    ];
    const csvContent = "data:text/csv;charset=utf-8," + data.map(e => e.map(cell => `"${cell.replace(/"/g, '""')}"`).join(",")).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `${config.name.replace(/\s+/g, '_')}_Pricing.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const saveWidget = async () => {
    if (!cloudEnabled) return alert("Configure Cloud settings first.");
    const data = { name: config.name, config, updated_at: new Date().toISOString() };
    try {
      const result = activeWidgetId ? await supabase.from('widgets').update(data).eq('id', activeWidgetId).select() : await supabase.from('widgets').insert([data]).select();
      if (!result.error) {
        if (result.data) {
          setActiveWidgetId(result.data[0].id);
          setConfig(result.data[0].config);
        }
        fetchWidgets();
        alert("Saved Successfully.");
      } else { throw result.error; }
    } catch (e: any) { alert("Save failed: " + e.message); }
  };

  const handleWebsiteScan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlToScan) return;
    setIsScanningUrl(true);
    try {
      const masterData = await performMasterScan(urlToScan, config.customAgentInstruction);
      setConfig(prev => ({ ...prev, ...masterData }));
      setActiveTab('services');
    } catch (error: any) {
      alert("Scan failed: " + error.message);
    } finally { setIsScanningUrl(false); setUrlToScan(''); }
  };

  const generateEmbedCode = () => {
    // Using 'wid' parameter instead of 'id' to prevent platform parameter collisions
    const url = activeWidgetId 
      ? `${window.location.origin}/?wid=${activeWidgetId}&embed=true`
      : `${window.location.origin}/?config=${encodeURIComponent(JSON.stringify(config))}&embed=true`;
    
    return `<iframe 
  src="${url}" 
  style="position:fixed; bottom:20px; right:20px; width:450px; height:650px; border:none; z-index:2147483647; border-radius:30px; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);"
  allow="microphone"
></iframe>`;
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col md:flex-row font-sans text-slate-900">
      <aside className="w-full md:w-80 bg-slate-900 text-white p-6 flex flex-col shrink-0">
        <div className="flex items-center space-x-3 mb-10">
          <div className="bg-red-600 p-2 rounded-xl shadow-lg">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
          </div>
          <span className="text-xl font-black tracking-tight uppercase">Estimate AI</span>
        </div>
        
        <nav className="flex-1 space-y-1 overflow-y-auto pr-2 custom-scrollbar">
          <button onClick={() => setActiveTab('dashboard')} className={`w-full text-left px-4 py-3 rounded-xl transition-all ${activeTab === 'dashboard' ? 'bg-indigo-600 shadow-lg' : 'text-slate-400 hover:bg-white/5'}`}>Client Profiles</button>
          
          <div className="pt-6 pb-2 px-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">Core Engine</div>
          <button onClick={() => setActiveTab('crew')} className={`w-full text-left px-4 py-3 rounded-xl transition-all ${activeTab === 'crew' ? 'bg-indigo-600 shadow-lg' : 'text-slate-400 hover:bg-white/5'}`}>The AI Crew</button>
          <button onClick={() => setActiveTab('services')} className={`w-full text-left px-4 py-3 rounded-xl transition-all ${activeTab === 'services' ? 'bg-indigo-600 shadow-lg' : 'text-slate-400 hover:bg-white/5'}`}>Services & Pricing</button>
          
          <div className="pt-6 pb-2 px-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">Analytics</div>
          <button onClick={() => setActiveTab('leads')} className={`w-full text-left px-4 py-3 rounded-xl transition-all ${activeTab === 'leads' ? 'bg-indigo-600 shadow-lg' : 'text-slate-400 hover:bg-white/5'}`}>Captured Leads</button>

          <div className="pt-6 pb-2 px-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">Interface</div>
          <button onClick={() => setActiveTab('design')} className={`w-full text-left px-4 py-3 rounded-xl transition-all ${activeTab === 'design' ? 'bg-indigo-600 shadow-lg' : 'text-slate-400 hover:bg-white/5'}`}>Widget Branding</button>
          <button onClick={() => setActiveTab('embed')} className={`w-full text-left px-4 py-3 rounded-xl transition-all ${activeTab === 'embed' ? 'bg-indigo-600 shadow-lg' : 'text-slate-400 hover:bg-white/5'}`}>Embed Code</button>
        </nav>

        <div className="pt-6 border-t border-white/10">
          <button onClick={saveWidget} className="w-full py-4 bg-red-600 rounded-xl font-black text-xs hover:brightness-110 active:scale-95 transition-all shadow-xl shadow-red-500/20">Save Client Profile</button>
          <button onClick={() => setActiveTab('settings')} className="w-full mt-2 py-2 text-[10px] text-slate-500 font-bold uppercase hover:text-white transition-colors">Settings</button>
        </div>
      </aside>

      <main className="flex-1 p-8 md:p-12 overflow-y-auto">
        <div className="max-w-5xl mx-auto pb-20">
          <AnimatePresence mode="wait">
            {activeTab === 'dashboard' && (
              <motion.div key="dashboard" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
                <header><h1 className="text-4xl font-black">Managed Accounts</h1></header>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {savedWidgets.length > 0 ? savedWidgets.map(w => (
                    <div key={w.id} onClick={() => { setConfig(w.config); setActiveWidgetId(w.id); }} className={`p-8 bg-white rounded-[2.5rem] border-2 cursor-pointer transition-all hover:shadow-2xl ${activeWidgetId === w.id ? 'border-indigo-600 shadow-indigo-100 ring-4 ring-indigo-50' : 'border-slate-100 shadow-sm'}`}>
                      <img src={w.config.profilePic} className="w-16 h-16 rounded-2xl mb-4 object-cover border-2 shadow-sm" />
                      <h4 className="font-black text-2xl truncate">{w.config.name}</h4>
                      <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest">{w.config.industry}</p>
                    </div>
                  )) : (
                    <div className="col-span-full py-20 text-center border-2 border-dashed rounded-[3rem] border-slate-200 text-slate-400 font-bold">
                      No profiles found. Use the AI Crew to start.
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {activeTab === 'leads' && (
              <motion.div key="leads" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
                <header><h1 className="text-4xl font-black">Captured Leads</h1></header>
                <div className="bg-white rounded-[2.5rem] border border-slate-100 overflow-hidden shadow-sm">
                  <table className="w-full text-left">
                    <thead className="bg-slate-50 border-b border-slate-100">
                      <tr>
                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Date</th>
                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Customer</th>
                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Contact</th>
                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {leads.length > 0 ? leads.map((l, i) => (
                        <tr key={i} className="hover:bg-slate-50 transition-colors">
                          <td className="px-6 py-4 text-xs font-medium text-slate-500">{new Date(l.created_at).toLocaleDateString()}</td>
                          <td className="px-6 py-4 font-bold text-sm text-slate-800">{l.name}</td>
                          <td className="px-6 py-4 text-xs text-slate-500">{l.email}<br/>{l.phone}</td>
                          <td className="px-6 py-4"><span className="bg-green-100 text-green-700 text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-full">New Lead</span></td>
                        </tr>
                      )) : (
                        <tr>
                          <td colSpan={4} className="px-6 py-12 text-center text-slate-400 font-bold italic">No leads captured yet.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </motion.div>
            )}

            {activeTab === 'crew' && (
              <motion.div key="crew" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-8 py-10">
                <div className="text-center mb-16">
                  <h1 className="text-6xl font-black tracking-tight text-slate-900 mb-4">The AI Crew</h1>
                  <p className="text-slate-500 max-w-xl mx-auto text-xl leading-relaxed font-medium">Four specialized agents collaborating to build your estimation engine.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-16">
                  {CREW_AGENTS.map((agent) => (
                    <div key={agent.name} className="p-6 bg-white rounded-3xl border shadow-sm transition-all hover:shadow-md">
                      <div className="text-3xl mb-3">{agent.icon}</div>
                      <h3 className="font-black text-sm mb-1">{agent.name}</h3>
                      <p className="text-[10px] text-slate-400 font-bold leading-relaxed">{agent.role}</p>
                    </div>
                  ))}
                </div>
                
                <form onSubmit={handleWebsiteScan} className="max-w-xl mx-auto space-y-4">
                  <div className="relative group">
                    <input 
                      type="url" 
                      required 
                      value={urlToScan} 
                      onChange={e => setUrlToScan(e.target.value)} 
                      placeholder="https://prospect-website.com" 
                      className="w-full p-8 bg-white border-4 border-slate-100 rounded-[2.5rem] text-center font-black text-2xl outline-none focus:border-indigo-600 shadow-2xl transition-all" 
                    />
                    <div className="absolute inset-0 rounded-[2.5rem] border-2 border-indigo-600/20 pointer-events-none group-focus-within:border-indigo-600/40" />
                  </div>
                  <button type="submit" disabled={isScanningUrl} className="w-full bg-indigo-600 text-white py-8 rounded-[2.5rem] font-black text-xl shadow-2xl hover:brightness-110 active:scale-95 transition-all flex items-center justify-center gap-4">
                    {isScanningUrl ? (
                      <>
                        <div className="w-6 h-6 border-4 border-white/30 border-t-white rounded-full animate-spin" />
                        <span>Deploying Crew...</span>
                      </>
                    ) : (
                      <>
                        <span>Start Master Scan</span>
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                      </>
                    )}
                  </button>
                </form>
              </motion.div>
            )}

            {activeTab === 'services' && (
              <motion.div key="services" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-12">
                <div className="flex justify-between items-center">
                  <h1 className="text-4xl font-black">Services & Pricing Engine</h1>
                  <button onClick={generateSheetsUrl} className="bg-green-600 text-white px-8 py-4 rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl flex items-center gap-2 hover:brightness-110 active:scale-95 transition-all">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                    Export Template CSV
                  </button>
                </div>

                <section className="bg-white p-10 rounded-[3rem] border shadow-sm space-y-6">
                  <div className="flex items-center gap-3">
                    <div className="bg-indigo-100 p-2 rounded-xl">
                      <svg className="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
                    </div>
                    <h3 className="text-xl font-black">Global Pricing Engine</h3>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">AI Pricing Logic (Rules)</label>
                      <textarea 
                        value={config.pricingRules} 
                        onChange={e => setConfig({...config, pricingRules: e.target.value})} 
                        className="w-full p-5 bg-slate-50 border-2 border-slate-100 rounded-[1.5rem] font-medium text-sm h-32 outline-none focus:border-indigo-600 transition-all shadow-inner"
                        placeholder="e.g. Labor is $95/hr, 1 hour minimum. Materials cost + 15% markup..."
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">Knowledge Base / Specifics</label>
                      <textarea 
                        value={config.pricingKnowledgeBase} 
                        onChange={e => setConfig({...config, pricingKnowledgeBase: e.target.value})} 
                        className="w-full p-5 bg-slate-50 border-2 border-slate-100 rounded-[1.5rem] font-medium text-sm h-32 outline-none focus:border-indigo-600 transition-all shadow-inner"
                        placeholder="Provide details about standard parts, travel fees, or local competitor rates..."
                      />
                    </div>
                  </div>
                </section>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  <section className="bg-white p-10 rounded-[3rem] border shadow-sm space-y-6">
                    <h3 className="text-xl font-black">Core Pricing Items</h3>
                    <div className="space-y-3">
                      {config.manualPriceList.map((item, idx) => (
                        <div key={item.id} className="flex gap-4 bg-slate-50 p-4 rounded-2xl border border-slate-100">
                          <input value={item.label} className="flex-1 bg-transparent font-bold text-sm outline-none" onChange={(e) => {
                            const newList = [...config.manualPriceList];
                            newList[idx].label = e.target.value;
                            setConfig({...config, manualPriceList: newList});
                          }} />
                          <input value={item.price} className="w-24 bg-white px-3 py-1.5 rounded-xl border text-xs font-black text-indigo-600 text-center" onChange={(e) => {
                            const newList = [...config.manualPriceList];
                            newList[idx].price = e.target.value;
                            setConfig({...config, manualPriceList: newList});
                          }} />
                        </div>
                      ))}
                      <button onClick={() => setConfig({...config, manualPriceList: [...config.manualPriceList, {id: Date.now().toString(), label: 'New Item', price: '$0'}]})} className="w-full py-4 border-2 border-dashed rounded-[1.5rem] text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-indigo-600 hover:border-indigo-200 transition-all">Add Core Item</button>
                    </div>
                  </section>
                  
                  <section className="bg-white p-10 rounded-[3rem] border shadow-sm space-y-6">
                    <h3 className="text-xl font-black text-indigo-600">Smart Add-ons (Upsells)</h3>
                    <div className="space-y-3">
                      {config.curatedRecommendations.map((item, idx) => (
                        <div key={item.id} className="bg-slate-50 p-5 rounded-2xl border-2 border-slate-100 transition-all group">
                          <input value={item.label} className="w-full bg-transparent font-black text-sm mb-1 outline-none" onChange={(e) => {
                            const newList = [...config.curatedRecommendations];
                            newList[idx].label = e.target.value;
                            setConfig({...config, curatedRecommendations: newList});
                          }} />
                          <textarea value={item.description} className="w-full bg-transparent text-[10px] text-slate-500 outline-none resize-none font-medium h-12" onChange={(e) => {
                             const newList = [...config.curatedRecommendations];
                             newList[idx].description = e.target.value;
                             setConfig({...config, curatedRecommendations: newList});
                          }} />
                          <div className="flex justify-between items-center mt-2 pt-2 border-t border-slate-200">
                            <input value={item.suggestedPrice} className="w-20 bg-white px-2 py-1.5 rounded-lg border text-[10px] font-black text-indigo-600 text-center" onChange={(e) => {
                               const newList = [...config.curatedRecommendations];
                               newList[idx].suggestedPrice = e.target.value;
                               setConfig({...config, curatedRecommendations: newList});
                            }} />
                            <button onClick={() => {
                               const newList = [...config.curatedRecommendations];
                               newList[idx].isApproved = !newList[idx].isApproved;
                               setConfig({...config, curatedRecommendations: newList});
                            }} className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all ${item.isApproved ? 'bg-green-100 text-green-700 shadow-sm' : 'bg-slate-200 text-slate-500'}`}>
                              {item.isApproved ? 'Active' : 'Draft'}
                            </button>
                          </div>
                        </div>
                      ))}
                      <button onClick={() => setConfig({...config, curatedRecommendations: [...config.curatedRecommendations, {id: Date.now().toString(), label: 'Priority Support', description: 'Skip the line and get a dedicated rep.', suggestedPrice: '$49', isApproved: true}]})} className="w-full py-4 border-2 border-dashed rounded-[1.5rem] text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-indigo-600 hover:border-indigo-200 transition-all">Add Recommended Upsell</button>
                    </div>
                  </section>
                </div>
              </motion.div>
            )}

            {activeTab === 'embed' && (
              <motion.div key="embed" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
                <h1 className="text-4xl font-black">Publish Widget</h1>
                <p className="text-slate-500">Copy this Iframe code to add the Roofing AI Estimator to your website's floating UI.</p>
                <div className="space-y-4">
                  <section className="bg-slate-900 p-8 rounded-[2rem] text-indigo-400 font-mono text-sm overflow-x-auto shadow-2xl relative group">
                    <pre className="whitespace-pre-wrap break-all">{generateEmbedCode()}</pre>
                    <button 
                      onClick={() => {
                        navigator.clipboard.writeText(generateEmbedCode());
                        alert("Iframe code copied!");
                      }}
                      className="absolute top-4 right-4 bg-indigo-600 text-white p-3 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" /></svg>
                    </button>
                  </section>
                  
                  <div className="bg-amber-50 border-l-4 border-amber-500 p-6 rounded-2xl flex items-start space-x-4">
                    <svg className="w-6 h-6 text-amber-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    <p className="text-sm text-amber-800 font-medium">For the best experience, ensure you have saved your client profile to generate a permanent link. If not saved, the embed code will include a raw configuration string.</p>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'design' && (
              <motion.div key="design" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
                <h1 className="text-4xl font-black">Widget Branding</h1>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <section className="bg-white p-10 rounded-[3rem] border shadow-sm space-y-6">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">Primary Brand Color</label>
                      <input type="color" value={config.primaryColor} onChange={e => setConfig({...config, primaryColor: e.target.value})} className="w-full h-16 rounded-2xl border-none cursor-pointer" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">Main Header Title</label>
                      <input value={config.headerTitle} onChange={e => setConfig({...config, headerTitle: e.target.value})} className="w-full p-4 bg-slate-50 border rounded-xl font-bold" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">Profile Photo URL</label>
                      <input value={config.profilePic} onChange={e => setConfig({...config, profilePic: e.target.value})} className="w-full p-4 bg-slate-50 border rounded-xl font-bold" />
                    </div>
                  </section>
                </div>
              </motion.div>
            )}
            
            {activeTab === 'settings' && (
              <motion.div key="settings" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-8 max-w-2xl mx-auto py-10">
                <h1 className="text-4xl font-black">Cloud Sync</h1>
                <section className="bg-white p-10 rounded-[3rem] border shadow-xl space-y-6">
                   <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">Supabase Project URL</label>
                    <input value={tempSupabaseUrl} onChange={e => setTempSupabaseUrl(e.target.value)} className="w-full p-4 bg-slate-50 border rounded-xl font-bold" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">Supabase Anon Key</label>
                    <input type="password" value={tempSupabaseKey} onChange={e => setTempSupabaseKey(e.target.value)} className="w-full p-4 bg-slate-50 border rounded-xl font-bold" />
                  </div>
                  <button onClick={() => { updateSupabaseConfig(tempSupabaseUrl, tempSupabaseKey); setCloudEnabled(true); alert("Database Synced!"); }} className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-black shadow-lg">Link Supabase Account</button>
                </section>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      <AIWidget config={config} />
    </div>
  );
};

export default App;
