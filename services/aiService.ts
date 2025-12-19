import { GoogleGenAI } from "@google/genai";

const apiKey = process.env.API_KEY || '';

// Fallback if API key is missing or fails
const FALLBACK_DESCRIPTIONS = [
  "The morning dew is fresh on the grass. Guide them gently.",
  "The afternoon sun is warm. The flock is restless.",
  "Shadows lengthen. Focus and patience are key.",
  "A gentle breeze blows from the west. The work continues.",
  "The herd grows larger. Find your rhythm."
];

export const getLevelFlavorText = async (level: number): Promise<{ title: string; description: string }> => {
  if (!apiKey) {
    return {
      title: `Chapter ${level}`,
      description: FALLBACK_DESCRIPTIONS[(level - 1) % FALLBACK_DESCRIPTIONS.length]
    };
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Generate a very short, artistic, nature-focused title and a one-sentence haiku-like description for Level ${level} of a peaceful sheep herding game. 
      Return JSON format: { "title": "string", "description": "string" }. 
      Keep it zen, calm, and pastoral.`,
      config: {
        responseMimeType: "application/json",
      }
    });

    const text = response.text;
    if (!text) throw new Error("No text response");
    
    return JSON.parse(text);
  } catch (error) {
    console.error("AI Generation failed, using fallback", error);
    return {
      title: `Chapter ${level}`,
      description: FALLBACK_DESCRIPTIONS[(level - 1) % FALLBACK_DESCRIPTIONS.length]
    };
  }
};