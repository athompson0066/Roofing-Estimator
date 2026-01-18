
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
  const isWidgetMode = params.get('id') || params.get('config') || params.get('embed') === 'true' || (window as any).ESTIMATE_AI_WIDGET_ONLY;

  useEffect(() => {
    const loadData = async () => {
      // Only attempt to load config if we are supposed to be in widget mode
      if (!isWidgetMode) {
        setLoading(false);
        return;
      }

      const id = params.get('id');
      const rawConfig = params.get('config');

      // 1. Check for raw config first (fastest for preview/builder)
      if (rawConfig) {
        try {
          const parsed = JSON.parse(decodeURIComponent(rawConfig));
          setConfig(parsed);
          setLoading(false);
          return;
        } catch (e) { 
          console.error("Config parse error", e);
          setError("Invalid configuration data.");
        }
      }

      // 2. Check for ID in Supabase
      if (id && isSupabaseConfigured()) {
        try {
          const { data, error } = await supabase.from('widgets').select('config').eq('id', id).single();
          if (!error && data) {
            setConfig(data.config);
            setLoading(false);
            return;
          } else if (error) {
            setError("Could not find widget with that ID.");
          }
        } catch (e) { 
          console.error("Fetch error", e);
          setError("Failed to fetch widget configuration.");
        }
      }

      // 3. Fallback to window global (traditional script embed)
      const windowConfig = (window as any).ESTIMATE_AI_CONFIG as BusinessConfig;
      if (windowConfig) {
        setConfig(windowConfig);
      } else if (!config && isWidgetMode) {
        setError("Widget configuration is missing.");
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
        <div className="p-4 text-center text-red-500 font-bold bg-white h-screen flex flex-col items-center justify-center">
          <p>⚠️ {error}</p>
        </div>
      );
    }
    // If no config and no error yet, but we are in widget mode, wait for load
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
