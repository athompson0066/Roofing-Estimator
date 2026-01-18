
import { GoogleGenAI, Type } from "@google/genai";
import { EstimateTask, EstimationResult, BusinessConfig, IntelligenceSource } from "../types.ts";

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Robust retry wrapper with exponential backoff.
 * Especially useful for 429 errors common with new or free API keys.
 */
async function retryRequest<T>(fn: () => Promise<T>, retries = 3, initialDelay = 10000): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    const errorString = JSON.stringify(error);
    const isQuotaError = errorString.includes('429') || 
                         errorString.includes('RESOURCE_EXHAUSTED') || 
                         error?.message?.includes('429') ||
                         error?.status === 429;

    if (isQuotaError && retries > 0) {
      console.warn(`Quota exceeded. Retrying in ${initialDelay}ms... (${retries} retries left)`);
      await delay(initialDelay);
      return retryRequest(fn, retries - 1, initialDelay * 2);
    }
    throw error;
  }
}

const cleanJson = (text: string) => {
  try {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end !== -1) {
      return text.substring(start, end + 1);
    }
    const arrayStart = text.indexOf('[');
    const arrayEnd = text.lastIndexOf(']');
    if (arrayStart !== -1 && arrayEnd !== -1) {
      return text.substring(arrayStart, arrayEnd + 1);
    }
    return text.trim();
  } catch (e) {
    return text;
  }
};

/**
 * PERFORM MASTER SCAN
 * Consolidated into a SINGLE call to the Digital Investigator.
 * This minimizes RPM (Requests Per Minute) usage to prevent 429 errors.
 */
export const performMasterScan = async (url: string, customInstruction?: string): Promise<Partial<BusinessConfig>> => {
  return retryRequest(async () => {
    // Initialize AI within the function to ensure the most recent key is used
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    // We use gemini-3-flash-preview because it has much higher rate limits than 'pro'
    // and can handle tools like googleSearch efficiently in one go.
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `You are the "Digital Investigator". 
      Research this business URL: ${url}. 
      
      STEP 1: Identify business name, industry, and main services.
      STEP 2: Based on the research, suggest:
      - A professional header title and subtitle for a cost estimator.
      - A primary brand color (HEX).
      - A logical "Pricing Rules" string (e.g. "Base cost is X, Labor is Y/hr").
      - A manual price list of 6-8 standard services with BALLPARK pricing.
      - 3 strategic "Upsell" packages (e.g. "Premium Material Upgrade", "Priority Service").
      
      USER INSTRUCTIONS: ${customInstruction || 'None'}
      
      Respond STRICTLY in the provided JSON schema.`,
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING },
            industry: { type: Type.STRING },
            cityLocation: { type: Type.STRING },
            services: { type: Type.ARRAY, items: { type: Type.STRING } },
            headerTitle: { type: Type.STRING },
            headerSubtitle: { type: Type.STRING },
            primaryColor: { type: Type.STRING },
            pricingRules: { type: Type.STRING },
            pricingKnowledgeBase: { type: Type.STRING },
            manualPriceList: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  label: { type: Type.STRING },
                  price: { type: Type.STRING }
                }
              }
            },
            curatedRecommendations: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  label: { type: Type.STRING },
                  description: { type: Type.STRING },
                  suggestedPrice: { type: Type.STRING },
                  isApproved: { type: Type.BOOLEAN }
                }
              }
            },
            suggestedQuestions: { type: Type.ARRAY, items: { type: Type.STRING } }
          },
          required: ['name', 'industry', 'services', 'pricingRules', 'manualPriceList']
        }
      }
    });

    const data = JSON.parse(cleanJson(response.text));
    const sources: IntelligenceSource[] = [];
    
    // Extract website URLs for grounding transparency
    response.candidates?.[0]?.groundingMetadata?.groundingChunks?.forEach((chunk: any) => {
      if (chunk.web) {
        sources.push({ title: chunk.web.title || 'Grounding Source', url: chunk.web.uri });
      }
    });

    return {
      ...data,
      intelligenceSources: sources
    };
  });
};

/**
 * ESTIMATION ENGINE
 * Switched to gemini-3-flash-preview for maximum compatibility with rate-limited keys.
 */
export const getEstimate = async (task: EstimateTask, config: BusinessConfig): Promise<EstimationResult> => {
  return retryRequest(async () => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    const availableUpsells = (config.curatedRecommendations || []).filter(u => u.isApproved);
    const upsellContext = availableUpsells.map(u => `ID: ${u.id}, Label: ${u.label}, Description: ${u.description}`).join('\n');

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `
      As an AI estimation agent for ${config.name}, calculate costs for: "${task.description}".
      
      PRICING FRAMEWORK:
      ${config.pricingRules}
      ${config.customAgentInstruction}
      
      USER CONTEXT:
      - Zip Code: ${task.zipCode}
      - Urgency: ${task.urgency}
      
      CALCULATION STEPS:
      1. Determine scope from the description.
      2. Apply pricing rules to find a Min and Max ballpark.
      3. Account for ${task.urgency} in the final price.
      4. Ensure minimum job fee is respected if defined in rules.
      
      UPSELL OPTIONS (Select matching IDs):
      ${upsellContext || 'None available.'}`,
      config: { 
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            estimatedCostRange: { type: Type.STRING },
            baseMinCost: { type: Type.NUMBER },
            baseMaxCost: { type: Type.NUMBER },
            laborEstimate: { type: Type.STRING },
            materialsEstimate: { type: Type.STRING },
            timeEstimate: { type: Type.STRING },
            tasks: { type: Type.ARRAY, items: { type: Type.STRING } },
            recommendations: { type: Type.ARRAY, items: { type: Type.STRING } },
            caveats: { type: Type.ARRAY, items: { type: Type.STRING } },
            suggestedUpsellIds: { type: Type.ARRAY, items: { type: Type.STRING } }
          },
          required: ['estimatedCostRange', 'baseMinCost', 'baseMaxCost', 'laborEstimate', 'tasks']
        }
      }
    });
    
    return JSON.parse(cleanJson(response.text));
  });
};

export const dispatchResendQuote = async (leadInfo: any, estimate: EstimationResult, config: BusinessConfig) => {
  // Mocking dispatch - this would connect to Resend or another provider
  console.log("Lead captured for:", config.name, leadInfo);
  return { success: true };
};
