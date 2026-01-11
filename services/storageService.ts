import { supabase } from '../supabaseClient';
import { FeedbackData, FeedbackEntry, GlobalStats, EnvironmentStats } from "../types";

const DEVICE_ID_KEY = "isgi_student_device_id";

// Helper to get or create a persistent device ID
const getDeviceId = (): string => {
  let deviceId = localStorage.getItem(DEVICE_ID_KEY);
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, deviceId);
  }
  return deviceId;
};

// Initialize student - ensures exists in DB
export const initStudent = async (): Promise<string> => {
  const deviceId = getDeviceId();

  // Check if student exists
  const { data: existing } = await supabase
    .from('students')
    .select('id')
    .eq('device_id', deviceId)
    .single();

  if (existing) {
    return existing.id;
  }

  // Create new student
  const { data: newStudent, error } = await supabase
    .from('students')
    .insert({ device_id: deviceId })
    .select('id')
    .single();

  if (error || !newStudent) throw error || new Error('Failed to create student');
  return newStudent.id;
};

// Get total unique students count
export const getTotalStudents = async (): Promise<number> => {
  const { count, error } = await supabase
    .from('students')
    .select('*', { count: 'exact', head: true });

  if (error) return 0;
  return count || 0;
};

export const saveFeedback = async (data: FeedbackData, studentId: string): Promise<string> => {
  try {
    const { data: inserted, error } = await supabase
      .from('feedbacks')
      .insert({
        student_id: studentId,
        subject: data.subject,
        q1: data.q1,
        q2: data.q2,
        q3: data.q3,
        q4: data.q4,
        q5: data.q5,
        q6_jobs: data.q6_jobs,
        q7_rooms: data.q7_rooms,
        q8_resources: data.q8_resources,
        q9_transport: data.q9_transport,
        q10_laptop: data.q10_laptop,
        comments: data.comments
      })
      .select('id')
      .single();

    if (error) throw error;
    return inserted.id;
  } catch (e) {
    console.error("Error saving feedback:", e);
    throw e;
  }
};

// Fetch history. If studentId is provided, returns specific student history.
// If no studentId, implied Admin view (all history).
export const getHistory = async (studentId?: string): Promise<FeedbackEntry[]> => {
  let query = supabase.from('feedbacks').select('*').order('created_at', { ascending: false });

  if (studentId) {
    query = query.eq('student_id', studentId);
  }

  const { data, error } = await query;

  if (error) {
    console.error("Error fetching history:", error);
    return [];
  }

  return (data || []).map((item: any) => ({
    ...item,
    timestamp: new Date(item.created_at).toLocaleString('fr-FR'),
  })) as FeedbackEntry[];
};

export const getGlobalStats = async (): Promise<GlobalStats> => {
  const history = await getHistory(); // Get all
  const totalFeedbacks = history.length;
  const subjects = new Set(history.map(e => e.subject));
  const uniqueSubjects = subjects.size;

  if (totalFeedbacks === 0) {
    return { totalFeedbacks: 0, uniqueSubjects: 0, globalAverageScore: 0 };
  }

  let totalScoreSum = 0;
  let scoreCount = 0;

  history.forEach(entry => {
    const numericValues = [entry.q1, entry.q2, entry.q3, entry.q4, entry.q5]
      .filter((v): v is number => typeof v === 'number' && v !== null);

    if (numericValues.length > 0) {
      const entryAvg = numericValues.reduce((a, b) => a + b, 0) / numericValues.length;
      totalScoreSum += entryAvg;
      scoreCount++;
    }
  });

  const globalAverageScore = scoreCount > 0 ? Math.round(totalScoreSum / scoreCount) : 0;

  return { totalFeedbacks, uniqueSubjects, globalAverageScore };
};

export const getEnvironmentStats = async (): Promise<EnvironmentStats> => {
  const history = (await getHistory()).filter(e => e.subject === 'ENVIRONNEMENT_GLOBAL');

  const transportCounts: Record<string, number> = {};
  let laptopYes = 0;
  let laptopNo = 0;

  history.forEach(e => {
    if (e.q9_transport) {
      transportCounts[e.q9_transport] = (transportCounts[e.q9_transport] || 0) + 1;
    }
    if (e.q10_laptop === 'Oui') laptopYes++;
    if (e.q10_laptop === 'Non') laptopNo++;
  });

  const totalLaptop = laptopYes + laptopNo;
  return {
    transport: transportCounts,
    laptop: {
      yes: laptopYes,
      no: laptopNo,
      rate: totalLaptop > 0 ? Math.round((laptopYes / totalLaptop) * 100) : 0
    }
  };
};

export const getSubjectsBreakdown = async (): Promise<{ subject: string; count: number }[]> => {
  const history = await getHistory();
  const counts: Record<string, number> = {};

  history.forEach(e => {
    counts[e.subject] = (counts[e.subject] || 0) + 1;
  });

  return Object.entries(counts)
    .map(([subject, count]) => ({ subject, count }))
    .sort((a, b) => b.count - a.count);
};

export const downloadHistoryCSV = async (): Promise<void> => {
  const history = await getHistory(); // All history
  if (history.length === 0) return;

  const headers = [
    "ID", "Timestamp", "Subject", "Q1", "Q2", "Q3", "Q4", "Q5", "Q6_Jobs", "Q7_Rooms", "Q8_Resources", "Q9_Transport", "Q10_Laptop", "Comments"
  ];

  const rows = history.map(e => [
    e.id, e.timestamp, e.subject, e.q1, e.q2, e.q3, e.q4, e.q5,
    e.q6_jobs, e.q7_rooms, e.q8_resources, e.q9_transport, e.q10_laptop,
    `"${(e.comments || "").replace(/"/g, '""')}"`
  ]);

  const csvContent = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8-sig;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `isgi_feedback_${new Date().getTime()}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};