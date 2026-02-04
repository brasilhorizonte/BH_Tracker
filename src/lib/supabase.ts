import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

// ============================================================================
// Primary Supabase Client (for usage_events - dashbrasilhorizonte)
// ============================================================================

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const hasSupabaseConfig = Boolean(supabaseUrl && supabaseAnonKey);

let supabaseClient: SupabaseClient | null = null;

export const getSupabaseClient = () => {
  if (!hasSupabaseConfig) return null;
  if (!supabaseClient) {
    supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    });
  }
  return supabaseClient;
};

// ============================================================================
// Terminal Supabase Client (for terminal_events - horizon-terminal-access)
// ============================================================================

const terminalSupabaseUrl = import.meta.env.VITE_TERMINAL_SUPABASE_URL || '';
const terminalSupabaseAnonKey = import.meta.env.VITE_TERMINAL_SUPABASE_ANON_KEY || '';

export const hasTerminalSupabaseConfig = Boolean(terminalSupabaseUrl && terminalSupabaseAnonKey);

let terminalSupabaseClient: SupabaseClient | null = null;

export const getTerminalSupabaseClient = () => {
  if (!hasTerminalSupabaseConfig) return null;
  if (!terminalSupabaseClient) {
    terminalSupabaseClient = createClient(terminalSupabaseUrl, terminalSupabaseAnonKey, {
      auth: {
        persistSession: false, // Don't persist - we use the main client for auth
        autoRefreshToken: false,
      },
    });
  }
  return terminalSupabaseClient;
};
