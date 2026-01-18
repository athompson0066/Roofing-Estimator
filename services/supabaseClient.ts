
import { createClient } from '@supabase/supabase-js';

// Helper to safely access process.env without ReferenceErrors in browser
const getEnvVar = (key: string) => {
  try {
    return (window as any).process?.env?.[key] || (process as any)?.env?.[key];
  } catch {
    return undefined;
  }
};

const placeholderUrl = 'https://placeholder-project.supabase.co';
const placeholderKey = 'placeholder-key';

// Fallback logic: check environment, then localStorage
export const getSupabaseConfig = () => {
  const envUrl = getEnvVar('SUPABASE_URL');
  const envKey = getEnvVar('SUPABASE_ANON_KEY');
  
  const localUrl = localStorage.getItem('SUPABASE_URL');
  const localKey = localStorage.getItem('SUPABASE_ANON_KEY');

  // Check for valid Supabase URLs
  const isValidUrl = (url: string | null | undefined) => 
    url && 
    url.startsWith('https://') && 
    url.includes('.supabase.co') && 
    url !== placeholderUrl;

  const url = isValidUrl(localUrl) ? localUrl : (isValidUrl(envUrl) ? envUrl : null);
  const key = localKey ? localKey : (envKey && envKey !== 'your-anon-key-here' ? envKey : null);

  return { url: url || placeholderUrl, key: key || placeholderKey };
};

const config = getSupabaseConfig();

// Initialize the client singleton
export let supabase = createClient(config.url, config.key);

export const isSupabaseConfigured = () => {
  const cfg = getSupabaseConfig();
  return !!(cfg.url && cfg.key && cfg.url !== placeholderUrl && cfg.key !== placeholderKey);
};

/**
 * Updates the configuration without reloading the page.
 */
export const updateSupabaseConfig = (url: string, key: string) => {
  if (!url.startsWith('https://')) {
    throw new Error("URL must start with https://");
  }
  
  const trimmedUrl = url.trim();
  const trimmedKey = key.trim();
  
  localStorage.setItem('SUPABASE_URL', trimmedUrl);
  localStorage.setItem('SUPABASE_ANON_KEY', trimmedKey);
  
  // Re-initialize the exported singleton
  supabase = createClient(trimmedUrl, trimmedKey);
};

export const clearSupabaseConfig = () => {
  localStorage.removeItem('SUPABASE_URL');
  localStorage.removeItem('SUPABASE_ANON_KEY');
  // Re-initialize with placeholders
  supabase = createClient(placeholderUrl, placeholderKey);
};
