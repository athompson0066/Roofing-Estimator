
import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import AIWidget from './components/AIWidget.tsx';
import { BusinessConfig } from './types.ts';
import { supabase, isSupabaseConfigured } from './services/supabaseClient.ts';

const WidgetLoader = () => {
  const [config, setConfig] = useState<BusinessConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Determine if we are in "Widget Mode" strictly based on explicit parameters
  const params = new URLSearchParams(window.location.search);
  const widgetId = params.get('wid');
  const rawConfig = params.get('config');
  const isEmbedFlag = params.get('embed') === 'true';
  
  // Widget mode is only active if we have data or an explicit embed flag
  const isWidgetMode = !!(widgetId || rawConfig || isEmbedFlag || (window as any).ESTIMATE_AI_WIDGET_ONLY);

  useEffect(() => {
    const loadData = async () => {
      // If we're not trying to be a widget, just show the app
      if (!isWidgetMode) {
        setLoading(false);
        return;
      }

      let foundConfig: BusinessConfig | null = null;

      // 1. Try raw config from URL
      if (rawConfig) {
        try {
          foundConfig = JSON.parse(decodeURIComponent(rawConfig));
        } catch (e) { 
          console.error("Config parse error", e);
          setError("The provided configuration data is invalid.");
        }
      }

      // 2. Try ID lookup from Supabase
      if (!foundConfig && widgetId && isSupabaseConfigured()) {
        try {
          const { data, error: fetchError } = await supabase.from('widgets').select('config').eq('id', widgetId).single();
          if (!fetchError && data) {
            foundConfig = data.config;
          } else if (fetchError) {
            console.error("Supabase fetch error", fetchError);
            setError(`Widget not found (ID: ${widgetId}). Ensure the widget is saved.`);
          }
        } catch (e) { 
          console.error("Fetch exception", e);
          setError("Database connection error. Check your Supabase settings.");
        }
      }

      // 3. Try window global fallback
      if (!foundConfig) {
        const windowConfig = (window as any).ESTIMATE_AI_CONFIG as BusinessConfig;
        if (windowConfig) {
          foundConfig = windowConfig;
        }
      }

      if (foundConfig) {
        setConfig(foundConfig);
        setError(null);
      } else if (isWidgetMode && !error) {
        // If we were supposed to be a widget but found nothing, show an error unless one was already set
        setError("Widget configuration missing. If you just deployed, save your first profile in the dashboard.");
      }
      
      setLoading(false);
    };

    loadData();
  }, [isWidgetMode, widgetId, rawConfig]);

  // Handle Loading State for Widgets
  if (loading && isWidgetMode) {
    return (
      <div className="flex items-center justify-center h-screen bg-transparent">
        <div className="w-8 h-8 border-4 border-indigo-600/20 border-t-indigo-600 rounded-full animate-spin"></div>
      </div>
    );
  }

  // Strictly Render Widget or Error if in Widget Mode
  if (isWidgetMode) {
    if (config) {
      return <AIWidget config={config} />;
    }
    if (error) {
      return (
        <div className="p-6 text-center text-slate-800 font-sans h-screen flex flex-col items-center justify-center bg-white border border-slate-200 shadow-inner">
          <div className="bg-red-50 p-6 rounded-[2rem] mb-4 text-red-600 border border-red-100 max-w-sm">
            <svg className="w-10 h-10 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
            <p className="font-black text-xs uppercase tracking-widest mb-2">Configuration Error</p>
            <p className="text-xs font-semibold leading-relaxed">{error}</p>
            {!isSupabaseConfigured() && widgetId && (
              <p className="mt-4 text-[10px] text-red-400 font-bold uppercase tracking-tight">Supabase is not configured in environment variables.</p>
            )}
          </div>
          <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest">RoofBot AI Engine v1.1</p>
        </div>
      );
    }
    return null;
  }

  // Default: Render the SaaS Dashboard
  return <App />;
};

const initApp = () => {
  let rootElement = document.getElementById('estimate-ai-root') || document.getElementById('root');

  if (!rootElement) {
    rootElement = document.createElement('div');
    rootElement.id = 'estimate-ai-root';
    document.body.appendChild(rootElement);
  }

  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <WidgetLoader />
    </React.StrictMode>
  );
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
