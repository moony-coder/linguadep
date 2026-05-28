import { createClient } from "@supabase/supabase-js";

// Read from Vite environment variables
const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL || "").trim();
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || "").trim();

export const isSupabaseConfigured = 
  supabaseUrl !== "" && 
  supabaseAnonKey !== "" && 
  !supabaseUrl.includes("PLACEHOLD") && 
  !supabaseAnonKey.includes("PLACEHOLD");

// Initialize real Supabase client if available
export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

/**
 * Shared interface for user sessions across real Supabase and Sandbox Demo fallback
 */
export interface AppUser {
  id: string;
  email: string;
  name: string;
  tier: "free" | "casual" | "premium";
  credits: number;
  isSandbox: boolean;
}

// In-memory or localStorage backed Mock Auth State for the Sandbox Preview
const SANDBOX_USER_KEY = "linguabot_auth_sandbox_user";

export const getSandboxUser = (): AppUser | null => {
  const stored = localStorage.getItem(SANDBOX_USER_KEY);
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch {
      return null;
    }
  }
  return null;
};

export const setSandboxUser = (user: AppUser | null) => {
  if (user) {
    localStorage.setItem(SANDBOX_USER_KEY, JSON.stringify(user));
  } else {
    localStorage.removeItem(SANDBOX_USER_KEY);
  }
};
