import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * Simple runtime check you can call from anywhere
 * to verify that the Supabase client initialized.
 */
export function verifySupabaseClient() {
  const isConfigured = Boolean(supabaseUrl && supabaseAnonKey);

  if (!isConfigured) {
    console.error('Supabase client is not configured correctly.');
  }

  return {
    isConfigured,
  };
}

// Optional: log once in development so you see it in the terminal/browser
if (process.env.NODE_ENV === 'development') {
  const { isConfigured } = verifySupabaseClient();
  if (isConfigured) {
    // This confirms the client was created without throwing.
    // It will only run when this module is imported in development.
    console.log('Supabase client initialized successfully.');
  }
}
