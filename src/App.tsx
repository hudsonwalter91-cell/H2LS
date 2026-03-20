import React, { useState, useEffect, useMemo } from 'react';
import { 
  onAuthStateChanged, 
  signInWithPopup,
  GoogleAuthProvider,
  User 
} from 'firebase/auth';
import { 
  doc, 
  onSnapshot, 
  setDoc, 
  collection, 
  query, 
  orderBy, 
  addDoc,
  deleteDoc,
  getDoc,
  writeBatch,
  getDocFromServer
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { 
  Droplets, 
  History as HistoryIcon, 
  Settings as SettingsIcon, 
  Plus, 
  Trash2, 
  ChevronRight,
  CheckCircle2,
  AlertCircle,
  LogIn,
  Trophy,
  Calendar,
  X,
  TrendingUp,
  Award
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  BarChart,
  Bar
} from 'recharts';
import { format, startOfDay, subDays, isSameDay, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { v4 as uuidv4 } from 'uuid';

// --- Utility ---
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Types ---
interface UserSettings {
  weight: number;
  dailyGoal: number;
  hydrationLevel: number; // 1, 2, or 3
  updatedAt: string;
}

interface WaterLog {
  id: string;
  amount: number;
  timestamp: string;
  date: string;
}

// --- Components ---

const ProgressBar = ({ progress }: { progress: number }) => {
  const radius = 70;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (progress / 100) * circumference;

  const colorClass = progress >= 100 ? "text-emerald-500" : progress >= 80 ? "text-amber-500" : "text-rose-500";

  return (
    <div className="relative flex items-center justify-center">
      <svg className="w-48 h-48 transform -rotate-90 drop-shadow-[0_0_15px_rgba(59,130,246,0.1)]">
        <circle
          cx="96"
          cy="96"
          r={radius}
          stroke="currentColor"
          strokeWidth="12"
          fill="transparent"
          className="text-slate-800/50"
        />
        <motion.circle
          cx="96"
          cy="96"
          r={radius}
          stroke="currentColor"
          strokeWidth="12"
          fill="transparent"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1.5, ease: "circOut" }}
          className={cn("transition-colors duration-500", colorClass)}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <motion.span 
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="text-4xl font-black text-white tracking-tighter"
        >
          {Math.round(progress)}%
        </motion.span>
        <span className="text-[10px] text-slate-500 uppercase font-black tracking-[0.2em] mt-1">da meta</span>
      </div>
    </div>
  );
};

const QuickAddButton = ({ amount, onClick }: { amount: number; onClick: (val: number) => void }) => (
  <button
    onClick={() => onClick(amount)}
    className="flex flex-col items-center justify-center p-3 rounded-2xl bg-slate-900 hover:bg-slate-800 active:scale-95 transition-all border border-slate-800"
  >
    <Droplets className="w-5 h-5 text-blue-500 mb-1" />
    <span className="text-sm font-bold text-white">{amount}ml</span>
  </button>
);

const ErrorBoundary = ({ children }: { children: React.ReactNode }) => {
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    const handleError = () => setHasError(true);
    window.addEventListener('error', handleError);
    return () => window.removeEventListener('error', handleError);
  }, []);

  if (hasError) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6 text-center">
        <div className="bg-slate-900 border border-red-500/30 p-8 rounded-3xl max-w-md">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-white mb-2">Ops! Algo deu errado</h2>
          <p className="text-slate-400 text-sm mb-6">
            Ocorreu um erro inesperado no aplicativo.
          </p>
          <button 
            onClick={() => {
              localStorage.clear();
              window.location.reload();
            }}
            className="w-full py-3 bg-blue-600 text-white rounded-xl font-semibold"
          >
            Limpar Dados e Reiniciar
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

// --- Firestore Error Handling ---
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string;
    email?: string;
    emailVerified?: boolean;
    isAnonymous?: boolean;
    tenantId?: string | null;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email || undefined,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// --- Main App ---

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [logs, setLogs] = useState<WaterLog[]>([]);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'history' | 'settings'>('dashboard');
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [customAmount, setCustomAmount] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  // Auth & Login
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsAuthReady(true);
    });
    return unsubscribe;
  }, []);

  const login = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (err) {
      console.error("Login error:", err);
    }
  };

  // Connection Test
  useEffect(() => {
    if (!isAuthReady || !user) return;
    
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration. The client is offline.");
        }
      }
    };
    testConnection();
  }, [isAuthReady, user]);

  // Data Sync & Migration
  useEffect(() => {
    if (!isAuthReady || !user) return;

    const syncData = async () => {
      // Check for migration from localStorage
      const localSettings = localStorage.getItem('h2ls_settings');
      const localLogs = localStorage.getItem('h2ls_logs');

      if (localSettings || localLogs) {
        try {
          const userDoc = await getDoc(doc(db, 'users', user.uid));
          
          // Only migrate if Firestore is empty
          if (!userDoc.exists()) {
            const batch = writeBatch(db);
            
            if (localSettings) {
              batch.set(doc(db, 'users', user.uid), JSON.parse(localSettings));
            }
            
            if (localLogs) {
              const parsedLogs = JSON.parse(localLogs) as WaterLog[];
              parsedLogs.forEach(log => {
                const logRef = doc(collection(db, 'users', user.uid, 'logs'), log.id);
                batch.set(logRef, log);
              });
            }
            
            await batch.commit();
          }
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}`);
        }
        
        // Clear local storage after migration attempt
        localStorage.removeItem('h2ls_settings');
        localStorage.removeItem('h2ls_logs');
      }
    };

    syncData();

    const settingsUnsubscribe = onSnapshot(doc(db, 'users', user.uid), (snapshot) => {
      if (snapshot.exists()) {
        setSettings(snapshot.data() as UserSettings);
      } else {
        setActiveTab('settings');
      }
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, `users/${user.uid}`);
    });

    const logsQuery = query(
      collection(db, 'users', user.uid, 'logs'),
      orderBy('timestamp', 'desc')
    );
    const logsUnsubscribe = onSnapshot(logsQuery, (snapshot) => {
      const newLogs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as WaterLog[];
      setLogs(newLogs);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, `users/${user.uid}/logs`);
    });

    return () => {
      settingsUnsubscribe();
      logsUnsubscribe();
    };
  }, [isAuthReady, user]);

  const todayLogs = useMemo(() => {
    const today = format(new Date(), 'yyyy-MM-dd');
    return logs.filter(log => log.date === today);
  }, [logs]);

  const todayTotal = useMemo(() => {
    return todayLogs.reduce((acc, log) => acc + log.amount, 0);
  }, [todayLogs]);

  const progress = useMemo(() => {
    if (!settings?.dailyGoal) return 0;
    return Math.min((todayTotal / settings.dailyGoal) * 100, 100);
  }, [todayTotal, settings]);

  const addWater = async (amount: number) => {
    if (!user) return;
    const now = new Date();
    const id = uuidv4();
    const path = `users/${user.uid}/logs/${id}`;
    try {
      await setDoc(doc(db, 'users', user.uid, 'logs', id), {
        id,
        amount,
        timestamp: now.toISOString(),
        date: format(now, 'yyyy-MM-dd')
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
    }
  };

  const deleteLog = async (id: string) => {
    if (!user) return;
    const path = `users/${user.uid}/logs/${id}`;
    try {
      await deleteDoc(doc(db, 'users', user.uid, 'logs', id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, path);
    }
  };

  const updateSettings = async (weight: number, level: number, manualGoal?: number, navigate = false) => {
    if (!user) return;
    const path = `users/${user.uid}`;
    
    let goal = manualGoal;
    if (!goal) {
      const multiplier = level === 1 ? 35 : level === 2 ? 40 : 45;
      goal = weight * multiplier;
    }

    const newSettings: UserSettings = {
      weight,
      hydrationLevel: level,
      dailyGoal: goal,
      updatedAt: new Date().toISOString()
    };
    
    try {
      await setDoc(doc(db, 'users', user.uid), newSettings);
      if (navigate) setActiveTab('dashboard');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
    }
  };

  const historyData = useMemo(() => {
    const days = Array.from({ length: 7 }).map((_, i) => {
      const d = subDays(new Date(), i);
      const dateStr = format(d, 'yyyy-MM-dd');
      const dayLogs = logs.filter(log => log.date === dateStr);
      const total = dayLogs.reduce((acc, log) => acc + log.amount, 0);
      const goal = settings?.dailyGoal || 0;
      const percent = goal > 0 ? (total / goal) * 100 : 0;
      
      let status: 'met' | 'almost' | 'below' = 'below';
      if (percent >= 100) status = 'met';
      else if (percent >= 80) status = 'almost';

      const isToday = i === 0;
      const missing = Math.max(0, goal - total);
      
      let statusText = '';
      if (status === 'met') {
        statusText = 'Meta atingida';
      } else if (isToday) {
        statusText = status === 'almost' ? `Quase lá! Faltam ${missing}ml` : `Em progresso! Faltam ${missing}ml`;
      } else {
        statusText = status === 'almost' ? 'Quase lá' : `Faltou ${missing}ml`;
      }

      return {
        date: dateStr,
        displayDate: format(d, 'dd/MM'),
        fullDate: format(d, "EEEE, d 'de' MMMM", { locale: ptBR }),
        ml: total,
        goal: goal,
        percent,
        status,
        statusText,
        isToday,
        logs: dayLogs
      };
    });
    return days;
  }, [logs, settings]);

  const weeklySummary = useMemo(() => {
    const metCount = historyData.filter(d => d.status === 'met').length;
    const avg = historyData.reduce((acc, d) => acc + d.ml, 0) / historyData.length;
    const bestDay = [...historyData].sort((a, b) => b.ml - a.ml)[0];

    let message = "Vamos melhorar amanhã 💧";
    if (metCount >= 5) message = `Incrível! Você bateu sua meta ${metCount} dias essa semana! 🔥`;
    else if (metCount >= 3) message = `Bom trabalho! Você bateu sua meta ${metCount} dias. Continue assim!`;
    else if (metCount > 0) message = `Você bateu sua meta ${metCount} vez. Vamos buscar mais?`;

    return {
      metCount,
      avg: Math.round(avg),
      bestDay,
      message
    };
  }, [historyData]);

  const motivationalPhrase = useMemo(() => {
    if (progress >= 100) return "Meta batida! Você é demais! 🏆";
    if (progress >= 80) return "Quase lá! Só mais um pouco para a meta. 🔥";
    if (progress >= 50) return "Bom progresso! Você está na metade do caminho. 🚀";
    return "Beba um pouco de água agora! Seu corpo precisa. 💧";
  }, [progress]);

  if (!isAuthReady) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <motion.div 
          animate={{ scale: [1, 1.2, 1] }}
          transition={{ repeat: Infinity, duration: 2 }}
          className="text-blue-500"
        >
          <Droplets size={64} />
        </motion.div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-[2.5rem] p-10 text-center space-y-8"
        >
          <div className="bg-blue-500/10 w-20 h-20 rounded-3xl flex items-center justify-center mx-auto">
            <Droplets size={40} className="text-blue-500" />
          </div>
          <div className="space-y-2">
            <h1 className="text-3xl font-black text-white tracking-tighter">H2LS</h1>
            <p className="text-slate-400 text-sm">Hidrate-se com inteligência e acompanhe seu progresso.</p>
          </div>
          <button 
            onClick={login}
            className="w-full py-4 bg-white text-slate-950 rounded-2xl font-black flex items-center justify-center gap-3 hover:bg-slate-200 transition-all"
          >
            <LogIn size={20} />
            Entrar com Google
          </button>
          <p className="text-[10px] text-slate-600 uppercase font-bold tracking-widest">
            Seus dados são salvos na nuvem com segurança
          </p>
        </motion.div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-slate-950 text-slate-200 font-sans selection:bg-blue-500/30">
        <main className="max-w-md mx-auto pb-28 px-6 pt-8">
          <AnimatePresence mode="wait">
            {activeTab === 'dashboard' && (
              <motion.div
                key="dashboard"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-6"
              >
                <header className="flex justify-between items-center">
                  <div>
                    <h1 className="text-xl font-bold text-white">Olá!</h1>
                    <p className={cn(
                      "text-xs font-bold transition-colors duration-500",
                      progress >= 100 ? "text-emerald-500" : progress >= 80 ? "text-amber-500" : "text-blue-400"
                    )}>
                      {motivationalPhrase}
                    </p>
                  </div>
                  <div className="bg-slate-900 p-2 rounded-xl border border-slate-800">
                    <Droplets className="text-blue-500 w-5 h-5" />
                  </div>
                </header>

                <div className="bg-slate-900/40 rounded-3xl p-6 border border-slate-800/50 flex flex-col items-center">
                  <ProgressBar progress={progress} />
                  <div className="mt-6 grid grid-cols-2 gap-4 w-full text-center">
                    <div>
                      <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mb-1">Consumido</p>
                      <p className="text-lg font-bold text-white">{(todayTotal / 1000).toFixed(1)}L</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mb-1">Restante</p>
                      <p className="text-lg font-bold text-white">
                        {Math.max(0, (settings?.dailyGoal || 0) - todayTotal) / 1000}L
                      </p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <QuickAddButton amount={200} onClick={addWater} />
                  <QuickAddButton amount={300} onClick={addWater} />
                  <QuickAddButton amount={500} onClick={addWater} />
                  <QuickAddButton amount={1000} onClick={addWater} />
                </div>

                <button 
                  onClick={() => setShowCustomInput(!showCustomInput)}
                  className="w-full py-3.5 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-bold transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-900/20"
                >
                  <Plus size={18} />
                  Valor Personalizado
                </button>

                {showCustomInput && (
                  <motion.div 
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    className="flex gap-2"
                  >
                    <input 
                      type="number"
                      placeholder="Ex: 150ml"
                      value={customAmount}
                      onChange={(e) => setCustomAmount(e.target.value)}
                      className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button 
                      onClick={() => {
                        if (customAmount) {
                          addWater(parseInt(customAmount));
                          setCustomAmount('');
                          setShowCustomInput(false);
                        }
                      }}
                      className="bg-slate-800 px-6 rounded-xl font-bold"
                    >
                      Add
                    </button>
                  </motion.div>
                )}
              </motion.div>
            )}

            {activeTab === 'history' && (
              <motion.div
                key="history"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-6"
              >
                <header>
                  <h1 className="text-xl font-bold text-white">Histórico</h1>
                  <p className="text-slate-500 text-xs">Acompanhe sua consistência</p>
                </header>

                {/* Weekly Summary Card */}
                <div className="bg-gradient-to-br from-blue-600/20 to-indigo-600/10 rounded-3xl p-5 border border-blue-500/20">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="bg-blue-500 p-2 rounded-xl">
                      <Trophy size={20} className="text-white" />
                    </div>
                    <div>
                      <p className="text-[10px] text-blue-400 uppercase font-bold tracking-widest">Resumo Semanal</p>
                      <p className="text-sm font-bold text-white">{weeklySummary.message}</p>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-3 gap-2">
                    <div className="bg-slate-900/40 rounded-2xl p-3 border border-white/5">
                      <p className="text-[9px] text-slate-500 uppercase font-bold mb-1">Metas</p>
                      <p className="text-lg font-black text-white">{weeklySummary.metCount}<span className="text-[10px] font-normal text-slate-500 ml-0.5">/7</span></p>
                    </div>
                    <div className="bg-slate-900/40 rounded-2xl p-3 border border-white/5">
                      <p className="text-[9px] text-slate-500 uppercase font-bold mb-1">Média</p>
                      <p className="text-lg font-black text-white">{(weeklySummary.avg / 1000).toFixed(1)}<span className="text-[10px] font-normal text-slate-500 ml-0.5">L</span></p>
                    </div>
                    <div className="bg-slate-900/40 rounded-2xl p-3 border border-white/5">
                      <p className="text-[9px] text-slate-500 uppercase font-bold mb-1">Melhor</p>
                      <p className="text-lg font-black text-white">{weeklySummary.bestDay?.displayDate}</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <h2 className="text-sm font-bold text-white uppercase tracking-widest ml-1">Últimos 7 Dias</h2>
                  {historyData.map(day => (
                    <button 
                      key={day.date}
                      onClick={() => setSelectedDay(day.date)}
                      className={cn(
                        "w-full p-4 rounded-2xl border transition-all flex items-center justify-between group relative overflow-hidden",
                        day.isToday 
                          ? "bg-slate-900 border-blue-500 shadow-lg shadow-blue-500/20 scale-[1.02] z-10" 
                          : "bg-slate-900/40 border-slate-800/50",
                        day.status === 'met' && !day.isToday ? "border-emerald-500/20" : 
                        day.status === 'almost' && !day.isToday ? "border-amber-500/20" : 
                        day.status === 'below' && !day.isToday ? "border-rose-500/10" : ""
                      )}
                    >
                      {day.isToday && (
                        <div className="absolute top-0 right-0 bg-blue-500 text-[9px] font-black uppercase px-3 py-1 rounded-bl-xl text-white shadow-lg">
                          Hoje
                        </div>
                      )}
                      <div className="flex items-center gap-4">
                        <div className={cn(
                          "w-12 h-12 rounded-2xl flex items-center justify-center transition-all",
                          day.status === 'met' ? "bg-emerald-500/10 text-emerald-500" : 
                          day.status === 'almost' ? "bg-amber-500/10 text-amber-500" : "bg-rose-500/10 text-rose-500",
                          day.isToday && "scale-110 shadow-inner"
                        )}>
                          {day.status === 'met' ? <CheckCircle2 size={24} /> : 
                           day.status === 'almost' ? <Droplets size={24} /> : <AlertCircle size={24} />}
                        </div>
                        <div className="text-left">
                          <p className={cn(
                            "text-sm font-black",
                            day.isToday ? "text-blue-400" : "text-white"
                          )}>
                            {day.isToday ? 'Hoje' : day.displayDate}
                          </p>
                          <p className={cn(
                            "text-[10px] font-bold uppercase tracking-tight",
                            day.status === 'met' ? "text-emerald-500" : 
                            day.status === 'almost' ? "text-amber-500" : "text-rose-500"
                          )}>
                            {day.statusText}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <p className="text-sm font-black text-white">{(day.ml / 1000).toFixed(1)}L</p>
                          <p className="text-[9px] text-slate-500">{Math.round(day.percent)}% da meta</p>
                        </div>
                        <ChevronRight size={16} className="text-slate-700 group-hover:text-slate-400 transition-colors" />
                      </div>
                    </button>
                  ))}
                </div>

                {/* Day Details Modal */}
                <AnimatePresence>
                  {selectedDay && (
                    <div className="fixed inset-0 z-50 flex items-end justify-center px-4 pb-8 sm:items-center">
                      <motion.div 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={() => setSelectedDay(null)}
                        className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
                      />
                      <motion.div 
                        initial={{ y: 100, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        exit={{ y: 100, opacity: 0 }}
                        className="relative w-full max-w-md bg-slate-900 border border-slate-800 rounded-[2.5rem] p-8 shadow-2xl overflow-hidden"
                      >
                        <button 
                          onClick={() => setSelectedDay(null)}
                          className="absolute top-6 right-6 p-2 bg-slate-800 rounded-full text-slate-400 hover:text-white transition-colors"
                        >
                          <X size={20} />
                        </button>

                        {(() => {
                          const day = historyData.find(d => d.date === selectedDay);
                          if (!day) return null;
                          return (
                            <div className="space-y-6">
                              <header>
                                <p className="text-[10px] text-blue-500 uppercase font-black tracking-widest mb-1">{day.displayDate}</p>
                                <h3 className="text-xl font-bold text-white capitalize">{day.fullDate}</h3>
                              </header>

                              <div className="grid grid-cols-2 gap-4">
                                <div className="bg-slate-950 p-4 rounded-3xl border border-slate-800">
                                  <p className="text-[9px] text-slate-500 uppercase font-bold mb-1">Ingerido</p>
                                  <p className="text-2xl font-black text-white">{(day.ml / 1000).toFixed(1)}<span className="text-sm font-normal text-slate-500 ml-1">Litros</span></p>
                                </div>
                                <div className="bg-slate-950 p-4 rounded-3xl border border-slate-800">
                                  <p className="text-[9px] text-slate-500 uppercase font-bold mb-1">Meta</p>
                                  <p className="text-2xl font-black text-white">{(day.goal / 1000).toFixed(1)}<span className="text-sm font-normal text-slate-500 ml-1">Litros</span></p>
                                </div>
                              </div>

                              <div className="space-y-3">
                                <h4 className="text-[10px] text-slate-500 uppercase font-bold tracking-widest ml-1">Registros do Dia</h4>
                                <div className="max-h-48 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
                                  {day.logs.length === 0 ? (
                                    <p className="text-center py-4 text-slate-600 text-sm italic">Nenhum registro encontrado.</p>
                                  ) : (
                                    day.logs.map(log => (
                                      <div key={log.id} className="bg-slate-950/50 p-3 rounded-2xl border border-slate-800/50 flex justify-between items-center group/log">
                                        <div className="flex items-center gap-3">
                                          <div className="bg-blue-500/10 p-2 rounded-xl">
                                            <Droplets size={14} className="text-blue-500" />
                                          </div>
                                          <span className="text-sm font-bold text-white">{log.amount}ml</span>
                                        </div>
                                        <div className="flex items-center gap-3">
                                          <span className="text-[10px] text-slate-500 font-mono">{format(parseISO(log.timestamp), 'HH:mm')}</span>
                                          <button 
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              deleteLog(log.id);
                                            }}
                                            className="p-1.5 text-slate-600 hover:text-rose-500 hover:bg-rose-500/10 rounded-lg transition-all opacity-0 group-hover/log:opacity-100"
                                          >
                                            <Trash2 size={14} />
                                          </button>
                                        </div>
                                      </div>
                                    ))
                                  )}
                                </div>
                              </div>

                              <div className={cn(
                                "p-4 rounded-2xl flex items-center gap-3",
                                day.status === 'met' ? "bg-emerald-500/10 border border-emerald-500/20" : 
                                day.status === 'almost' ? "bg-amber-500/10 border border-amber-500/20" : "bg-rose-500/10 border border-rose-500/20"
                              )}>
                                <Award className={cn(
                                  "shrink-0",
                                  day.status === 'met' ? "text-emerald-500" : 
                                  day.status === 'almost' ? "text-amber-500" : "text-rose-500"
                                )} />
                                <p className={cn(
                                  "text-xs font-bold",
                                  day.status === 'met' ? "text-emerald-500" : 
                                  day.status === 'almost' ? "text-amber-500" : "text-rose-500"
                                )}>
                                  {day.status === 'met' ? 'Parabéns! Você superou sua meta diária. Seu corpo agradece!' : 
                                   day.status === 'almost' ? 'Você chegou muito perto! Amanhã com certeza você consegue.' : 
                                   'Um dia de cada vez. Tente beber um pouco mais de água amanhã.'}
                                </p>
                              </div>
                            </div>
                          );
                        })()}
                      </motion.div>
                    </div>
                  )}
                </AnimatePresence>
              </motion.div>
            )}

            {activeTab === 'settings' && (
              <motion.div
                key="settings"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-6"
              >
                <header>
                  <h1 className="text-xl font-bold text-white">Configurações</h1>
                  <p className="text-slate-500 text-xs">Personalize sua meta diária</p>
                </header>

                <div className="space-y-5">
                  <div className="bg-slate-900/60 rounded-3xl p-5 border border-slate-800">
                    <label className="block text-[10px] text-slate-500 uppercase font-bold tracking-widest mb-2.5 ml-1">Seu Peso (kg)</label>
                    <input 
                      type="number"
                      defaultValue={settings?.weight}
                      placeholder="Ex: 70"
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        if (val > 0) updateSettings(val, settings?.hydrationLevel || 1);
                      }}
                      className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-5 py-3.5 text-lg font-bold text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div className="space-y-3">
                    <label className="block text-[10px] text-slate-500 uppercase font-bold tracking-widest ml-2">Nível de Hidratação</label>
                    
                    <LevelOption 
                      level={1} 
                      active={settings?.hydrationLevel === 1 || !settings?.hydrationLevel}
                      title="Normal"
                      description="Para quem não treina e não usa creatina."
                      onClick={() => updateSettings(settings?.weight || 70, 1)}
                    />

                    <LevelOption 
                      level={2} 
                      active={settings?.hydrationLevel === 2}
                      title="Uso de Creatina"
                      description="A creatina exige maior ingestão de líquidos."
                      onClick={() => updateSettings(settings?.weight || 70, 2)}
                    />

                    <LevelOption 
                      level={3} 
                      active={settings?.hydrationLevel === 3}
                      title="Creatina + Treino"
                      description="Indicado para quem treina intenso e usa creatina."
                      onClick={() => updateSettings(settings?.weight || 70, 3)}
                    />
                  </div>

                  <div className="bg-slate-900/60 rounded-3xl p-5 border border-slate-800">
                    <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mb-3 ml-1">Meta Calculada</p>
                    <div className="flex items-end gap-2">
                      <span className="text-3xl font-black text-blue-500">
                        {settings?.dailyGoal ? (settings.dailyGoal / 1000).toFixed(1) : '0.0'}
                      </span>
                      <span className="text-sm font-bold text-slate-500 mb-1">Litros / dia</span>
                    </div>
                  </div>

                  <button 
                    onClick={() => setActiveTab('dashboard')}
                    className="w-full py-4 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-bold transition-all shadow-lg shadow-blue-900/20"
                  >
                    Confirmar e Ir para Início
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </main>

        <nav className="fixed bottom-0 left-0 right-0 bg-slate-950/80 backdrop-blur-xl border-t border-slate-800/50 pb-8 pt-4 px-8">
          <div className="max-w-md mx-auto flex justify-between items-center">
            <NavButton 
              active={activeTab === 'dashboard'} 
              onClick={() => setActiveTab('dashboard')}
              icon={<Droplets />}
              label="Início"
            />
            <NavButton 
              active={activeTab === 'history'} 
              onClick={() => setActiveTab('history')}
              icon={<HistoryIcon />}
              label="Histórico"
            />
            <NavButton 
              active={activeTab === 'settings'} 
              onClick={() => setActiveTab('settings')}
              icon={<SettingsIcon />}
              label="Ajustes"
            />
          </div>
        </nav>
      </div>
    </ErrorBoundary>
  );
}

function NavButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-1 transition-all duration-300",
        active ? "text-blue-500 scale-110" : "text-slate-500 hover:text-slate-300"
      )}
    >
      <div className={cn(
        "p-2 rounded-xl transition-all",
        active && "bg-blue-500/10"
      )}>
        {React.cloneElement(icon as React.ReactElement, { size: 24 })}
      </div>
      <span className="text-[10px] font-bold uppercase tracking-tighter">{label}</span>
    </button>
  );
}

function LevelOption({ level, active, title, description, onClick }: { level: number; active: boolean; title: string; description: string; onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "w-full text-left p-4 rounded-2xl border transition-all duration-300",
        active 
          ? "bg-blue-600 border-blue-500 shadow-lg shadow-blue-900/20" 
          : "bg-slate-900/60 border-slate-800 hover:border-slate-700"
      )}
    >
      <div className="flex justify-between items-center mb-0.5">
        <span className={cn("font-bold text-sm", active ? "text-white" : "text-slate-200")}>{title}</span>
        {active && <CheckCircle2 size={14} className="text-white" />}
      </div>
      <p className={cn("text-[10px] leading-relaxed", active ? "text-blue-100" : "text-slate-500")}>
        {description}
      </p>
    </button>
  );
}
