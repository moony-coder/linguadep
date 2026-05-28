import { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Target, 
  ChevronRight, 
  Mic, 
  Search, 
  HelpCircle, 
  TrendingUp, 
  Award, 
  ShieldCheck,
  History,
  Clock,
  Play,
  Check,
  Edit2,
  ChevronDown,
  Volume2,
  Shuffle,
  Plus,
  Loader2,
  X,
  Sparkles,
  MessageSquare,
  Coins,
  Tag
} from 'lucide-react';
import MockTestApp from './MockTestApp';
import AdminPage from './AdminPage';
import { MOCKS, MockProfile } from './data';
import logoUrl from './assets/images/speech_bubble_logo_1779674235029.png';
import { supabase, isSupabaseConfigured, AppUser, setSandboxUser } from './lib/supabase';
import AuthAndLanding from './components/AuthAndLanding';
import { apiUrl } from './lib/backend';
import { LogOut, User as UserIcon } from 'lucide-react';

function sanitizeText(val: string): string {
  if (!val) return "";
  return val.replace(/[<>]/g, "").slice(0, 100);
}

function safeParseScores(raw: string): any[] {
  try {
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list.map(item => {
      if (!item || typeof item !== "object") return null;
      return {
        ...item,
        id: sanitizeText(item.id),
        mockTitle: sanitizeText(item.mockTitle),
        overall: sanitizeText(String(item.overall || "")).slice(0, 5),
        fluency: sanitizeText(String(item.fluency || "")).slice(0, 5),
        lexical: sanitizeText(String(item.lexical || "")).slice(0, 5),
        grammar: sanitizeText(String(item.grammar || "")).slice(0, 5),
        pronunciation: sanitizeText(String(item.pronunciation || "")).slice(0, 5),
        feedback: sanitizeText(item.feedback).slice(0, 1000),
        timestamp: typeof item.timestamp === "number" ? item.timestamp : Date.now(),
      };
    }).filter(Boolean);
  } catch {
    return [];
  }
}

export default function App() {
  const [selectedMock, setSelectedMock] = useState<MockProfile | null>(null);
  const [activeTab, setActiveTab] = useState<'home' | 'tests' | 'dashboard' | 'pricing'>(() => {
    return (localStorage.getItem('ielts_active_tab') as 'home' | 'tests' | 'dashboard' | 'pricing') || 'home';
  });
  const [prevTab, setPrevTab] = useState<'home' | 'tests' | 'dashboard' | 'pricing'>(activeTab);
  const [searchQuery, setSearchQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(12);

  const [userCredits, setUserCredits] = useState<number>(() => {
    const saved = localStorage.getItem("ielts_user_credits");
    if (saved !== null) {
      const num = parseInt(saved, 10);
      return isNaN(num) ? 2 : num;
    }
    return 2;
  });

  const saveCredits = (credits: number) => {
    setUserCredits(credits);
    localStorage.setItem("ielts_user_credits", credits.toString());
  };

  // Auth States
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // Telegram bot billing state integration
  const [botUsername, setBotUsername] = useState<string>("speakpayment_bot");
  const [dbProfile, setDbProfile] = useState<{ id: string; telegram_id?: string; mocks_remaining?: number } | null>(null);
  const [isFetchingProfile, setIsFetchingProfile] = useState(false);

  useEffect(() => {
    fetch(apiUrl("/api/bot-info"))
      .then(res => res.json())
      .then(data => {
        if (data?.username) {
          setBotUsername(data.username);
        }
      })
      .catch(err => console.error("Error loaded bot-info metadata:", err));
  }, []);

  const syncProfile = async (userId: string, email: string) => {
    if (!isSupabaseConfigured || !supabase) return;
    setIsFetchingProfile(true);
    try {
      let { data, error } = await supabase
        .from("users")
        .select("*")
        .eq("id", userId)
        .maybeSingle();

      if (error) {
        console.error("Error loading candidate profile database row:", error);
      }

      if (!data) {
        // Build base record row for newly registered candidate
        const newProfile = {
          id: userId,
          email: email,
          tier: "free",
          mocks_remaining: 2,
          updated_at: new Date().toISOString()
        };
        const { data: inserted, error: insertErr } = await supabase
          .from("users")
          .upsert(newProfile)
          .select()
          .single();

        if (!insertErr && inserted) {
          data = inserted;
        }
      }

      if (data) {
        setDbProfile(data);
        saveCredits(data.mocks_remaining ?? 2);
      }
    } catch (crash) {
      console.error("Critical Sync Profile exception:", crash);
    } finally {
      setIsFetchingProfile(false);
    }
  };

  const handleDeductCredit = async () => {
    const nextCredits = Math.max(0, userCredits - 1);
    saveCredits(nextCredits);
    
    if (isSupabaseConfigured && supabase && currentUser && !currentUser.isSandbox) {
      try {
        await supabase
          .from("users")
          .update({
            mocks_remaining: nextCredits,
            updated_at: new Date().toISOString()
          })
          .eq("id", currentUser.id);
        
        setDbProfile(prev => prev ? { ...prev, mocks_remaining: nextCredits } : null);
      } catch (err) {
        console.error("Database credit deduct update failure:", err);
      }
    }
  };

  useEffect(() => {
    // 1. Listen or fetch real Supabase user profile
    if (isSupabaseConfigured && supabase) {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session && session.user) {
          const loadedUser: AppUser = {
            id: session.user.id,
            email: session.user.email || "",
            name: session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || "Student Candidate",
            tier: session.user.user_metadata?.tier || "free",
            credits: session.user.user_metadata?.credits ?? 2,
            isSandbox: false
          };
          setCurrentUser(loadedUser);
          setProfileName(loadedUser.name);
          
          // Only use metadata credits if there is no locally cached credits count yet
          const localSaved = localStorage.getItem("ielts_user_credits");
          if (localSaved === null) {
            saveCredits(loadedUser.credits);
          }
        } else {
          setCurrentUser(null);
        }
        setAuthLoading(false);
      });

      const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
        if (session && session.user) {
          const loadedUser: AppUser = {
            id: session.user.id,
            email: session.user.email || "",
            name: session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || "Student Candidate",
            tier: session.user.user_metadata?.tier || "free",
            credits: session.user.user_metadata?.credits ?? 2,
            isSandbox: false
          };
          setCurrentUser(loadedUser);
          setProfileName(loadedUser.name);
          
          // Do not overwrite client state with stale metadata during background state changes/token refreshes.
          const localSaved = localStorage.getItem("ielts_user_credits");
          if (localSaved === null) {
            saveCredits(loadedUser.credits);
          }
        } else {
          setCurrentUser(null);
        }
      });

      return () => {
        subscription.unsubscribe();
      };
    } else {
      // 2. Local sandbox fallback load
      const sandboxUser = localStorage.getItem("linguabot_auth_sandbox_user");
      if (sandboxUser) {
        try {
          const parsed = JSON.parse(sandboxUser);
          setCurrentUser(parsed);
          setProfileName(parsed.name);
          saveCredits(parsed.credits);
        } catch {
          setCurrentUser(null);
        }
      } else {
        setCurrentUser(null);
      }
      setAuthLoading(false);
    }
  }, []);

  const handleLogout = async () => {
    if (isSupabaseConfigured && supabase) {
      await supabase.auth.signOut();
    }
    localStorage.removeItem("linguabot_auth_sandbox_user");
    setCurrentUser(null);
  };

  const tabIndices = useMemo(() => ({ home: 0, tests: 1, dashboard: 2, pricing: 3 }), []);

  const direction = useMemo(() => {
    const prevIdx = tabIndices[prevTab];
    const currentIdx = tabIndices[activeTab];
    if (prevIdx === currentIdx) return 0;
    return currentIdx > prevIdx ? 1 : -1;
  }, [prevTab, activeTab, tabIndices]);

  const changeTab = (newTab: 'home' | 'tests' | 'dashboard' | 'pricing') => {
    if (newTab === activeTab) return;
    setPrevTab(activeTab);
    setActiveTab(newTab);
    localStorage.setItem('ielts_active_tab', newTab);
  };

  // Candidate name configuration
  const [profileName, setProfileName] = useState(() => {
    return sanitizeText(localStorage.getItem('ielts_user_profile_name') || 'Student Candidate');
  });
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [editNameField, setEditNameField] = useState('');

  // Historic grade scores
  const [savedScores, setSavedScores] = useState<any[]>([]);
  const [expandedScorecards, setExpandedScorecards] = useState<Record<string, boolean>>({});
  const [purchaseFeedback, setPurchaseFeedback] = useState<string | null>(null);

  const toggleScorecard = (id: string) => {
    setExpandedScorecards(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const fetchScores = async () => {
    if (isSupabaseConfigured && supabase && currentUser && !currentUser.isSandbox) {
      const { data, error } = await supabase
        .from('ielts_saved_scores')
        .select('*')
        .eq('user_id', currentUser.id)
        .order('timestamp', { ascending: false });

      if (error) {
        console.error("Error loading secure database scores:", error);
      } else if (data) {
        const mapped = data.map(item => ({
          id: item.id || String(Math.random()),
          mockId: item.id,
          mockTitle: item.mock_title || "IELTS Practice",
          overall: String(item.overall || ""),
          fluency: String(item.fluency || ""),
          lexical: String(item.lexical || ""),
          grammar: String(item.grammar || ""),
          pronunciation: String(item.pronunciation || ""),
          feedback: item.feedback || "",
          timestamp: item.timestamp ? new Date(item.timestamp).getTime() : Date.now()
        }));
        setSavedScores(mapped);
        return;
      }
    }
    
    // Fallback load
    const raw = localStorage.getItem('ielts_saved_scores');
    if (raw) {
      setSavedScores(safeParseScores(raw));
    }
  };

  useEffect(() => {
    fetchScores();
    if (currentUser && !currentUser.isSandbox) {
      syncProfile(currentUser.id, currentUser.email);
    }
  }, [activeTab, currentUser]);

  useEffect(() => {
    localStorage.setItem('ielts_active_tab', activeTab);
  }, [activeTab]);

  const handleSaveName = () => {
    const trimmed = editNameField.trim();
    if (trimmed) {
      setProfileName(trimmed);
      localStorage.setItem('ielts_user_profile_name', trimmed);
    }
    setIsEditingProfile(false);
  };

  const startEditing = () => {
    setEditNameField(profileName);
    setIsEditingProfile(true);
  };

  // Local state to track randomized order of mock items
  const [mockList, setMockList] = useState<MockProfile[]>(() => MOCKS);

  const shuffleMocks = () => {
    setMockList(prev => [...prev].sort(() => Math.random() - 0.5));
  };

  // Filter and search mock tests
  const filteredMocks = useMemo(() => {
    return mockList.filter(mock => {
      const query = searchQuery.toLowerCase();
      return (
        mock.title.toLowerCase().includes(query) ||
        mock.part1.some(tp => tp.toLowerCase().includes(query)) ||
        mock.part2.toLowerCase().includes(query)
      );
    });
  }, [searchQuery, mockList]);

  const [isGeneratingMock, setIsGeneratingMock] = useState(false);
  const [customTopic, setCustomTopic] = useState("");
  const [showCustomModal, setShowCustomModal] = useState(false);

  // Client telemetry for admin dashboard
  useEffect(() => {
    let clientId = localStorage.getItem('lingua_client_id');
    if (!clientId) {
      clientId = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
      localStorage.setItem('lingua_client_id', clientId);
    }
    
    const sendPing = () => {
      fetch(apiUrl('/api/ping'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          userName: profileName,
          path: window.location.pathname,
          action: selectedMock ? `mock:${selectedMock.title}` : `tab:${activeTab}`
        })
      }).catch(err => console.debug('Ping failed:', err));
    };
    
    sendPing();
    const interval = setInterval(sendPing, 30000);
    return () => clearInterval(interval);
  }, [profileName, activeTab, selectedMock]);

  const handleGenerateCustomMock = async () => {
    if (!customTopic.trim()) return;
    if (userCredits <= 0) {
      alert("⚠️ Insufficient Credits\n\nYou have 0 credits remaining. Each custom IELTS simulation session requires 1 credit to boot the real-time AI examiner.\n\nPlease select a package on our Pricing Page to continue practicing!");
      setShowCustomModal(false);
      changeTab('pricing');
      return;
    }
    setIsGeneratingMock(true);
    try {
      const res = await fetch(apiUrl("/api/generate-mock"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: customTopic })
      });
      if (!res.ok) throw new Error("Failed to generate");
      const generatedMock = await res.json();
      setMockList([generatedMock, ...mockList]);
      setSelectedMock(generatedMock);
      setShowCustomModal(false);
      setCustomTopic("");
    } catch (e) {
      console.error(e);
      alert("Could not generate mock topic. Please try again.");
    } finally {
      setIsGeneratingMock(false);
    }
  };

  const handleShowMore = () => {
    setVisibleCount(prev => prev + 12);
  };

  const [isAdminRouteActive, setIsAdminRouteActive] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [isAdminAuthorized, setIsAdminAuthorized] = useState(false);
  const [passwordError, setPasswordError] = useState("");

  useEffect(() => {
    const checkAdminRoute = () => {
      const path = window.location.pathname;
      const hash = window.location.hash;
      const isRoute = 
        path.includes('admimoonbek') || 
        path.includes('adminmoonbek') || 
        hash.includes('admimoonbek') || 
        hash.includes('adminmoonbek');
      setIsAdminRouteActive(isRoute);
    };

    checkAdminRoute();

    window.addEventListener('hashchange', checkAdminRoute);
    window.addEventListener('popstate', checkAdminRoute);

    const interval = setInterval(checkAdminRoute, 1000);

    return () => {
      window.removeEventListener('hashchange', checkAdminRoute);
      window.removeEventListener('popstate', checkAdminRoute);
      clearInterval(interval);
    };
  }, []);

  if (isAdminRouteActive) {
    if (!isAdminAuthorized) {
      return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-stone-950/80 backdrop-blur-md font-sans">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white border border-stone-200 rounded-3xl w-full max-w-sm p-8 shadow-2xl relative text-center"
          >
            <div className="w-14 h-14 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center border border-amber-200 mx-auto mb-4">
              <ShieldCheck size={28} />
            </div>
            <h2 className="text-xl font-extrabold text-stone-900 tracking-tight">System Access Portal</h2>
            <p className="text-xs text-stone-500 mt-1 mb-6">Enter system password to initialize admin module</p>
            
            <form onSubmit={(e) => {
              e.preventDefault();
              if (adminPassword === 'guess@it08') {
                setIsAdminAuthorized(true);
                setPasswordError("");
              } else {
                setPasswordError("Incorrect system password");
              }
            }} className="space-y-4">
              <div>
                <input
                  type="password"
                  placeholder="System Password"
                  value={adminPassword}
                  onChange={(e) => {
                    setAdminPassword(e.target.value);
                    if (passwordError) setPasswordError("");
                  }}
                  className="w-full px-4 py-3 bg-[#FAF9F5] border border-stone-200 rounded-xl text-center text-sm font-semibold focus:outline-none focus:ring-1 focus:ring-amber-500 text-stone-850"
                  autoFocus
                />
                {passwordError && (
                  <p className="text-rose-600 font-bold text-[11px] mt-2 animate-pulse">{passwordError}</p>
                )}
              </div>
              
              <button
                type="submit"
                className="w-full py-3 bg-stone-850 hover:bg-stone-950 text-white font-bold text-xs rounded-xl shadow-md transition-all uppercase tracking-wider cursor-pointer"
              >
                Authenticate Token
              </button>
            </form>
            
            <button
              onClick={() => {
                setIsAdminRouteActive(false);
                setAdminPassword("");
                setIsAdminAuthorized(false);
                setPasswordError("");
                window.history.pushState({}, '', '/');
                if (window.location.hash) {
                  window.location.hash = '';
                }
              }}
              className="mt-4 text-[11px] font-bold text-stone-400 hover:text-stone-600 uppercase tracking-widest transition-colors cursor-pointer"
            >
              Cancel & Exit
            </button>
          </motion.div>
        </div>
      );
    }
    
    return (
      <AdminPage 
        onExit={() => {
          setIsAdminRouteActive(false);
          setIsAdminAuthorized(false);
          setAdminPassword("");
          setPasswordError("");
          window.history.pushState({}, '', '/');
          if (window.location.hash) {
            window.location.hash = '';
          }
        }} 
      />
    );
  }

  if (selectedMock) {
    return (
      <MockTestApp 
        mockConfig={selectedMock} 
        onExit={() => setSelectedMock(null)} 
        userCredits={userCredits}
        onDeductCredit={handleDeductCredit}
        onNavigateToPricing={() => {
          setSelectedMock(null);
          changeTab('pricing');
        }}
      />
    );
  }

  const calculatedStats = () => {
    if (savedScores.length === 0) return { avg: 'N/A', count: 0, highest: 'N/A' };
    let total = 0;
    let highest = 0;
    savedScores.forEach(curr => {
      const score = parseFloat(curr.overall) || 0;
      total += score;
      if (score > highest) highest = score;
    });
    return {
      avg: (total / savedScores.length).toFixed(1),
      count: savedScores.length,
      highest: highest.toFixed(1)
    };
  };

  const pageVariants = {
    enter: (dir: number) => ({
      x: dir > 0 ? 100 : dir < 0 ? -100 : 0,
      opacity: 0,
    }),
    center: {
      x: 0,
      opacity: 1,
    },
    exit: (dir: number) => ({
      x: dir > 0 ? -100 : dir < 0 ? 100 : 0,
      opacity: 0,
    }),
  };

  const pageTransition = {
    x: { type: 'spring' as const, stiffness: 140, damping: 22, mass: 1 },
    opacity: { duration: 0.22, ease: 'easeInOut' as const }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#FAF9F5] flex items-center justify-center font-sans">
        <div className="text-center space-y-4">
          <Loader2 className="animate-spin text-amber-500 mx-auto" size={40} />
          <p className="text-sm font-semibold text-stone-600 tracking-wide">Securing encrypted credentials...</p>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <AuthAndLanding 
        onSuccess={(user) => {
          setCurrentUser(user);
          setProfileName(user.name);
          if (user.isSandbox) {
            saveCredits(user.credits);
          }
        }} 
      />
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-[#FAF9F5] bg-premium-dots text-stone-850 font-sans selection:bg-amber-100 overflow-y-auto relative">
      
      {/* Real-time Status Header Bar */}
      <header className="sticky top-0 z-40 bg-[#FAF9F5]/85 backdrop-blur-md border-b border-stone-200/80 px-6 py-4">
        <div className="max-w-6xl w-full mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          
          {/* Logo & Brand Identity */}
          <div className="flex items-center gap-3 cursor-pointer select-none" onClick={() => changeTab('home')}>
             <div className="relative w-12 h-12 rounded-2xl flex items-center justify-center bg-white shadow-xs border border-stone-200 overflow-hidden shrink-0 p-1">
                 <img src={logoUrl} alt="IELTS Audio Logo" className="w-10 h-10 object-contain" referrerPolicy="no-referrer" />
             </div>
             <div className="text-left">
                <h1 className="font-display text-lg font-extrabold tracking-tight text-stone-900 leading-tight">
                  IELTS Speaking Simulator
                </h1>
                <p className="text-stone-400 text-[9px] font-bold font-mono tracking-widest uppercase">Professional Practice Platform</p>
             </div>
          </div>

          {/* Navigation Controls */}
          <div className="flex items-center gap-4 shrink-0 flex-wrap sm:flex-nowrap justify-center">
            
            {/* Credits Counter */}
            <div 
              onClick={() => changeTab('pricing')}
              className="flex items-center gap-2 px-3.5 py-1.5 bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-250/85 rounded-full hover:border-amber-400 hover:shadow-xs transition-all shadow-xs shrink-0 cursor-pointer text-amber-700 select-none"
              title="Active Speaking Tokens"
            >
              <span className="text-xs font-black tracking-tight flex items-center gap-1.5 font-mono">
                🪙 <span className="text-[13px] font-black text-stone-900">{userCredits}</span> {userCredits === 1 ? 'Credit' : 'Credits'}
              </span>
            </div>

            <nav className="relative flex items-center gap-1 bg-stone-150 p-1 rounded-xl border border-stone-200/60 select-none animate-fade-in">
              {(['home', 'tests', 'dashboard', 'pricing'] as const).map((tab) => {
                const isActive = activeTab === tab;
                const label = tab === 'home' ? 'Home' : tab === 'tests' ? 'Practice Tests' : tab === 'dashboard' ? 'My Results' : 'Pricing & Credits';
                return (
                  <button
                    key={tab}
                    onClick={() => changeTab(tab)}
                    className={`relative px-3.5 py-2 text-xs font-bold rounded-lg cursor-pointer transition-colors duration-200 ${
                      isActive ? 'text-stone-900' : 'text-stone-500 hover:text-stone-850'
                    }`}
                  >
                    {isActive && (
                      <>
                        {/* Smooth fluid background pill */}
                        <motion.div
                          layoutId="activeTabIndicator"
                          className="absolute inset-0 bg-white rounded-lg shadow-xs border border-stone-200/40 -z-10"
                          transition={{ type: "spring", stiffness: 140, damping: 18 }}
                        />
                        {/* Custom flowing fluid/water line highlight underneath the tab button */}
                        <motion.div
                          layoutId="activeTabLiquidLine"
                          className="absolute -bottom-[2px] left-[15%] right-[15%] h-[3px] bg-gradient-to-r from-amber-500 via-amber-600 to-amber-500 rounded-full z-10"
                          transition={{ type: "spring", stiffness: 140, damping: 18 }}
                        />
                        {/* Ambient water-glowing aura that trails beautifully behind */}
                        <motion.div
                          layoutId="activeTabLiquidGlow"
                          className="absolute inset-0 rounded-lg bg-amber-500/[0.04] blur-xs -z-20"
                          transition={{ type: "spring", stiffness: 140, damping: 18 }}
                        />
                      </>
                    )}
                    {label}
                  </button>
                );
              })}
            </nav>

            {/* Profile Avatar Badge & Log Out Action */}
            <div className="flex items-center gap-2.5 bg-white border border-stone-200/80 p-1 pl-3 pr-2 rounded-xl text-stone-700 text-xs shrink-0 select-none shadow-2xs">
              <div className="flex flex-col text-right">
                <span className="text-stone-850 font-black max-w-[130px] truncate leading-tight">
                  {currentUser?.name || profileName}
                </span>
                <span className="text-[9px] text-[#FF7A00] font-mono font-bold tracking-tight uppercase leading-none mt-0.5">
                  {"Personal Workspace"}
                </span>
              </div>
              <div className="h-7 w-7 rounded-lg bg-amber-50 text-amber-700 border border-amber-200/60 flex items-center justify-center font-black text-xs shrink-0 select-none">
                {(currentUser?.name || profileName).charAt(0).toUpperCase()}
              </div>
              <button
                id="btn-header-logout"
                onClick={handleLogout}
                className="p-1.5 rounded-lg border border-stone-150 bg-stone-50 hover:bg-rose-50 hover:border-rose-200 hover:text-rose-600 text-stone-400 transition-all cursor-pointer"
                title="Log Out Candidate"
              >
                <LogOut size={12} />
              </button>
            </div>

          </div>

        </div>
      </header>

      {/* Main Container Section */}
      <main className="flex-1 w-full max-w-6xl mx-auto px-6 py-8 overflow-x-hidden">
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={activeTab}
            custom={direction}
            variants={pageVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={pageTransition}
            className="w-full"
          >
            {/* TAB 1: DASHBOARD HOME */}
            {activeTab === 'home' && (
              <div className="space-y-8 max-w-5xl mx-auto">
                <div className="flex flex-col sm:flex-row items-start sm:items-end justify-between gap-4 mb-2">
                   <div>
                      <h2 className="text-2xl sm:text-3xl font-extrabold text-stone-900 tracking-tight leading-tight">
                         Welcome back, {profileName}
                      </h2>
                      <p className="text-stone-500 font-medium text-sm mt-1">
                         Here is your speaking practice overview.
                      </p>
                   </div>
                   <button
                      onClick={() => setActiveTab('tests')}
                      className="px-5 py-2.5 bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs rounded-xl transition-all shadow-sm cursor-pointer flex items-center gap-2"
                   >
                      <Play size={14} className="fill-current" />
                      Start New Test
                   </button>
                </div>

                {/* Top Metrics Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                   <div className="bg-white border border-stone-200/80 p-6 rounded-2xl shadow-xs text-left">
                      <div className="flex items-center gap-3 text-stone-500 mb-3">
                         <div className="p-2 bg-stone-50 border border-stone-100 rounded-lg">
                           <History size={16} />
                         </div>
                         <h3 className="text-xs font-bold uppercase tracking-wider font-mono">Tests Completed</h3>
                      </div>
                      <div className="text-3xl font-black text-stone-900 leading-none">
                         {calculatedStats().count}
                      </div>
                   </div>

                   <div className="bg-white border border-stone-200/80 p-6 rounded-2xl shadow-xs text-left">
                      <div className="flex items-center gap-3 text-stone-500 mb-3">
                         <div className="p-2 bg-stone-50 border border-stone-100 rounded-lg">
                           <Award size={16} />
                         </div>
                         <h3 className="text-xs font-bold uppercase tracking-wider font-mono">Highest Band</h3>
                      </div>
                      <div className="text-3xl font-black text-amber-700 leading-none">
                         {calculatedStats().highest}
                      </div>
                   </div>

                   <div className="bg-white border border-stone-200/80 p-6 rounded-2xl shadow-xs text-left">
                      <div className="flex items-center gap-3 text-stone-500 mb-3">
                         <div className="p-2 bg-stone-50 border border-stone-100 rounded-lg">
                           <TrendingUp size={16} />
                         </div>
                         <h3 className="text-xs font-bold uppercase tracking-wider font-mono">Average Band</h3>
                      </div>
                      <div className="text-3xl font-black text-stone-900 leading-none">
                         {calculatedStats().avg}
                      </div>
                   </div>
                </div>

                {/* Recent Activity Mini-List */}
                <div className="bg-white border border-stone-200/80 rounded-2xl shadow-xs overflow-hidden">
                   <div className="px-6 py-5 border-b border-stone-100 flex items-center justify-between">
                      <h3 className="text-sm font-bold text-stone-900 flex items-center gap-2">
                         <Clock size={16} className="text-stone-400" /> Recent Progress History
                      </h3>
                      <button 
                        onClick={() => setActiveTab('dashboard')}
                        className="text-xs font-bold text-amber-700 hover:text-amber-800 transition-colors flex items-center gap-1 cursor-pointer"
                      >
                         View Full Portfolio <ChevronRight size={14} />
                      </button>
                   </div>
                   
                   <div className="p-6">
                      {savedScores.length === 0 ? (
                         <div className="text-center py-8">
                            <div className="w-12 h-12 rounded-full bg-stone-50 border border-stone-150 flex items-center justify-center mx-auto mb-3 text-stone-300">
                               <ShieldCheck size={20} />
                            </div>
                            <p className="text-xs font-bold text-stone-600 mb-1">No recorded tests.</p>
                            <p className="text-[11px] text-stone-400">Complete a mock simulation to see your history.</p>
                         </div>
                      ) : (
                         <div className="space-y-4">
                            {savedScores.slice(0, 3).map((report) => (
                               <div key={report.id} className="flex items-center justify-between p-4 rounded-xl bg-[#FCFAF6] border border-stone-150 hover:border-amber-200 transition-colors">
                                  <div className="flex items-center gap-4">
                                     <div className="w-10 h-10 rounded-lg bg-white border border-stone-200 text-stone-800 font-bold font-mono text-xs flex items-center justify-center shrink-0">
                                        {report.overall}
                                     </div>
                                     <div className="text-left">
                                        <h4 className="text-sm font-bold text-stone-900 truncate max-w-[200px] sm:max-w-md">{report.title}</h4>
                                        <span className="text-[10px] text-stone-500 font-medium">{report.date}</span>
                                     </div>
                                  </div>
                                  <div className="hidden sm:flex items-center gap-6 text-[10px] font-mono tracking-wide text-stone-500">
                                     <span>F: {report.fluency}</span>
                                     <span>L: {report.lexical}</span>
                                     <span>G: {report.grammar}</span>
                                     <span>P: {report.pronunciation}</span>
                                  </div>
                               </div>
                            ))}
                         </div>
                      )}
                   </div>
                </div>

                {/* Quick Start / Trending */}
                <div className="text-left">
                   <h3 className="text-sm font-bold text-stone-900 mb-4 px-2">Trending Practice Topics</h3>
                   <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {mockList.slice(0, 2).map((mock) => (
                         <div 
                           key={mock.id}
                           onClick={() => setSelectedMock(mock)}
                           className="group flex flex-col justify-between p-5 rounded-2xl bg-white border border-stone-200/80 hover:border-amber-400 shadow-2xs hover:shadow-sm transition-all cursor-pointer"
                         >
                            <div className="flex items-start justify-between mb-2">
                               <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center border border-amber-100 group-hover:bg-amber-600 group-hover:text-white transition-colors">
                                  <Mic size={14} />
                               </div>
                               <ChevronRight size={16} className="text-stone-300 group-hover:text-amber-600 transition-colors" />
                            </div>
                            <h4 className="font-bold text-sm text-stone-900 mb-1">{mock.title}</h4>
                            <p className="text-xs text-stone-500 truncate">{mock.part2.replace(/^Topic \d+:\s*/i, '')}</p>
                         </div>
                      ))}
                   </div>
                </div>

              </div>
            )}

            {/* TAB 2: EXAM HALL */}
            {activeTab === 'tests' && (
              <div id="mock-tests-tab" className="space-y-6">
              {/* Search Control Panel */}
              <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center bg-white border border-stone-200 p-3.5 rounded-2xl shadow-xs">
                <div className="relative flex-1">
                  <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-400" />
                  <input 
                    type="text" 
                    placeholder="Search high-probability topics (e.g. travel, career, hobby)..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-11 pr-4 py-2.5 bg-[#FAF9F5] border border-stone-200 rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-amber-500 transition-all text-stone-800 font-semibold"
                  />
                </div>
                <button
                  id="btn-shuffle-topics"
                  onClick={shuffleMocks}
                  title="Shuffle Topics"
                  className="flex items-center justify-center gap-1.5 px-4 py-2.5 bg-amber-50 border border-amber-250 hover:border-amber-400 text-amber-800 font-bold text-xs rounded-xl hover:bg-amber-100/90 transition-all shadow-2xs whitespace-nowrap cursor-pointer"
                >
                  <Shuffle size={14} className="text-amber-700" />
                  <span>Shuffle Topics</span>
                </button>
              </div>

              {/* Empty Search State */}
              {filteredMocks.length === 0 && (
                <div className="text-center py-16 bg-white border border-stone-200 rounded-3xl shadow-xs max-w-lg mx-auto p-6">
                  <Target size={40} className="mx-auto text-stone-300 mb-4" />
                  <h3 className="text-base font-bold text-stone-700 mb-1">No topics found</h3>
                  <p className="text-xs text-stone-500 leading-relaxed mb-4">We couldn't find any speaking cards matching your search query. Try typing another word.</p>
                  <button onClick={() => setSearchQuery('')} className="text-xs font-bold text-amber-700 bg-amber-50 px-3 py-1.5 rounded-lg border border-amber-200 hover:bg-amber-100 transition-colors cursor-pointer">Clear Search</button>
                </div>
              )}

              {/* Mocks Grid */}
              <div 
                className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3"
              >
                 {searchQuery === '' && (
                   <div
                     onClick={() => setShowCustomModal(true)}
                     className="group relative flex flex-col justify-center items-center bg-amber-50/40 border-2 border-dashed border-amber-300 hover:border-amber-500 hover:bg-amber-50 rounded-2xl p-6 shadow-2xs hover:shadow-sm transition-all duration-300 text-center cursor-pointer min-h-[220px]"
                   >
                     <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center border border-amber-200 group-hover:scale-110 transition-transform duration-300 mb-4">
                       <Plus size={24} />
                     </div>
                     <h3 className="font-display text-base font-extrabold text-stone-900 tracking-tight group-hover:text-amber-800 transition-colors mb-2">
                       Custom Practice Topic
                     </h3>
                     <p className="text-[11px] text-stone-500 max-w-[200px]">
                       Input your own topic or questions and our AI will generate a tailored mock interview.
                     </p>
                   </div>
                 )}
                 {filteredMocks.slice(0, visibleCount).map((mock, idx) => {
                   return (
                     <div
                        key={mock.id}
                        onClick={() => setSelectedMock(mock)}
                        className="group relative flex flex-col justify-between bg-white border border-stone-200 hover:border-amber-400 hover:bg-amber-50/20 rounded-2xl p-6 shadow-2xs hover:shadow-sm transition-all duration-300 text-left cursor-pointer overflow-hidden"
                     >
                        {/* Interactive Colorful Top Line */}
                        <div className="absolute top-0 left-0 right-0 h-[3px] bg-amber-400 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />

                        <div>
                           <div className="flex items-center justify-between mb-4">
                              <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center border border-amber-100 group-hover:bg-amber-600 group-hover:text-white group-hover:border-amber-600 transition-all duration-300">
                                 <Mic size={16} />
                              </div>
                              <span className="text-[10px] font-bold font-mono tracking-widest uppercase px-2.5 py-1 rounded-full bg-stone-100 border border-stone-200 text-stone-500 group-hover:bg-amber-50 group-hover:border-amber-200 group-hover:text-[#B45309] transition-all">
                                 Full Simulation
                              </span>
                           </div>
                           
                           <h3 className="font-display text-base sm:text-[17px] font-extrabold text-stone-900 tracking-tight group-hover:text-amber-800 transition-colors mb-3">
                             {mock.title}
                           </h3>
                           
                           <div className="space-y-3 mt-4 text-xs leading-relaxed">
                              <div className="text-stone-600 font-medium">
                                 <span className="inline-block px-1.5 py-0.5 rounded bg-stone-100/80 text-stone-550 border border-stone-200/40 font-mono font-bold text-[9px] tracking-wider mr-2">PART 2</span>
                                 <span>{mock.part2.replace(/^Topic \d+:\s*/i, '')}</span>
                              </div>
                              <div className="text-stone-450 italic font-medium pt-1">
                                 <span className="inline-block px-1.5 py-0.5 rounded bg-amber-50/60 text-amber-800 border border-amber-100/40 font-mono font-bold text-[9px] tracking-wider mr-2 not-italic">PART 3</span>
                                 <span>{mock.part3[0] || 'Interactive follow-up inquiries'}</span>
                              </div>
                           </div>
                        </div>

                        <div className="mt-6 pt-4 border-t border-stone-105 flex items-center justify-between font-bold text-xs">
                           <span className="text-amber-750 text-amber-700 group-hover:text-[#B45309] transition-colors duration-200">
                              Start Interview Practice
                           </span>
                           <span className="p-1 rounded-md bg-stone-50 border border-stone-200 group-hover:bg-amber-600 group-hover:text-white group-hover:border-amber-600 transition-all text-stone-500">
                             <ChevronRight size={12} className="group-hover:translate-x-0.5 transition-transform duration-200" />
                           </span>
                        </div>
                     </div>
                   );
                 })}
              </div>

              {/* Load More Button */}
              {filteredMocks.length > visibleCount && (
                <div className="mt-8 text-center">
                  <button
                    onClick={handleShowMore}
                    className="px-6 py-2.5 bg-white border border-stone-300 text-stone-700 font-bold text-xs rounded-xl hover:bg-stone-50 transition-all shadow-xs cursor-pointer"
                  >
                    View More Topics
                  </button>
                </div>
              )}
            </div>
          )}

          {/* TAB 4: PRICING & CREDITS */}
          {activeTab === 'pricing' && (
            <div id="pricing-tab" className="max-w-5xl mx-auto space-y-8 text-left animate-fade-in pb-12">
              
              {/* Header section */}
              <div className="text-center max-w-2xl mx-auto space-y-3 pt-4">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-800 text-[10px] font-bold uppercase tracking-wider">
                  <Sparkles size={12} className="animate-pulse" /> Unlock Infinite Practice Cards
                </div>
                <h2 className="text-3xl font-extrabold text-stone-900 tracking-tight leading-none">
                  Telegram Stars Billing Portal
                </h2>
                <p className="text-stone-500 font-medium text-sm leading-relaxed text-center">
                  Unlock premium full-length IELTS Speaking diagnostic sessions. All transactions are securely handled using official Telegram Stars. 1 mock credit = 1 immersive simulation.
                </p>
              </div>

              {/* Account Association Manager Banner */}
              <div className="max-w-4xl mx-auto p-6 bg-stone-900 text-white rounded-3xl shadow-lg border border-stone-800 flex flex-col md:flex-row items-center justify-between gap-6 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/10 blur-3xl rounded-full" />
                <div className="space-y-2 text-center md:text-left z-10">
                  <div className="flex items-center justify-center md:justify-start gap-2">
                    <span className="w-2.5 h-2.5 bg-emerald-500 rounded-full animate-pulse" />
                    <span className="text-[10px] uppercase font-mono font-bold tracking-widest text-[#FF7A00]">
                      Account & Telegram Connection
                    </span>
                  </div>
                  <h3 className="text-base font-extrabold">Account Connection Status</h3>
                  <p className="text-stone-400 text-[11px] leading-normal font-medium max-w-md">
                    Connect your web candidate session to your Telegram profile. Once connected, our bot will automatically credit your account upon receiving Stars payments.
                  </p>
                </div>

                <div className="shrink-0 z-10 w-full md:w-auto">
                  {currentUser?.isSandbox ? (
                    <div className="px-5 py-2.5 bg-stone-800 border border-stone-700/60 text-stone-400 text-xs rounded-xl font-bold font-mono text-center">
                      🔒 Account Link Unavailable
                    </div>
                  ) : dbProfile?.telegram_id ? (
                    <div className="flex flex-col items-center md:items-end gap-1">
                      <div className="px-5 py-2.5 bg-emerald-700 border border-emerald-500/40 text-emerald-100 text-xs rounded-xl font-bold flex items-center gap-1.5 shadow-sm">
                        <Check size={14} className="stroke-[3]" /> Telegram Connected
                      </div>
                      <span className="text-[9px] text-stone-400 font-mono">
                        Linked ID: {dbProfile.telegram_id}
                      </span>
                    </div>
                  ) : (
                    <a
                      href={`https://t.me/${botUsername}?start=${currentUser?.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex w-full md:w-auto items-center justify-center gap-2 px-5 py-2.5 bg-[#FF7A00] hover:bg-[#E06B00] text-stone-950 font-black text-xs uppercase tracking-wider rounded-xl transition-all shadow-md active:scale-95 cursor-pointer text-center"
                    >
                      🔗 Connect @{botUsername}
                    </a>
                  )}
                </div>
              </div>

              {/* Purchase Success Alert Banner */}
              <AnimatePresence>
                {purchaseFeedback && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="p-4 bg-emerald-50 border-2 border-emerald-250/90 rounded-2xl flex items-center gap-3 shadow-md max-w-2xl mx-auto"
                  >
                    <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center shrink-0">
                      <Check size={18} className="stroke-[3]" />
                    </div>
                    <div>
                      <strong className="text-xs font-extrabold text-emerald-950 block">Mocks Credited!</strong>
                      <p className="text-[11px] text-emerald-850 font-semibold">{purchaseFeedback}</p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Grid of Credit Packages */}
              <div className="grid gap-6 md:grid-cols-3 max-w-4xl mx-auto pt-2">
                
                {/* Package 1: 3 Mocks */}
                <div className="bg-white border border-stone-200 hover:border-amber-300 rounded-3xl p-6 shadow-2xs hover:shadow-xs transition-all duration-300 flex flex-col justify-between relative overflow-hidden text-left">
                  <div className="space-y-4">
                    <div className="flex justify-between items-start">
                      <span className="text-[10px] font-bold font-mono tracking-wider uppercase text-stone-500">Trial Bundle</span>
                      <span className="px-2 py-0.5 rounded-md bg-stone-100 text-stone-600 font-bold text-[9px] uppercase">Sprint Prep</span>
                    </div>

                    <div>
                      <h3 className="text-lg font-bold text-stone-900">Starter Pack</h3>
                      <p className="text-xs text-stone-500 mt-1">Excellent to test features and get score breakdowns.</p>
                    </div>

                    <div className="flex items-baseline gap-1 pt-1 justify-start">
                      <span className="text-2xl font-black text-stone-900">100 Stars</span>
                    </div>

                    <div className="pt-2">
                      <div className="flex items-center gap-2 text-stone-800 font-bold text-xs bg-stone-50 p-2.5 rounded-xl border border-stone-150 font-mono">
                        🪙 <span className="text-stone-950 text-sm font-extrabold">3</span> Full AI Mock Tests
                      </div>
                    </div>

                    <ul className="space-y-2 pt-2 text-[11px] font-semibold text-stone-600">
                      <li className="flex items-center gap-2">
                        <Check size={12} className="text-amber-600 stroke-[3]" /> Real-time feedback analytics
                      </li>
                      <li className="flex items-center gap-2">
                        <Check size={12} className="text-amber-600 stroke-[3]" /> Band scores & lexical grids
                      </li>
                      <li className="flex items-center gap-2">
                        <Check size={12} className="text-amber-600 stroke-[3]" /> Secure replay prevention
                      </li>
                    </ul>
                  </div>

                  <div className="mt-8">
                    {dbProfile?.telegram_id ? (
                      <a
                        href={`https://t.me/${botUsername}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block w-full py-2.5 bg-stone-900 hover:bg-stone-950 text-white font-bold text-xs rounded-xl uppercase tracking-wider text-center shadow-2xs transition-all active:scale-97 text-[11px] font-black"
                      >
                        Buy in Telegram Bot (★100)
                      </a>
                    ) : (
                      <button
                        title="Link your Telegram profile first"
                        disabled
                        className="w-full py-2.5 bg-stone-105 bg-stone-100 text-stone-400 font-bold text-xs rounded-xl uppercase tracking-wider text-center cursor-not-allowed border border-stone-200/60"
                      >
                        Connect Bot to Buy
                      </button>
                    )}
                  </div>
                </div>

                {/* Package 2: 10 Mocks */}
                <div className="bg-white border-2 border-amber-300 hover:border-amber-400 rounded-3xl p-6 shadow-xs hover:shadow transition-all duration-300 flex flex-col justify-between relative overflow-hidden text-left">
                  <div className="absolute top-0 right-0 bg-gradient-to-l from-amber-500 to-orange-500 text-white font-black text-[9px] tracking-widest uppercase px-3.5 py-1 rounded-bl-xl shadow-xs">
                    Popular Save 30%
                  </div>

                  <div className="space-y-4">
                    <div className="flex justify-between items-start">
                      <span className="text-[10px] font-bold font-mono tracking-wider uppercase text-amber-700">Practice Set</span>
                    </div>

                    <div>
                      <h3 className="text-lg font-bold text-stone-900">Pro Bundle</h3>
                      <p className="text-xs text-stone-500 mt-1">Perfect selection for intermediate practice drills.</p>
                    </div>

                    <div className="flex items-baseline gap-1 pt-1 justify-start">
                      <span className="text-2xl font-black text-stone-900">350 Stars</span>
                    </div>

                    <div className="pt-2">
                      <div className="flex items-center gap-2 text-amber-800 font-bold text-xs bg-amber-50/70 p-2.5 rounded-xl border border-amber-200/50 font-mono">
                        🪙 <span className="text-stone-950 text-sm font-extrabold">10</span> Full Mock Tests
                      </div>
                    </div>

                    <ul className="space-y-2 pt-2 text-[11px] font-semibold text-stone-600">
                      <li className="flex items-center gap-2">
                        <Check size={12} className="text-amber-600 stroke-[3]" /> Fully unlocked transcripts
                      </li>
                      <li className="flex items-center gap-2">
                        <Check size={12} className="text-amber-600 stroke-[3]" /> Comprehensive synonyms charts
                      </li>
                      <li className="flex items-center gap-2">
                        <Check size={12} className="text-amber-600 stroke-[3]" /> Dedicated payment receipts
                      </li>
                      <li className="flex items-center gap-2">
                        <Check size={12} className="text-amber-600 stroke-[3]" /> Dual performance evaluator keys
                      </li>
                    </ul>
                  </div>

                  <div className="mt-8">
                    {dbProfile?.telegram_id ? (
                      <a
                        href={`https://t.me/${botUsername}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block w-full py-2.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 hover:shadow text-white font-bold text-[11px] font-black rounded-xl uppercase tracking-wider text-center shadow-xs transition-all active:scale-97 cursor-pointer"
                      >
                        Buy in Telegram Bot (★350)
                      </a>
                    ) : (
                      <button
                        disabled
                        className="w-full py-2.5 bg-stone-100 text-stone-400 font-bold text-xs rounded-xl uppercase tracking-wider text-center cursor-not-allowed border border-stone-200/60"
                      >
                        Connect Bot to Buy
                      </button>
                    )}
                  </div>
                </div>

                {/* Package 3: 20 Mocks */}
                <div className="bg-white border border-stone-200 hover:border-purple-300 rounded-3xl p-6 shadow-2xs hover:shadow-xs transition-all duration-300 flex flex-col justify-between relative overflow-hidden text-left">
                  <div className="space-y-4">
                    <div className="flex justify-between items-start">
                      <span className="text-[10px] font-bold font-mono tracking-wider uppercase text-purple-700">Elite Mastery</span>
                      <span className="px-2 py-0.5 rounded-md bg-purple-50 text-purple-700 font-bold text-[9px] uppercase border border-purple-150">Premium Tier</span>
                    </div>

                    <div>
                      <h3 className="text-lg font-bold text-stone-900">Master Prep</h3>
                      <p className="text-xs text-stone-500 mt-1">Excellent for candidate aiming for solid band 8.5+.</p>
                    </div>

                    <div className="flex items-baseline gap-1 pt-1 justify-start">
                      <span className="text-2xl font-black text-stone-900">700 Stars</span>
                    </div>

                    <div className="pt-2">
                      <div className="flex items-center gap-2 text-purple-800 font-bold text-xs bg-purple-50/55 p-2.5 rounded-xl border border-purple-150/50 font-mono">
                        🪙 <span className="text-stone-950 text-sm font-extrabold">20</span> Full Practice Credits
                      </div>
                    </div>

                    <ul className="space-y-2 pt-2 text-[11px] font-semibold text-stone-600">
                      <li className="flex items-center gap-2">
                        <Check size={12} className="text-purple-600 stroke-[3]" /> Top Priority examiner latency
                      </li>
                      <li className="flex items-center gap-2">
                        <Check size={12} className="text-purple-600 stroke-[3]" /> Advanced Gemini high-depth feedback
                      </li>
                      <li className="flex items-center gap-2">
                        <Check size={12} className="text-purple-600 stroke-[3]" /> Permanent saving scorecards
                      </li>
                      <li className="flex items-center gap-2">
                        <Check size={12} className="text-purple-600 stroke-[3]" /> Academic speech pacing guides
                      </li>
                    </ul>
                  </div>

                  <div className="mt-8">
                    {dbProfile?.telegram_id ? (
                      <a
                        href={`https://t.me/${botUsername}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block w-full py-2.5 bg-purple-900 hover:bg-purple-950 text-white font-bold text-[11px] font-black rounded-xl uppercase tracking-wider text-center shadow-2xs transition-all active:scale-97 cursor-pointer"
                      >
                        Buy in Telegram Bot (★700)
                      </a>
                    ) : (
                      <button
                        disabled
                        className="w-full py-2.5 bg-stone-100 text-stone-400 font-bold text-xs rounded-xl uppercase tracking-wider text-center cursor-not-allowed border border-stone-200/60"
                      >
                        Connect Bot to Buy
                      </button>
                    )}
                  </div>
                </div>

              </div>

              {/* Informational card block */}
              <div className="max-w-4xl mx-auto p-6 bg-amber-50/20 border border-amber-200/40 rounded-2xl flex flex-col md:flex-row items-center justify-between gap-6">
                <div className="space-y-1 text-left">
                  <h4 className="text-sm font-bold text-stone-850 flex items-center gap-1.5 font-mono">
                    💡 How do payments activate?
                  </h4>
                  <p className="text-[11px] text-stone-500 font-semibold leading-relaxed">
                    1. Connect your active web account to Telegram using the Connect button above. <br />
                    2. Inside the bot, type or select <strong>/buy</strong> to load your personalized package carousel. <br />
                    3. Submit your Stars tokens securely. Telegram Stars are processed instantly by the server. <br />
                    4. Once successfully credited, refresh your balance below. No sign-outs required!
                  </p>
                </div>
                <div className="shrink-0 flex items-center gap-2 w-full md:w-auto justify-end">
                  <button
                    onClick={() => {
                      if (currentUser && !currentUser.isSandbox) {
                        syncProfile(currentUser.id, currentUser.email);
                      }
                    }}
                    className="px-5 py-2.5 bg-white border border-stone-250 hover:border-amber-400 text-stone-800 hover:text-amber-800 font-extrabold text-[11px] uppercase tracking-wider rounded-xl shadow-2xs transition-all cursor-pointer whitespace-nowrap active:scale-95"
                  >
                    🔄 Update Balance
                  </button>
                </div>
              </div>

              {/* Special Advertisement & Human Grading Promotion Box */}
              <div className="max-w-4xl mx-auto grid gap-6 md:grid-cols-2">
                
                {/* Promo Card 1 */}
                <div className="bg-gradient-to-br from-amber-500/10 to-orange-500/10 border border-amber-200/60 rounded-3xl p-6 relative overflow-hidden flex flex-col justify-between">
                  <div className="space-y-3 text-left">
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-amber-600 text-white font-bold text-[9px] uppercase tracking-wider">
                      Ad / Human Review
                    </div>
                    <h4 className="text-sm font-extrabold text-stone-900">Certified IELTS Examiner Grading Review</h4>
                    <p className="text-xs text-stone-600 leading-relaxed font-semibold">
                      Ensure maximum reliability before booking your real test slot! Send your simulation session recordings and transcription history to our direct Telegram for an expert human examiner detailed scorecard review.
                    </p>
                    <p className="text-[11px] text-amber-800 font-bold">
                      🔥 Premium diagnostic check upgrade – starting at only $7 per report!
                    </p>
                  </div>
                  <div className="pt-4 text-left">
                    <a
                      href="https://t.me/moonbekjon"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-700 hover:text-[#B45309] transition-colors"
                    >
                      Apply via Telegram <ChevronRight size={14} />
                    </a>
                  </div>
                </div>

                {/* Promo Card 2 - Coherence Guide book */}
                <div className="bg-white border border-purple-200 rounded-3xl p-6 relative overflow-hidden flex flex-col justify-between">
                  <div className="space-y-3 text-left">
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-purple-600 text-white font-bold text-[9px] uppercase tracking-wider">
                      Free Guide Book
                    </div>
                    <h4 className="text-sm font-extrabold text-stone-900">IELTS Vocabulary Synergy Guide 2026</h4>
                    <p className="text-xs text-purple-950 font-semibold leading-relaxed">
                      Improve your Lexical Resource on any speaking part by learning the exact academic synonyms, connector structures, task coherence expressions, and natural idiom pairs recommended for Band 8.5+.
                    </p>
                    <p className="text-[11px] text-purple-700 font-bold">
                      🎁 Standard digital PDF download available for free to our community on Telegram.
                    </p>
                  </div>
                  <div className="pt-4 text-left">
                    <a
                      href="https://t.me/moonbekjon"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs font-bold text-purple-700 hover:text-purple-900 transition-colors"
                    >
                      Get File on Telegram <ChevronRight size={14} />
                    </a>
                  </div>
                </div>

              </div>

              {/* Developer Technical & Personal Telegram Support Module */}
              <div className="max-w-4xl mx-auto p-6 sm:p-8 bg-stone-900 text-white rounded-[2rem] border border-stone-800 relative overflow-hidden text-center md:text-left flex flex-col md:flex-row items-center justify-between gap-6 shadow-xl">
                <div className="space-y-2 text-left">
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-stone-800 border border-stone-700 text-stone-300 text-[10px] font-bold uppercase tracking-wider">
                    💬 Live Preparation Support Direct
                  </div>
                  <h3 className="text-lg font-bold tracking-tight text-white leading-none pt-1">Need assistance or found a bug?</h3>
                  <p className="text-xs text-stone-400 font-semibold max-w-xl leading-relaxed mt-2 text-left">
                    Preparing for the IELTS exam can be highly stressful and time-constrained. If you face any issues while completing simulations, want features added, or want customized prep tracks, chat directly with me via my personal Telegram channel: <strong>@moonbekjon</strong>.
                  </p>
                </div>
                <div className="shrink-0 w-full md:w-auto">
                  <a
                    href="https://t.me/moonbekjon"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full md:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 hover:shadow text-stone-950 font-bold text-xs uppercase tracking-wider rounded-xl transition-all shadow-md cursor-pointer"
                  >
                    <MessageSquare size={14} className="fill-current animate-pulse" />
                    Open Support chat
                  </a>
                </div>
              </div>

            </div>
          )}

          {/* TAB 3: PORTFOLIO */}
          {activeTab === 'dashboard' && (
            <div id="dashboard-tab" className="max-w-4xl mx-auto space-y-8">
              {/* Bio & Metric Overview */}
              <div className="bg-white border border-stone-200 p-6 sm:p-8 rounded-2xl flex flex-col md:flex-row gap-6 md:items-center justify-between text-left">
                
                <div className="flex gap-4 items-center">
                   <div className="w-12 h-12 bg-amber-55 bg-amber-100 text-amber-700 rounded-xl flex items-center justify-center border border-amber-200 text-lg font-black font-mono">
                      {profileName ? profileName.slice(0, 2).toUpperCase() : 'ST'}
                   </div>
                   <div className="space-y-1">
                      {isEditingProfile ? (
                        <div className="flex items-center gap-2">
                           <input 
                              type="text" 
                              value={editNameField}
                              onChange={(e) => setEditNameField(e.target.value)}
                              className="px-2.5 py-1 text-xs font-bold border border-amber-400 bg-amber-50 rounded focus:outline-none"
                              autoFocus
                           />
                           <button 
                             onClick={handleSaveName}
                             className="px-2 py-1 bg-amber-600 hover:bg-amber-500 text-white font-bold text-[10px] rounded transition-all cursor-pointer"
                           >
                             Save
                           </button>
                           <button 
                             onClick={() => setIsEditingProfile(false)}
                             className="px-2 py-1 bg-stone-105 bg-stone-100 text-stone-605 text-[10px] rounded transition-all cursor-pointer text-stone-605 hover:bg-stone-200"
                           >
                             Cancel
                           </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                           <h3 className="text-base font-bold text-stone-900 leading-tight">{profileName}</h3>
                           <button 
                             onClick={startEditing}
                             className="p-1 text-stone-400 hover:text-amber-700 transition-colors"
                             title="Edit candidate profile name"
                           >
                             <Edit2 size={12} />
                           </button>
                        </div>
                      )}
                      <p className="text-stone-400 text-[10px] uppercase tracking-wider font-bold font-mono">IELTS Speaking Practice Platform</p>
                   </div>
                </div>

                <div className="bg-[#FCFAF6] border border-stone-150 p-4 rounded-xl flex items-center gap-6 min-w-[240px] justify-around">
                   <div className="text-center">
                      <span className="text-[9px] text-stone-400 uppercase tracking-wider font-mono block mb-1">Average Band</span>
                      <div className="w-10 h-10 rounded-full border border-amber-500 text-amber-800 flex items-center justify-center text-xs font-bold mx-auto">
                         {calculatedStats().avg}
                      </div>
                   </div>
                   <div className="text-center">
                      <span className="text-[9px] text-stone-400 uppercase tracking-wider font-mono block mb-1">Simulations Run</span>
                      <strong className="block text-lg font-black text-stone-900 leading-none">{calculatedStats().count}</strong>
                      <span className="text-[10px] text-emerald-600 font-bold block mt-1">Practice Tracker</span>
                   </div>
                </div>

              </div>

              {/* Speaking History Panel */}
              <div className="space-y-6 text-left">
                 <h3 className="text-base font-bold text-stone-900 flex items-center gap-2">
                    <History className="text-stone-500" size={18} /> Performance Scorecards History
                 </h3>

                 {savedScores.length === 0 ? (
                   <div className="bg-white border border-stone-200/60 p-12 rounded-2xl text-center max-w-md mx-auto space-y-3.5">
                      <Award className="mx-auto text-stone-300" size={32} />
                      <h4 className="text-sm font-bold text-stone-800">No scorecards found yet</h4>
                      <p className="text-xs text-stone-500 leading-relaxed font-semibold">
                         You haven't completed any full exam simulation sets yet. Practice a topic card in the Exam Hall to populate automatic diagnostic assessments here.
                      </p>
                      <button
                         onClick={() => changeTab('tests')}
                         className="px-4 py-2 bg-amber-600 hover:bg-amber-502 hover:bg-amber-500 text-white font-bold text-xs rounded-lg cursor-pointer shadow-xs transition-all"
                      >
                         Open Exam Hall
                      </button>
                   </div>
                 ) : (
                   <div className="space-y-6">
                      {savedScores.map((report) => (
                        <div 
                          key={report.id}
                          className="bg-white border border-stone-200 rounded-2xl p-6 shadow-xs space-y-4"
                        >
                           {/* Header line */}
                           <div 
                              className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-stone-100 p-6 cursor-pointer hover:bg-stone-50 transition-colors"
                              onClick={() => toggleScorecard(report.id)}
                           >
                              <div>
                                 <span className="text-[10px] text-amber-700 font-bold uppercase tracking-wider flex items-center gap-1 font-mono">
                                    <Clock size={11} /> Simulated on {report.date}
                                 </span>
                                 <h4 className="text-base font-bold text-stone-900 mt-1">{report.title}</h4>
                              </div>
                              
                              <div className="flex items-center gap-4">
                                 <div className="flex items-center gap-2">
                                    <span className="text-[10px] text-stone-400 font-semibold">Overall Band:</span>
                                    <div className="bg-amber-600 text-white font-mono text-xs font-bold w-9 h-9 rounded-lg flex items-center justify-center">
                                       {report.overall}
                                    </div>
                                 </div>
                                 <ChevronDown size={18} className={`text-stone-400 transition-transform duration-300 ${expandedScorecards[report.id] ? 'rotate-180 text-amber-600' : ''}`} />
                              </div>
                           </div>

                           <AnimatePresence>
                             {expandedScorecards[report.id] && (
                               <motion.div
                                 initial={{ height: 0, opacity: 0 }}
                                 animate={{ height: "auto", opacity: 1 }}
                                 exit={{ height: 0, opacity: 0 }}
                                 className="overflow-hidden bg-white"
                               >
                                 <div className="p-6 pt-0 space-y-4">

                           {/* Bands breakdown grid */}
                           <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-[#FCFAF6] p-3 rounded-xl border border-stone-150">
                              <div className="space-y-0.5">
                                 <span className="text-[9px] font-bold uppercase tracking-wider font-mono text-stone-400 block">Fluency</span>
                                 <strong className="block text-xs text-stone-850">Band {report.fluency}</strong>
                              </div>
                              <div className="space-y-0.5">
                                 <span className="text-[9px] font-bold uppercase tracking-wider font-mono text-stone-400 block">Lexical</span>
                                 <strong className="block text-xs text-stone-850">Band {report.lexical}</strong>
                              </div>
                              <div className="space-y-0.5">
                                 <span className="text-[9px] font-bold uppercase tracking-wider font-mono text-stone-400 block">Grammar</span>
                                 <strong className="block text-xs text-stone-850">Band {report.grammar}</strong>
                              </div>
                              <div className="space-y-0.5">
                                 <span className="text-[9px] font-bold uppercase tracking-wider font-mono text-stone-400 block">Pronunciation</span>
                                 <strong className="block text-xs text-stone-850">Band {report.pronunciation}</strong>
                              </div>
                           </div>

                           {/* Diagnostic Summary */}
                           <div className="space-y-1">
                              <strong className="text-[10px] text-stone-700 block uppercase tracking-wider font-mono">Examiner Rubric Feedback Report</strong>
                              <p className="text-xs text-stone-600 leading-relaxed font-semibold">
                                 {report.feedback}
                              </p>
                           </div>

                           {/* Criteria insights breakdown boxes */}
                           <div className="grid gap-2.5 sm:grid-cols-2 pt-1 text-[11px] font-semibold leading-relaxed">
                              <div className="p-3 bg-stone-50 rounded-xl border border-stone-150 space-y-0.5">
                                 <strong className="text-stone-750 font-mono tracking-wider text-amber-805 block text-[9px] uppercase">Fluency Breakdown</strong>
                                 <span className="text-stone-500 block text-xs">{typeof report.fluencyBreakdown === 'object' && report.fluencyBreakdown !== null && 'details' in report.fluencyBreakdown ? (report.fluencyBreakdown as any).details : (report.fluencyBreakdown as any)}</span>
                              </div>
                              <div className="p-3 bg-stone-50 rounded-xl border border-stone-150 space-y-0.5">
                                 <strong className="text-stone-750 font-mono tracking-wider text-amber-805 block text-[9px] uppercase">Lexical Breakdown</strong>
                                 <span className="text-stone-500 block text-xs">{typeof report.lexicalBreakdown === 'object' && report.lexicalBreakdown !== null && 'details' in report.lexicalBreakdown ? (report.lexicalBreakdown as any).details : (report.lexicalBreakdown as any)}</span>
                              </div>
                              <div className="p-3 bg-stone-50 rounded-xl border border-stone-150 space-y-0.5">
                                 <strong className="text-stone-750 font-mono tracking-wider text-amber-855 text-amber-800 block text-[9px] uppercase">Grammar Breakdown</strong>
                                 <span className="text-stone-500 block text-xs">{typeof report.grammarBreakdown === 'object' && report.grammarBreakdown !== null && 'details' in report.grammarBreakdown ? (report.grammarBreakdown as any).details : (report.grammarBreakdown as any)}</span>
                              </div>
                              <div className="p-3 bg-stone-50 rounded-xl border border-stone-150 space-y-0.5">
                                 <strong className="text-stone-750 font-mono tracking-wider text-amber-855 text-amber-800 block text-[9px] uppercase">Pronunciation Breakdown</strong>
                                 <span className="text-stone-500 block text-xs">{typeof report.pronunciationBreakdown === 'object' && report.pronunciationBreakdown !== null && 'details' in report.pronunciationBreakdown ? (report.pronunciationBreakdown as any).details : (report.pronunciationBreakdown as any)}</span>
                                 
                                 {typeof report.pronunciationBreakdown === 'object' && report.pronunciationBreakdown !== null && Array.isArray((report.pronunciationBreakdown as any).mispronouncedWords) && (report.pronunciationBreakdown as any).mispronouncedWords.length > 0 && (
                                   <div className="mt-2 flex flex-wrap gap-1.5">
                                     {((report.pronunciationBreakdown as any).mispronouncedWords as string[]).map((word, i) => (
                                        <button
                                          key={i}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            if ('speechSynthesis' in window) {
                                               const utterance = new SpeechSynthesisUtterance(word);
                                               utterance.lang = 'en-GB';
                                               window.speechSynthesis.speak(utterance);
                                            }
                                          }}
                                          className="flex items-center gap-1 px-2 py-1 bg-white border border-rose-200 rounded-md text-rose-700 text-[10px] font-semibold shadow-xs hover:bg-rose-50 transition-colors cursor-pointer"
                                        >
                                          <Volume2 size={10} /> {word}
                                        </button>
                                     ))}
                                   </div>
                                 )}
                              </div>
                           </div>
                           
                                 </div>
                               </motion.div>
                             )}
                           </AnimatePresence>
                        </div>
                      ))}
                   </div>
                 )}
              </div>
            </div>
          )}

          </motion.div>
        </AnimatePresence>
      </main>

      {/* Custom Topic Modal */}
      <AnimatePresence>
        {showCustomModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-950/70 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="bg-white border text-left border-stone-200 rounded-2xl w-full max-w-md shadow-2xl relative overflow-hidden"
            >
              <div className="p-6 border-b border-stone-100 flex items-center justify-between">
                 <div>
                    <h3 className="text-xl font-bold text-stone-900">Custom Mock Topic</h3>
                    <p className="text-xs text-stone-500 mt-1">Our AI will generate a fresh practice scenario.</p>
                 </div>
                 <button onClick={() => setShowCustomModal(false)} className="p-2 text-stone-400 hover:text-stone-700 bg-stone-50 hover:bg-stone-100 rounded-full transition-colors cursor-pointer">
                    <X size={16} />
                 </button>
              </div>

              <div className="p-6">
                 <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-2">
                    Enter any topic or question:
                 </label>
                 <textarea
                    rows={4}
                    value={customTopic}
                    onChange={(e) => setCustomTopic(e.target.value)}
                    placeholder="e.g. Talk about your favorite movie, or a time you failed at something..."
                    className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl text-sm text-stone-800 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:bg-white transition-all font-medium resize-none"
                    disabled={isGeneratingMock}
                 />

                 <div className="mt-6 flex justify-end">
                    <button
                      onClick={handleGenerateCustomMock}
                      disabled={!customTopic.trim() || isGeneratingMock}
                      className="flex items-center gap-2 px-5 py-2.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white font-bold text-sm rounded-xl transition-all shadow-sm cursor-pointer"
                    >
                      {isGeneratingMock ? (
                        <>
                           <Loader2 size={16} className="animate-spin" />
                           Generating...
                        </>
                      ) : (
                        <>
                           <Mic size={16} />
                           Generate & Start
                        </>
                      )}
                    </button>
                 </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Footer */}
      <footer className="bg-white border-t border-stone-200 mt-16 py-8 px-6 text-center text-stone-500 text-xs">
         <div className="max-w-6xl w-full mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
           <div className="text-left space-y-0.5">
              <span className="text-xs font-semibold text-stone-500">IELTS Speaking Simulator © 2026.</span>
              <p className="text-[10px] text-stone-400 font-medium">This preparation simulator helps practice response structure face-to-face with objective Gemini scoring.</p>
           </div>
           
           <div className="flex items-center gap-4 text-xs font-bold text-stone-400">
             <a href="#welcome" onClick={(e) => { e.preventDefault(); changeTab('home'); }} className="hover:text-stone-700 transition">Welcome</a>
             <span>•</span>
             <a href="#test" onClick={(e) => { e.preventDefault(); changeTab('tests'); }} className="hover:text-stone-700 transition">Exam Hall</a>
             <span>•</span>
             <a href="#portfolio" onClick={(e) => { e.preventDefault(); changeTab('dashboard'); }} className="hover:text-stone-700 transition">My Portfolio</a>
           </div>
         </div>
      </footer>

    </div>
  );
}
