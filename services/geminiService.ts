import { GoogleGenAI, Type } from "@google/genai";
import { FeedbackData, AnalysisResult } from "../types";

export const analyzeFeedback = async (data: FeedbackData): Promise<AnalysisResult> => {
  // Initialisation conforme aux dernières recommandations de sécurité
  const ai = new GoogleGenAI({
    apiKey: import.meta.env.VITE_API_KEY || import.meta.env.GEMINI_API_KEY || ""
  });

  const isEnv = data.subject === 'ENVIRONNEMENT_GLOBAL';

  const systemInstruction = `Vous êtes un Expert en Audit de Qualité Académique pour une formation d'Ingénierie (Génie Industriel). 
  Analysez les données de diagnostic fournies et produisez une synthèse stratégique avec 3 recommandations d'amélioration.
  Répondez EXCLUSIVEMENT en JSON.
  ${isEnv ? "Focus : Environnement et infrastructures de l'institut." : "Focus : Pédagogie et qualité de l'enseignement du cours."}`;

  const pedagogyPrompt = !isEnv ? `
    Analyse du cours : ${data.subject}
    ---
    Critères (Score sur 100) :
    1. Clarté des objectifs : ${data.q1}%
    2. Promotion des échanges : ${data.q2}%
    3. Disponibilité enseignant : ${data.q3}%
    4. Qualité des supports : ${data.q4}%
    5. Pertinence évaluations : ${data.q5}%
  ` : `
    Analyse de l'Environnement Global
    ---
    1. Débouchés métiers : ${data.q6_jobs}
    2. État des salles : ${data.q7_rooms}%
    3. Ressources (Wi-Fi/Labo) : ${data.q8_resources}%
    4. Transport : ${data.q9_transport}
    5. Ordinateur portable : ${data.q10_laptop}
  `;

  const userPrompt = `
    ${pedagogyPrompt}
    Commentaires : "${data.comments || "Aucun commentaire."}"
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: userPrompt,
      config: {
        systemInstruction: systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING },
            recommendations: { type: Type.ARRAY, items: { type: Type.STRING } },
            sentiment: { type: Type.STRING }
          },
          required: ["summary", "recommendations", "sentiment"]
        }
      }
    });

    const text = response.text || "{}";
    return JSON.parse(text.trim()) as AnalysisResult;
  } catch (error) {
    console.error("Gemini Analysis Error:", error);
    return {
      summary: "Diagnostic enregistré localement. Analyse IA temporairement indisponible.",
      recommendations: ["Maintenir la rigueur actuelle.", "Suivre l'évolution des retours.", "Planifier un point avec les délégués."],
      sentiment: 'neutre'
    };
  }
};