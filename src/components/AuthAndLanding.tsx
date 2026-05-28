import React, { useState } from "react";
import { motion } from "motion/react";
import { 
  supabase, 
  isSupabaseConfigured, 
  AppUser, 
  setSandboxUser 
} from "../lib/supabase";
import { 
  ShieldAlert, 
  CheckCircle, 
  KeyRound, 
  ArrowRight, 
  Compass, 
  Sparkles, 
  HelpCircle, 
  UserCheck, 
  Database,
  Lock,
  Mail,
  User,
  GraduationCap,
  Award
} from "lucide-react";

interface AuthAndLandingProps {
  onSuccess: (user: AppUser) => void;
}

export default function AuthAndLanding({ onSuccess }: AuthAndLandingProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  
  // Loading & error feedback
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // View toggle: 'landing' vs 'auth'
  const [view, setView] = useState<'landing' | 'auth'>('landing');

  // Supabase Table initialization snippet for candidate reference
  const [showSqlSnippet, setShowSqlSnippet] = useState(false);

  const handleRealAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      setErrorMsg("Please fill in email and password credentials.");
      return;
    }
    
    setErrorMsg(null);
    setSuccessMsg(null);
    setLoading(true);

    try {
      if (!supabase) {
        throw new Error("Application not fully configured. Please provide environmental credentials.");
      }

      if (isSignUp) {
        // Sign Up with optional metadata
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: name || email.split("@")[0],
              tier: "free",
              credits: 2
            }
          }
        });

        if (error) throw error;
        
        if (data.session) {
          // Auto-logged in
          const registeredUser: AppUser = {
            id: data.session.user.id,
            email: data.session.user.email || email,
            name: data.session.user.user_metadata?.full_name || name || email.split("@")[0],
            tier: "free",
            credits: 2,
            isSandbox: false
          };
          setSuccessMsg("Success! Auto-logging you into your new candidate profile.");
          setTimeout(() => onSuccess(registeredUser), 1000);
        } else {
          setSuccessMsg("Registration initiated! Please check your mailbox/inbox for the confirmation link.");
        }
      } else {
        // Sign In
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password
        });

        if (error) throw error;

        if (data.session && data.user) {
          const authenticatedUser: AppUser = {
            id: data.user.id,
            email: data.user.email || email,
            name: data.user.user_metadata?.full_name || data.user.email?.split("@")[0] || "Student Candidate",
            tier: data.user.user_metadata?.tier || "free",
            credits: data.user.user_metadata?.credits ?? 2,
            isSandbox: false
          };
          setSuccessMsg("Authentication complete! Connecting current active session...");
          setTimeout(() => onSuccess(authenticatedUser), 800);
        }
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Credential authentication failed. Please audit inputs.");
    } finally {
      setLoading(false);
    }
  };

  const sqlSnippetCode = `-- DATABASE HIGHLIGHT CONFIGURATION
-- Paste this script directly into your Database Editor to build tables and establish security:

CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    telegram_id TEXT UNIQUE,
    tier TEXT DEFAULT 'free',
    mocks_remaining INTEGER DEFAULT 2,
    email TEXT,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
);

-- Enable Row Level Security (RLS) on Users
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- 1. Allow authenticated clients to select & update their own rows
DROP POLICY IF EXISTS "Allow users to view and update their own metadata" ON public.users;
CREATE POLICY "Allow users to view and update their own metadata"
    ON public.users FOR ALL TO authenticated USING (auth.uid() = id);

-- 2. Allow our server-side Telegram Bot (runs under 'anon' proxy) to locate and update users' telegram links
DROP POLICY IF EXISTS "Allow anon bot backend queries" ON public.users;
CREATE POLICY "Allow anon bot backend queries"
    ON public.users FOR ALL TO anon USING (true) WITH CHECK (true);

-- Create Payments Receipts Table to block Replay attacks
CREATE TABLE IF NOT EXISTS public.payments (
    id UUID PRIMARY KEY,
    telegram_charge_id TEXT UNIQUE NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    stars_paid INTEGER NOT NULL,
    mocks_credited INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
);

-- Enable Row Level Security (RLS) on Payments
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

-- 1. Allow users to fetch their own payments history
DROP POLICY IF EXISTS "Allow users to fetch their own payments history" ON public.payments;
CREATE POLICY "Allow users to fetch their own payments history"
    ON public.payments FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- 2. Allow bot to insert payment records and look up transaction hashes
DROP POLICY IF EXISTS "Allow anon bot payment registration" ON public.payments;
CREATE POLICY "Allow anon bot payment registration"
    ON public.payments FOR ALL TO anon USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.ielts_saved_scores (
    id TEXT PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    mock_title TEXT NOT NULL,
    overall TEXT NOT NULL,
    fluency TEXT NOT NULL,
    lexical TEXT NOT NULL,
    grammar TEXT NOT NULL,
    pronunciation TEXT NOT NULL,
    feedback TEXT NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Enable Row Level Security (RLS) on Scores
ALTER TABLE public.ielts_saved_scores ENABLE ROW LEVEL SECURITY;

-- Create secure SELECT policy for authenticated candidates
DROP POLICY IF EXISTS "Users can fetch only their own test scores" ON public.ielts_saved_scores;
CREATE POLICY "Users can fetch only their own test scores"
    ON public.ielts_saved_scores
    FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

-- Create secure INSERT policy for authenticated candidates
DROP POLICY IF EXISTS "Users can insert their own test scores" ON public.ielts_saved_scores;
CREATE POLICY "Users can insert their own test scores"
    ON public.ielts_saved_scores
    FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);`;

  return (
    <div className="min-h-screen bg-[#FAF9F5] bg-premium-dots flex flex-col items-center justify-between font-sans relative selection:bg-amber-100 py-12 px-6">
      
      {/* Background radial accent flare */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[70%] max-w-[800px] h-[350px] bg-amber-200/5 blur-[140px] rounded-full pointer-events-none" />

      {/* Main Content container */}
      <main className="max-w-4xl w-full mx-auto flex flex-col items-center flex-grow justify-center relative z-10 my-4">
        
        {/* Branding badge */}
        <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 border border-amber-200/60 rounded-full text-amber-800 text-xs font-semibold mb-6 shadow-xs select-none">
          <Sparkles size={14} className="text-amber-502 animate-pulse" />
          <span>IELTS Speaking Examiner v3.5 Duplex</span>
        </div>

        {view === 'landing' ? (
          /* ================= LANDING SCREEN ================= */
          <div className="text-center space-y-8 w-full">
            <div className="space-y-4 max-w-2xl mx-auto">
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold tracking-tight text-stone-850 font-display leading-[1.08]">
                Master the IELTS Speaking Exam with <span className="underline decoration-amber-500/40 underline-offset-4">Real-Time AI</span>
              </h1>
              <p className="text-base md:text-lg text-stone-500 font-medium leading-relaxed">
                Connect your voice to Dr. Eleanor or Dr. Arthur for realistic 3-Part oral practice. Receive structured analytical band evaluation powered by Gemini 3.5.
              </p>
            </div>

            {/* Core CTA Grid */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 max-w-md mx-auto">
              {isSupabaseConfigured ? (
                <button
                  id="btn-real-get-started"
                  onClick={() => setView('auth')}
                  className="w-full sm:w-auto px-8 py-4 bg-stone-850 hover:bg-stone-950 text-white font-bold text-sm tracking-wide rounded-2xl shadow-lg hover:shadow-xl transition-all flex items-center justify-center gap-2 cursor-pointer border border-stone-800"
                >
                  <span>Log In</span>
                  <ArrowRight size={16} />
                </button>
              ) : (
                <button
                  id="btn-trigger-signup-flow"
                  onClick={() => setView('auth')}
                  className="w-full sm:w-auto px-8 py-4 bg-[#FF7A00] hover:bg-[#e66e00] text-white font-bold text-sm tracking-wide rounded-2xl shadow-lg hover:shadow-xl transition-all flex items-center justify-center gap-2 cursor-pointer border border-[#e66e00]"
                >
                  <span>Log In or Sign Up</span>
                  <ArrowRight size={16} />
                </button>
              )}
            </div>

            {/* IELTS feature column highlights */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-3xl mx-auto pt-4 text-left">
              <div className="bg-white/45 border border-stone-200/60 rounded-2xl p-5 space-y-2">
                <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 border border-indigo-100 flex items-center justify-center font-bold">1</div>
                <h5 className="font-bold text-sm text-stone-800">Full 3-Part Simulation</h5>
                <p className="text-xs text-stone-500 leading-relaxed">Runs interactive oral questions covering warm-up queries, Part 2 cue cue cards, and Part 3 abstract discussion debates.</p>
              </div>
              <div className="bg-white/45 border border-stone-200/60 rounded-2xl p-5 space-y-2">
                <div className="w-8 h-8 rounded-lg bg-pink-50 text-pink-600 border border-pink-100 flex items-center justify-center font-bold">2</div>
                <h5 className="font-bold text-sm text-stone-800">Live Voice Feedback</h5>
                <p className="text-xs text-stone-500 leading-relaxed">Features speech response capabilities with immediate audio interaction and voice choice customization parameters.</p>
              </div>
              <div className="bg-white/45 border border-stone-200/60 rounded-2xl p-5 space-y-2">
                <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 border border-amber-100 flex items-center justify-center font-bold font-display">3</div>
                <h5 className="font-bold text-sm text-stone-800">Gemini Scoring Matrix</h5>
                <p className="text-xs text-stone-500 leading-relaxed">Breaks down performance by official IELTS score parameters: Fluency, Lexical Range, Grammar, and Pronunciation.</p>
              </div>
            </div>
          </div>
        ) : (
          /* ================= AUTHENTICATION CARD ================= */
          <motion.div 
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-md bg-white border border-stone-200/80 rounded-3xl p-8 shadow-xl relative"
          >
            {/* Header branding */}
            <div className="text-center mb-6">
              <div className="w-12 h-12 bg-amber-50 text-amber-700 border border-amber-200 rounded-2xl flex items-center justify-center mx-auto mb-3">
                <KeyRound size={24} />
              </div>
              <h3 className="text-xl font-extrabold text-stone-950 font-display tracking-tight">
                {isSignUp ? "Create Candidate Account" : "IELTS Candidate Login"}
              </h3>
              <p className="text-xs text-stone-500 mt-1">
                {isSignUp ? "Sign up to track and save secure test results" : "Log in to load your previous band recordings"}
              </p>
            </div>

            {/* Error & Success Feeds */}
            {errorMsg && (
              <div className="mb-4 p-3.5 bg-rose-50 border border-rose-220 text-rose-700 text-xs font-bold font-mono rounded-xl leading-relaxed flex items-start gap-2 animate-pulse">
                <Lock size={14} className="mt-0.5 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}
            {successMsg && (
              <div className="mb-4 p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold rounded-xl leading-relaxed flex items-start gap-2">
                <CheckCircle size={14} className="mt-0.5 shrink-0" />
                <span>{successMsg}</span>
              </div>
            )}

            {/* Credentials form */}
            <form onSubmit={isSupabaseConfigured ? handleRealAuth : (e) => {
              e.preventDefault();
              setLoading(true);
              setTimeout(() => {
                setLoading(false);
                // Succeed immediately in sandbox to provide seamless UX
                const mockUser: AppUser = {
                  id: "usr_" + Math.random().toString(36).substring(4, 10),
                  email: email || "candidate@linguabot.dev",
                  name: name || "Student Candidate",
                  tier: "casual",
                  credits: 6,
                  isSandbox: true
                };
                setSandboxUser(mockUser);
                onSuccess(mockUser);
              }, 600);
            }} className="space-y-4">
              
              {isSignUp && (
                <div className="space-y-1">
                  <label className="text-xs font-bold text-stone-500 uppercase tracking-wider block" htmlFor="input-full-name">Full Candidate Name</label>
                  <div className="relative">
                    <User size={15} className="absolute left-3.5 top-3.5 text-stone-400" />
                    <input
                      id="input-full-name"
                      type="text"
                      placeholder="e.g. Liam Smith"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full pl-10 pr-4 py-3 bg-stone-50/50 hover:bg-stone-50/80 border border-stone-200 focus:border-stone-400 focus:bg-white rounded-xl text-sm font-semibold text-stone-800 focus:outline-none focus:ring-1 focus:ring-stone-400 transition-all"
                      required
                    />
                  </div>
                </div>
              )}

              <div className="space-y-1">
                <label className="text-xs font-bold text-stone-500 uppercase tracking-wider block" htmlFor="input-email-address">Email Address</label>
                <div className="relative">
                  <Mail size={15} className="absolute left-3.5 top-3.5 text-stone-400" />
                  <input
                    id="input-email-address"
                    type="email"
                    placeholder="candidate@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 bg-stone-50/50 hover:bg-stone-50/80 border border-stone-200 focus:border-stone-400 focus:bg-white rounded-xl text-sm font-semibold text-stone-800 focus:outline-none focus:ring-1 focus:ring-stone-400 transition-all"
                    required
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-stone-500 uppercase tracking-wider block" htmlFor="input-password-field">Password</label>
                <div className="relative">
                  <Lock size={15} className="absolute left-3.5 top-3.5 text-stone-400" />
                  <input
                    id="input-password-field"
                    type="password"
                    placeholder="Min. 6 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 bg-stone-50/50 hover:bg-stone-50/80 border border-stone-200 focus:border-stone-400 focus:bg-white rounded-xl text-sm font-semibold text-stone-800 focus:outline-none focus:ring-1 focus:ring-stone-400 transition-all"
                    minLength={6}
                    required
                  />
                </div>
              </div>

              <button
                id="btn-submit-credentials-form"
                type="submit"
                className="w-full py-3.5 bg-stone-850 hover:bg-stone-950 text-white font-bold text-xs rounded-xl shadow-md transition-all uppercase tracking-wider cursor-pointer flex items-center justify-center gap-2"
                disabled={loading}
              >
                <span>{loading ? "Loading..." : isSignUp ? "Create Account" : "Log In"}</span>
              </button>
            </form>

            {/* Change Login / Signup View link */}
            <div className="mt-5 text-center">
              <button
                id="btn-toggle-auth-action"
                onClick={() => {
                  setIsSignUp(!isSignUp);
                  setErrorMsg(null);
                  setSuccessMsg(null);
                }}
                className="text-xs font-bold text-[#FF7A00] hover:text-[#d96800] underline underline-offset-3 cursor-pointer transition-colors"
              >
                {isSignUp ? "Already registered? Click to Log In" : "Need to track scores? Click to Register Account"}
              </button>
            </div>

            {/* Go back */}
            <div className="mt-4 pt-4 border-t border-stone-100 text-center">
              <button
                id="btn-return-to-landing"
                onClick={() => setView('landing')}
                className="text-xs font-extrabold text-stone-400 hover:text-stone-600 transition-colors uppercase tracking-widest cursor-pointer"
              >
                ← Back to product details
              </button>
            </div>
          </motion.div>
        )}
      </main>

      {/* Footer copyright */}
      <footer className="w-full max-w-4xl mx-auto text-center border-t border-stone-200/50 pt-6 text-[11px] font-semibold text-stone-400 select-none">
        <p>© 2026 LinguaBot IELTS Companion. Built with Google Gemini 3.5.</p>
      </footer>
    </div>
  );
}
