export type RatingValue = number | string | null;

export type FeedbackType = 'module' | 'global_env';

export interface AnalysisResult {
  summary: string;
  recommendations: string[];
  sentiment: string;
}

export interface FeedbackData {
  subject: string;
  // Section 1: Pédagogie (25, 50, 75, 100)
  q1: number | null; // Objectifs
  q2: number | null; // Échanges
  q3: number | null; // Disponibilité
  q4: number | null; // Supports
  q5: number | null; // Évaluations
  // Section 2: Environnement & Métiers
  q6_jobs: string | null; // Connaissance métiers (Oui/Non/Flou)
  q7_rooms: number | null; // Salles (25, 50, 75, 100%)
  q8_resources: number | null; // Ressources (25, 50, 75, 100%)
  q9_transport: string | null; // Transport
  q10_laptop: string | null; // Ordinateur portable (Oui/Non)
  comments: string;
}

export interface FeedbackEntry extends FeedbackData {
  id: string;
  timestamp: string; // Date_Heure automatique
}

export interface SubjectStats {
  averageScore: number;
  totalEntries: number;
  qAverages: Record<string, number>;
}

export interface GlobalStats {
  totalFeedbacks: number;
  uniqueSubjects: number;
  globalAverageScore: number;
}

export interface EnvironmentStats {
  transport: Record<string, number>;
  laptop: {
    yes: number;
    no: number;
    rate: number;
  };
}