
import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import AIWidget from './components/AIWidget.tsx';
import { BusinessConfig } from './types.ts';
import { supabase, isSupabaseConfigured } from './services/supabaseClient.ts';

const WidgetLoader = () => {
  const [config, setConfig] = useState<BusinessConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      const params = new URLSearchParams(window.location.search);
      const id = params.get('id');
      const rawConfig = params.get('config');

      // 1. Check for raw config first (fastest for preview/builder)
      if (rawConfig) {
        try {
          const parsed = JSON.parse(decodeURIComponent(rawConfig));
          setConfig(parsed);
          setLoading(false);
          return;
        } catch (e) { console.error("Config parse error", e); }
      }

      // 2. Check for ID in Supabase
      if (id && isSupabaseConfigured()) {
        try {
          const { data, error } = await supabase.from('widgets').select('config').eq('id', id).single();
          if (!error && data) {
            setConfig(data.config);
            setLoading(false);
            return;
          }
        } catch (e) { console.error("Fetch error", e); }
      }

      // 3. Fallback to window global (traditional script embed)
      const windowConfig = (window as any).ESTIMATE_AI_CONFIG as BusinessConfig;
      if (windowConfig) {
        setConfig(windowConfig);
      }
      
      setLoading(false);
    };

    loadData();
  }, []);

  if (loading) return null; // Or a small skeleton

  // If we have a config or if we are explicitly told to be a widget via query param or window global
  const params = new URLSearchParams(window.location.search);
  const isWidgetMode = params.get('id') || params.get('config') || (window as any).ESTIMATE_AI_WIDGET_ONLY;

  if (isWidgetMode && config) {
    return <AIWidget config={config} />;
  }

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
