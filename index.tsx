
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

  // Determine if we are in "Widget Mode" based on URL or global flags
  const params = new URLSearchParams(window.location.search);
  const isWidgetMode = !!(params.get('id') || params.get('config') || params.get('embed') === 'true' || (window as any).ESTIMATE_AI_WIDGET_ONLY);

  useEffect(() => {
    const loadData = async () => {
      // Only attempt to load config if we are supposed to be in widget mode
      if (!isWidgetMode) {
        setLoading(false);
        return;
      }

      const id = params.get('id');
      const rawConfig = params.get('config');
      let foundConfig: BusinessConfig | null = null;

      // 1. Check for raw config first (fastest for preview/builder)
      if (rawConfig) {
        try {
          foundConfig = JSON.parse(decodeURIComponent(rawConfig));
        } catch (e) { 
          console.error("Config parse error", e);
          setError("Invalid configuration data in URL.");
        }
      }

      // 2. Check for ID in Supabase if not found in URL
      if (!foundConfig && id && isSupabaseConfigured()) {
        try {
          const { data, error: fetchError } = await supabase.from('widgets').select('config').eq('id', id).single();
          if (!fetchError && data) {
            foundConfig = data.config;
          } else if (fetchError) {
            console.error("Supabase fetch error", fetchError);
            setError(`Could not find widget with ID: ${id}`);
          }
        } catch (e) { 
          console.error("Fetch exception", e);
          setError("Failed to connect to database.");
        }
      }

      // 3. Fallback to window global (traditional script embed)
      if (!foundConfig) {
        const windowConfig = (window as any).ESTIMATE_AI_CONFIG as BusinessConfig;
        if (windowConfig) {
          foundConfig = windowConfig;
        }
      }

      // Final check
      if (foundConfig) {
        setConfig(foundConfig);
        setError(null);
      } else if (isWidgetMode && !error) {
        setError("Widget configuration could not be loaded. Please ensure the Widget ID is correct or the configuration is provided.");
      }
      
      setLoading(false);
    };

    loadData();
  }, [isWidgetMode]);

  // While loading data for the widget
  if (loading && isWidgetMode) {
    return (
      <div className="flex items-center justify-center h-screen bg-transparent">
        <div className="w-8 h-8 border-4 border-indigo-600/20 border-t-indigo-600 rounded-full animate-spin"></div>
      </div>
    );
  }

  // If we are in widget mode, we strictly return the AIWidget or an error message
  if (isWidgetMode) {
    if (config) {
      return <AIWidget config={config} />;
    }
    if (error) {
      return (
        <div className="p-6 text-center text-slate-800 font-sans h-screen flex flex-col items-center justify-center bg-white border border-slate-200 shadow-inner">
          <div className="bg-red-50 p-4 rounded-2xl mb-4 text-red-600 border border-red-100">
            <svg className="w-8 h-8 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
            <p className="font-black text-sm uppercase tracking-widest mb-1">Initialization Error</p>
            <p className="text-xs font-medium">{error}</p>
          </div>
          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">RoofBot AI Engine v1.0</p>
        </div>
      );
    }
    return null;
  }

  // If not in widget mode, show the SaaS dashboard
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
