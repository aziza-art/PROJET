import React, { useState, useMemo, useRef, useEffect } from 'react';
import { FeedbackData } from './types';
import QuestionCard from './components/QuestionCard';
import {
  initStudent,
  saveFeedback,
  getHistory,
  getGlobalStats,
  getEnvironmentStats,
  getSubjectsBreakdown,
  downloadHistoryCSV
} from './services/storageService';
import { analyzeFeedback } from './services/geminiService';
import { sendAnalysisToAdmin } from './services/emailService';
import jsQR from 'jsqr';
import {
  Factory, CheckCircle2,
  Target, MessageSquare, BookOpen, Award,
  ShieldCheck, MapPin, Truck, HelpCircle,
  Menu, X, Lock, Info,
  Book, Building2, ArrowLeft,
  Zap, Play, QrCode, Camera, RefreshCw,
  Circle, Clock, CheckCircle, Activity,
  ShieldAlert, Laptop, ArrowRight,
  TrendingUp, LayoutDashboard,
  Flame, Sparkles, BarChart3, PieChart, FileDown
} from 'lucide-react';

type AppStep = 'welcome' | 'hub' | 'scanner' | 'modules' | 'form_pedagogy' | 'form_env' | 'submitting' | 'thanks';

const GI_SUBJECTS = [
  "Algèbre 1",
  "Algorithmique et Programmation C",
  "Analyse 1",
  "Anglais 1",
  "Circuits Électriques",
  "Circuits Électroniques",
  "Environnement Informatique",
  "Français 1",
  "Introduction au Génie Industriel",
  "Mécanique générale",
  "Probabilités et Statistiques"
];

const DRAFT_KEY = "isgi_feedback_draft_v2";

const QRScanner: React.FC<{ onScan: (data: string) => void; onClose: () => void }> = ({ onScan, onClose }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let animationFrameId: number;

    const startCamera = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.setAttribute("playsinline", "true");
          videoRef.current.play();
          requestAnimationFrame(tick);
        }
      } catch (err) {
        setError("Accès caméra refusé. Veuillez autoriser l'accès pour scanner les codes modules.");
      }
    };

    const tick = () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          canvas.height = video.videoHeight;
          canvas.width = video.videoWidth;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imageData.data, imageData.width, imageData.height);
          if (code) onScan(code.data);
        }
      }
      animationFrameId = requestAnimationFrame(tick);
    };

    startCamera();
    return () => {
      if (stream) stream.getTracks().forEach(t => t.stop());
      cancelAnimationFrame(animationFrameId);
    };
  }, [onScan]);

  return (
    <div className="fixed inset-0 z-[200] bg-slate-950 flex flex-col">
      <div className="p-6 flex items-center justify-between border-b border-slate-900 glass-panel">
        <h3 className="font-black text-xs uppercase tracking-[0.3em] text-white flex items-center gap-3">
          <Camera className="w-4 h-4 text-indigo-400" /> Scanner Module ISGI
        </h3>
        <button onClick={onClose} className="p-2 hover:bg-slate-900 rounded-xl transition-colors"><X className="w-6 h-6 text-slate-500" /></button>
      </div>
      <div className="flex-1 relative bg-black flex items-center justify-center overflow-hidden">
        {error ? (
          <div className="text-center p-8 max-w-xs">
            <ShieldAlert className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <p className="text-red-500 font-black uppercase text-[10px] tracking-widest leading-relaxed">{error}</p>
          </div>
        ) : (
          <video ref={videoRef} className="h-full w-full object-cover opacity-60" />
        )}
        <canvas ref={canvasRef} className="hidden" />
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-72 h-72 border-2 border-indigo-500/50 rounded-3xl relative">
            <div className="scanline"></div>
            <div className="absolute -top-1 -left-1 w-8 h-8 border-t-4 border-l-4 border-indigo-400 rounded-tl-xl"></div>
            <div className="absolute -top-1 -right-1 w-8 h-8 border-t-4 border-r-4 border-indigo-400 rounded-tr-xl"></div>
            <div className="absolute -bottom-1 -left-1 w-8 h-8 border-b-4 border-l-4 border-indigo-400 rounded-bl-xl"></div>
            <div className="absolute -bottom-1 -right-1 w-8 h-8 border-b-4 border-r-4 border-indigo-400 rounded-br-xl"></div>
          </div>
        </div>
      </div>
    </div>
  );
};

const App: React.FC = () => {
  const [step, setStep] = useState<AppStep>('welcome');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showValidationErrors, setShowValidationErrors] = useState(false);
  const [completedSubjects, setCompletedSubjects] = useState<string[]>([]);
  const [envAuditDone, setEnvAuditDone] = useState(false);
  const [lastSubmissionId, setLastSubmissionId] = useState('');
  const [adminPasswordInput, setAdminPasswordInput] = useState('');
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
  const [studentId, setStudentId] = useState<string>('');

  // States pour les stats dynamiques
  const [globalStats, setGlobalStats] = useState({ totalFeedbacks: 0, uniqueSubjects: 0, globalAverageScore: 0 });
  const [envStats, setEnvStats] = useState({ transport: {}, laptop: { yes: 0, no: 0, rate: 0 } });
  const [subjectsBreakdown, setSubjectsBreakdown] = useState<{ subject: string; count: number }[]>([]);

  const initialFormData: FeedbackData = {
    subject: '', q1: null, q2: null, q3: null, q4: null, q5: null,
    q6_jobs: null, q7_rooms: null, q8_resources: null, q9_transport: null, q10_laptop: null,
    comments: ''
  };

  const [formData, setFormData] = useState<FeedbackData>(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      return saved ? JSON.parse(saved) : initialFormData;
    } catch {
      return initialFormData;
    }
  });

  useEffect(() => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(formData));
  }, [formData]);

  useEffect(() => {
    const setup = async () => {
      try {
        const id = await initStudent();
        setStudentId(id);
      } catch (err) {
        console.error("Failed to initialize student:", err);
      }
    };
    setup();
  }, []);

  const refreshStats = async () => {
    try {
      const [gs, es, sb, history] = await Promise.all([
        getGlobalStats(),
        getEnvironmentStats(),
        getSubjectsBreakdown(),
        getHistory()
      ]);

      setGlobalStats(gs);
      setEnvStats(es);
      setSubjectsBreakdown(sb);
      const feedbackHistory = history as any[];
      setCompletedSubjects(feedbackHistory.filter(e => e.subject !== 'ENVIRONNEMENT_GLOBAL').map(e => e.subject));
      setEnvAuditDone(feedbackHistory.some(e => e.subject === 'ENVIRONNEMENT_GLOBAL'));
    } catch (err) {
      console.error("Error refreshing stats:", err);
    }
  };

  useEffect(() => {
    refreshStats();
  }, [step, sidebarOpen]); // Refresh stats when sidebar opens or step changes

  const progressStats = useMemo(() => {
    const isEnv = formData.subject === 'ENVIRONNEMENT_GLOBAL';
    const fields = isEnv
      ? [formData.q6_jobs, formData.q7_rooms, formData.q8_resources, formData.q9_transport, formData.q10_laptop]
      : [formData.q1, formData.q2, formData.q3, formData.q4, formData.q5];
    const completed = fields.filter(v => v !== null).length;
    return { percentage: Math.round((completed / 5) * 100), completed, total: 5 };
  }, [formData]);

  const getSubjectStatus = (name: string) => {
    if (completedSubjects.includes(name)) return 'Terminé';
    if (formData.subject === name && progressStats.completed > 0) return 'En cours';
    return 'À faire';
  };

  const startPedagogy = (subject: string) => {
    if (formData.subject !== subject) {
      setFormData({ ...initialFormData, subject });
    }
    setStep('form_pedagogy');
    setShowValidationErrors(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const startEnvAudit = () => {
    if (formData.subject !== 'ENVIRONNEMENT_GLOBAL') {
      setFormData({ ...initialFormData, subject: 'ENVIRONNEMENT_GLOBAL' });
    }
    setStep('form_env');
    setShowValidationErrors(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (progressStats.completed < 5) {
      setShowValidationErrors(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setStep('submitting');
    if (!studentId) {
      throw new Error("Student not initialized");
    }
    const id = await saveFeedback(formData, studentId);
    setLastSubmissionId(id);
    const analysis = await analyzeFeedback(formData);
    await sendAnalysisToAdmin(formData, analysis);
    localStorage.removeItem(DRAFT_KEY);
    setFormData(initialFormData);
    setStep('thanks');
  } catch {
    setStep('thanks');
  }
};

// --- Calculs pour l'affichage (Barres de progression) ---
const totalStepsCount = GI_SUBJECTS.length + 1; // Modules + Environnement
const currentProgressCount = completedSubjects.length + (envAuditDone ? 1 : 0);
const globalProgression = Math.round((currentProgressCount / totalStepsCount) * 100);
const firstUncompleted = GI_SUBJECTS.find(s => !completedSubjects.includes(s));

return (
  <div className="min-h-screen text-slate-100 pb-20 selection:bg-indigo-500/30">
    {step === 'scanner' && (
      <QRScanner
        onScan={(d) => { const s = GI_SUBJECTS.find(x => d.includes(x)); if (s) startPedagogy(s); }}
        onClose={() => setStep('hub')}
      />
    )}

    {/* Sidebar Admin Simulé */}
    <div className={`fixed inset-y-0 left-0 z-[150] bg-slate-950 border-r border-slate-900 transform transition-all duration-500 shadow-2xl flex flex-col w-80 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
      <div className="p-6 flex items-center justify-between border-b border-slate-900">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-5 h-5 text-indigo-400" />
          <h3 className="font-black text-[10px] uppercase tracking-[0.25em] text-white">Console Admin ISGI</h3>
        </div>
        <button onClick={() => setSidebarOpen(false)} className="p-2 hover:bg-slate-900 rounded-xl transition-colors"><X className="w-5 h-5 text-slate-500" /></button>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        {!isAdminAuthenticated ? (
          <div className="h-full flex flex-col items-center justify-center text-center space-y-8 animate-in fade-in zoom-in duration-300">
            <div className="relative">
              <Lock className="w-16 h-16 text-slate-800" />
              <div className="absolute -top-1 -right-1 w-4 h-4 bg-indigo-500 rounded-full animate-pulse"></div>
            </div>
            <div>
              <h4 className="text-xl font-black text-white uppercase italic">Accès Sécurisé</h4>
              <p className="text-[10px] uppercase text-slate-500 tracking-widest mt-2">Réservé au Comité Interne d'Assurance Qualité</p>
            </div>
            <div className="w-full max-w-xs space-y-3">
              <input
                type="password"
                value={adminPasswordInput}
                onChange={(e) => setAdminPasswordInput(e.target.value)}
                placeholder="Mot de passe confidentiel"
                className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-4 text-white text-xs tracking-widest text-center focus:border-indigo-500 outline-none transition-all placeholder:text-slate-700"
              />
              <button
                type="button"
                onClick={() => {
                  if (adminPasswordInput === 'ADMIN2026') setIsAdminAuthenticated(true);
                  else alert('Accès refusé. Veuillez contacter la direction.');
                }}
                className="w-full py-4 bg-indigo-600 hover:bg-indigo-500 rounded-xl text-[10px] font-black uppercase text-white tracking-[0.2em] transition-all hover:scale-[1.02] active:scale-95"
              >
                Authentification
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-8 animate-in slide-in-from-right duration-500">
            {/* Header Auth */}
            <div className="flex items-center gap-4 bg-emerald-500/10 border border-emerald-500/20 p-4 rounded-2xl">
              <div className="p-2 bg-emerald-500 rounded-lg">
                <ShieldCheck className="w-6 h-6 text-white" />
              </div>
              <div>
                <h4 className="font-black text-emerald-400 uppercase text-xs tracking-widest">Session Active</h4>
                <p className="text-[10px] text-emerald-600/60 font-medium">Privilèges Administrateur accordés</p>
              </div>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-slate-900 p-4 rounded-2xl border border-slate-800">
                <p className="text-3xl font-black text-white">{globalStats.totalFeedbacks}</p>
                <p className="text-[9px] uppercase text-slate-500 font-bold tracking-wider mt-1">Évaluations</p>
              </div>
              <div className="bg-slate-900 p-4 rounded-2xl border border-slate-800">
                <p className="text-3xl font-black text-indigo-400">{globalStats.globalAverageScore}<span className="text-lg text-slate-600">%</span></p>
                <p className="text-[9px] uppercase text-slate-500 font-bold tracking-wider mt-1">Satisfaction Globale</p>
              </div>
            </div>

            {/* Stats Environnement */}
            <div className="space-y-4">
              <h5 className="text-[10px] font-black uppercase text-slate-400 tracking-widest flex items-center gap-2">
                <BarChart3 className="w-3 h-3" /> Focus Environnement
              </h5>

              {/* PC Rate */}
              <div className="bg-slate-900 p-5 rounded-2xl border border-slate-800 relative overflow-hidden">
                <div className="flex justify-between items-end relative z-10">
                  <div>
                    <p className="text-2xl font-black text-white">{envStats.laptop.rate}%</p>
                    <p className="text-[9px] uppercase text-slate-500 font-bold">Équipement PC Portable</p>
                  </div>
                  <Laptop className="w-8 h-8 text-slate-800" />
                </div>
                <div className="absolute bottom-0 left-0 h-1 bg-gradient-to-r from-indigo-500 to-purple-500 transition-all duration-1000" style={{ width: `${envStats.laptop.rate}%` }}></div>
              </div>

              {/* Transport Distribution */}
              <div className="bg-slate-900 p-5 rounded-2xl border border-slate-800 space-y-4">
                <p className="text-[9px] uppercase text-slate-500 font-bold mb-2">Mobilité Étudiante</p>
                <div className="space-y-3">
                  {(Object.entries(envStats.transport) as [string, number][]).map(([mode, count], idx) => (
                    <div key={mode} className="flex items-center gap-3">
                      <span className="text-[10px] font-bold text-slate-400 w-12">{mode}</span>
                      <div className="flex-1 h-2 bg-slate-950 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${['bg-blue-500', 'bg-emerald-500', 'bg-yellow-500', 'bg-purple-500'][idx % 4]}`} style={{ width: `${globalStats.totalFeedbacks > 0 ? (count / globalStats.totalFeedbacks) * 100 : 0}%` }}></div>
                      </div>
                      <span className="text-[10px] font-bold text-white w-4 text-right">{count}</span>
                    </div>
                  ))}
                  {Object.keys(envStats.transport).length === 0 && <p className="text-[10px] text-slate-600 italic">Aucune donnée de transport.</p>}
                </div>
              </div>
            </div>

            {/* Breakdown Subjects */}
            <div className="space-y-4">
              <h5 className="text-[10px] font-black uppercase text-slate-400 tracking-widest flex items-center gap-2">
                <PieChart className="w-3 h-3" /> Détail Modules
              </h5>
              <div className="bg-slate-900 rounded-2xl border border-slate-800 divide-y divide-slate-800/50 max-h-60 overflow-y-auto">
                {subjectsBreakdown.map((item) => (
                  <div key={item.subject} className="p-3 flex items-center justify-between hover:bg-slate-800/50 transition-colors">
                    <span className="text-[10px] font-bold text-slate-300 truncate max-w-[180px]">{item.subject}</span>
                    <span className="text-[10px] font-mono font-black text-white bg-slate-800 px-2 py-0.5 rounded-md">{item.count}</span>
                  </div>
                ))}
                {subjectsBreakdown.length === 0 && <p className="p-4 text-[10px] text-slate-600 italic text-center">Aucun module évalué.</p>}
              </div>
            </div>

            <div className="pt-4 border-t border-slate-900">
              <button
                onClick={() => downloadHistoryCSV()}
                className="w-full py-4 bg-slate-800 hover:bg-indigo-600 hover:text-white rounded-xl border border-slate-700 text-[10px] font-black uppercase text-slate-400 tracking-widest transition-all flex items-center justify-center gap-2 group"
              >
                <FileDown className="w-4 h-4 group-hover:animate-bounce" /> Export Données CSV
              </button>
            </div>
          </div>
        )}
      </div>
    </div>

    <header className="bg-slate-950/60 backdrop-blur-xl border-b border-slate-900 sticky top-0 z-50 h-16 flex items-center px-6">
      <div className="max-w-4xl mx-auto w-full flex items-center justify-between">
        <div className="flex items-center gap-3 cursor-pointer group" onClick={() => setStep('welcome')}>
          <div className="p-1.5 bg-indigo-600 rounded-lg shadow-indigo-500/20 shadow-lg group-hover:scale-110 transition-transform"><Factory className="text-white w-4 h-4" /></div>
          <h1 className="font-black text-sm uppercase tracking-tighter">ISGI <span className="text-indigo-400">QUALITÉ</span></h1>
        </div>
        <button onClick={() => setSidebarOpen(true)} className="p-2 hover:bg-slate-900 rounded-xl text-slate-400"><Menu className="w-5 h-5" /></button>
      </div>
    </header>

    <main className="max-w-3xl mx-auto px-6 py-8">
      {step === 'welcome' && (
        <div className="py-20 text-center space-y-12 animate-in fade-in duration-700">
          <div className="relative inline-block">
            <ShieldCheck className="w-24 h-24 text-indigo-400 mx-auto relative z-10" />
            <div className="absolute inset-0 bg-indigo-500/20 blur-3xl rounded-full animate-pulse"></div>
          </div>
          <div className="space-y-4">
            <h2 className="text-5xl md:text-6xl font-black uppercase italic tracking-tighter leading-none">Diagnostic ISGI <br /><span className="text-indigo-500">Génie Industriel</span></h2>
            <p className="text-slate-500 font-bold uppercase tracking-[0.3em] text-[10px]">Amélioration Continue • Excellence Académique</p>
          </div>
          <button onClick={() => setStep('hub')} className="w-full py-10 bg-indigo-600 hover:bg-indigo-500 rounded-[40px] font-black uppercase text-white shadow-2xl border-b-8 border-indigo-800 transition-all active:translate-y-1 hover:scale-[1.01]">Initialiser l'Audit</button>
        </div>
      )}

      {step === 'hub' && (
        <div className="space-y-10 animate-in slide-in-from-bottom-6 duration-500">
          {/* Bannière de Progression Globale */}
          <div className="bg-slate-900/60 border-2 border-slate-800 rounded-[48px] p-8 md:p-10 shadow-2xl relative overflow-hidden">
            <div className="absolute -right-10 -top-10 opacity-10 pointer-events-none">
              <TrendingUp size={240} className="text-indigo-400" />
            </div>
            <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-8">
              <div className="space-y-2">
                <p className="text-[10px] font-black uppercase tracking-[0.4em] text-indigo-400">Statut de l'Audit ISGI</p>
                <h2 className="text-5xl md:text-7xl font-black text-white italic tracking-tighter uppercase leading-none">
                  {currentProgressCount} <span className="text-slate-700">/ {totalStepsCount}</span>
                </h2>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{totalStepsCount - currentProgressCount} étapes restantes</p>
              </div>
              <div className="flex-1 max-w-sm w-full space-y-4">
                <div className="flex justify-between items-end px-1">
                  <span className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">{globalProgression}% ARCHIVÉ</span>
                  {globalProgression === 100 && <Sparkles className="w-4 h-4 text-emerald-400 animate-pulse" />}
                </div>
                <div className="h-6 bg-slate-950 rounded-full border-2 border-slate-800 p-1 relative shadow-inner overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-indigo-700 to-indigo-400 rounded-full transition-all duration-1000" style={{ width: `${globalProgression}%` }}>
                    <div className="absolute inset-0 bg-white/20 animate-shimmer"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <h2 className="text-3xl font-black uppercase italic leading-none flex items-center gap-3">
              <LayoutDashboard className="w-6 h-6 text-indigo-400" /> Console Étudiant
            </h2>
            <button onClick={() => setStep('scanner')} className="p-4 bg-indigo-500/10 border border-indigo-500/30 rounded-2xl text-indigo-400 hover:bg-indigo-500 hover:text-white transition-all"><QrCode className="w-6 h-6" /></button>
          </div>

          {/* Grille des modules académiques */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {GI_SUBJECTS.map((s) => {
              const status = getSubjectStatus(s);
              const isDone = status === 'Terminé';
              const isProgress = status === 'En cours';
              return (
                <button key={s} onClick={() => !isDone && startPedagogy(s)} className={`p-5 rounded-3xl border transition-all text-left group flex flex-col gap-3 h-full ${isDone ? 'bg-emerald-500/5 border-emerald-500/30' :
                  isProgress ? 'bg-indigo-500/10 border-indigo-500/50 ring-1 ring-indigo-500/20' :
                    'bg-slate-950/40 border-slate-800 hover:border-slate-600'
                  }`}>
                  <div className="flex items-center justify-between">
                    {isDone ? <CheckCircle className="w-4 h-4 text-emerald-400" /> : isProgress ? <Clock className="w-4 h-4 text-indigo-400 animate-pulse" /> : <Circle className="w-4 h-4 text-slate-700" />}
                    <span className={`text-[8px] font-black uppercase tracking-tighter ${isDone ? 'text-emerald-400' : isProgress ? 'text-indigo-400' : 'text-slate-600'}`}>{status}</span>
                  </div>
                  <p className={`text-[10px] font-black uppercase leading-tight line-clamp-2 ${isDone ? 'text-emerald-100' : isProgress ? 'text-indigo-100' : 'text-slate-400 group-hover:text-white'}`}>{s}</p>
                </button>
              );
            })}
          </div>

          {/* Audit Environnemental & Actions Globales */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pb-12">
            <button onClick={startEnvAudit} className={`p-10 rounded-[40px] border-2 transition-all text-left group flex flex-col justify-between h-64 ${envAuditDone ? 'bg-emerald-500/5 border-emerald-500/30' : 'bg-slate-900/40 border-slate-800 hover:border-emerald-500/50'}`}>
              <Building2 className={`w-12 h-12 transition-transform group-hover:scale-110 ${envAuditDone ? 'text-emerald-400' : 'text-slate-600'}`} />
              <div>
                <h3 className="text-2xl font-black uppercase text-white">Environnement</h3>
                <p className={`text-[10px] font-black uppercase tracking-[0.3em] mt-2 ${envAuditDone ? 'text-emerald-400' : 'text-slate-500'}`}>{envAuditDone ? 'Audit Clôturé' : 'Audit Infrastructure & Logistique'}</p>
              </div>
            </button>

            {firstUncompleted && (
              <button onClick={() => startPedagogy(firstUncompleted)} className="p-10 rounded-[40px] bg-indigo-600 border-2 border-indigo-500 hover:bg-indigo-500 transition-all text-left group flex flex-col justify-between h-64 shadow-2xl">
                <Zap className="text-white w-12 h-12 group-hover:rotate-12 transition-transform" />
                <div>
                  <h3 className="text-2xl font-black text-white uppercase leading-none">Prochaine Étape</h3>
                  <p className="text-[10px] font-bold text-indigo-100 uppercase mt-2 tracking-widest truncate">{firstUncompleted}</p>
                </div>
              </button>
            )}
          </div>
        </div>
      )}

      {(step === 'form_pedagogy' || step === 'form_env') && (
        <form onSubmit={handleFormSubmit} className="space-y-10 pb-40 animate-in slide-in-from-bottom-10 duration-500">
          <div className="flex items-center gap-4 mb-4">
            <button type="button" onClick={() => setStep('hub')} className="p-3 bg-slate-900 rounded-xl text-slate-500 hover:text-white transition-colors"><ArrowLeft className="w-5 h-5" /></button>
            <h2 className="text-3xl font-black uppercase italic text-white leading-tight truncate">{formData.subject === 'ENVIRONNEMENT_GLOBAL' ? 'Cadre de Vie' : formData.subject}</h2>
          </div>

          <div className="space-y-6">
            {step === 'form_pedagogy' ? (
              <>
                <QuestionCard number={1} icon={Target} text="Objectifs clairs au démarrage ?" value={formData.q1} onChange={v => setFormData({ ...formData, q1: v as number })} showError={showValidationErrors} />
                <QuestionCard number={2} icon={MessageSquare} text="Échanges et questions favorisés ?" value={formData.q2} onChange={v => setFormData({ ...formData, q2: v as number })} showError={showValidationErrors} />
                <QuestionCard number={3} icon={Info} text="Disponibilité de l'enseignant ?" value={formData.q3} onChange={v => setFormData({ ...formData, q3: v as number })} showError={showValidationErrors} />
                <QuestionCard number={4} icon={BookOpen} text="Supports structurés et utiles ?" value={formData.q4} onChange={v => setFormData({ ...formData, q4: v as number })} showError={showValidationErrors} />
                <QuestionCard number={5} icon={Award} text="Évaluations pertinentes ?" value={formData.q5} onChange={v => setFormData({ ...formData, q5: v as number })} showError={showValidationErrors} />
              </>
            ) : (
              <>
                <QuestionCard number={1} icon={HelpCircle} text="Débouchés GI bien connus ?" value={formData.q6_jobs} onChange={v => setFormData({ ...formData, q6_jobs: v as string })} showError={showValidationErrors} options={[{ label: 'Oui', value: 'Oui' }, { label: 'Non', value: 'Non' }, { label: 'Flou', value: 'Flou' }]} />
                <QuestionCard number={2} icon={MapPin} text="Confort et état des salles ?" value={formData.q7_rooms} onChange={v => setFormData({ ...formData, q7_rooms: v as number })} showError={showValidationErrors} />
                <QuestionCard number={3} icon={ShieldCheck} text="Accès suffisant aux ressources ?" value={formData.q8_resources} onChange={v => setFormData({ ...formData, q8_resources: v as number })} showError={showValidationErrors} />
                <QuestionCard number={4} icon={Truck} text="Moyen de transport dominant ?" value={formData.q9_transport} onChange={v => setFormData({ ...formData, q9_transport: v as string })} showError={showValidationErrors} options={[{ label: 'Bus', value: 'Bus' }, { label: 'Voiture', value: 'Voiture' }, { label: 'Taxi', value: 'Taxi' }, { label: 'Moto', value: 'Moto' }]} />
                <QuestionCard number={5} icon={Laptop} text="Possession d'un PC portable ?" value={formData.q10_laptop} onChange={v => setFormData({ ...formData, q10_laptop: v as string })} showError={showValidationErrors} options={[{ label: 'Oui', value: 'Oui' }, { label: 'Non', value: 'Non' }]} />
              </>
            )}
          </div>

          <div className="p-10 bg-slate-900/40 rounded-[48px] border-2 border-slate-800 glass-panel">
            <label className="text-xs font-black uppercase text-slate-500 tracking-[0.2em] block mb-6">Observations libres</label>
            <textarea value={formData.comments} onChange={e => setFormData({ ...formData, comments: e.target.value })} placeholder="Suggestions d'amélioration..." className="w-full h-40 bg-slate-950 border-2 border-slate-800 rounded-3xl p-8 text-sm focus:border-indigo-500 outline-none transition-all" />
          </div>

          <div className="sticky bottom-6 px-4">
            <button type="submit" className="w-full py-12 bg-emerald-600 hover:bg-emerald-500 rounded-[50px] font-black uppercase tracking-[0.5em] text-white shadow-2xl border-b-8 border-emerald-800 transition-all hover:scale-[1.02] active:translate-y-2">Soumettre le Diagnostic</button>
          </div>
        </form>
      )}

      {step === 'submitting' && (
        <div className="fixed inset-0 z-[200] bg-slate-950/95 flex flex-col items-center justify-center backdrop-blur-2xl">
          <RefreshCw className="w-24 h-24 text-indigo-500 animate-spin mb-12" />
          <p className="text-3xl font-black text-white uppercase italic tracking-tighter">Archivage ISGI...</p>
        </div>
      )}

      {step === 'thanks' && (
        <div className="py-20 text-center space-y-16 animate-in zoom-in duration-700">
          <div className="w-40 h-40 bg-emerald-500 rounded-[60px] flex items-center justify-center mx-auto rotate-12 shadow-2xl border-8 border-emerald-400/50">
            <CheckCircle2 className="w-24 h-24 text-white" />
          </div>
          <div className="space-y-6">
            <h2 className="text-7xl font-black text-white uppercase italic tracking-tighter leading-none">Diagnostic Validé</h2>
            <p className="text-slate-400 font-mono text-xs uppercase tracking-widest">JETON: {lastSubmissionId}</p>
          </div>
          <button onClick={() => setStep('hub')} className="w-full py-10 bg-indigo-600 hover:bg-indigo-500 rounded-[40px] font-black uppercase tracking-widest text-white shadow-xl transition-all">Retour au Hub</button>
        </div>
      )}
    </main>

    <footer className="py-12 text-center opacity-30 border-t border-slate-900/50 mt-20">
      <p className="text-[10px] font-black text-slate-700 uppercase tracking-[0.6em] mb-2">ISGI • Génie Industriel</p>
      <p className="text-[8px] font-mono text-slate-800 uppercase tracking-widest">Système d'Audit Qualité Académique</p>
    </footer>
  </div>
);
};

export default App;