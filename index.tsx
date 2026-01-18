
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import AIWidget from './components/AIWidget.tsx';
import { BusinessConfig } from './types.ts';

const initApp = () => {
  let rootElement = document.getElementById('estimate-ai-root') || document.getElementById('root');

  if (!rootElement) {
    rootElement = document.createElement('div');
    rootElement.id = 'estimate-ai-root';
    document.body.appendChild(rootElement);
  }

  const root = ReactDOM.createRoot(rootElement);
  
  const config = (window as any).ESTIMATE_AI_CONFIG as BusinessConfig;
  const isWidgetOnly = (window as any).ESTIMATE_AI_WIDGET_ONLY === true;

  if (isWidgetOnly && config) {
    root.render(
      <React.StrictMode>
        <AIWidget config={config} />
      </React.StrictMode>
    );
  } else {
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  }
};

// Use DOMContentLoaded to ensure we run after body exists
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
