
import { GoogleGenAI, Type } from "@google/genai";
import { EstimateTask, EstimationResult, BusinessConfig, IntelligenceSource } from "../types.ts";

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function retryRequest<T>(fn: () => Promise<T>, retries = 3, initialDelay = 8000): Promise<T> {
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
 * AGENT 1: Digital Investigator
 * Performs the initial search and identity extraction.
 */
const investigatorAgent = async (ai: GoogleGenAI, url: string, customInstruction: string) => {
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `You are the 'Digital Investigator' agent. Scan URL: ${url}. 
    Custom Instructions: ${customInstruction}
    Extract: Business Name, Industry, Main Services, Primary Location (City/State), and Decision Maker.`,
    config: {
      tools: [{ googleSearch: {} }],
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          industry: { type: Type.STRING },
          decisionMaker: { type: Type.STRING },
          cityLocation: { type: Type.STRING },
          services: { type: Type.ARRAY, items: { type: Type.STRING } }
        },
        required: ['name', 'industry', 'services']
      }
    }
  });
  
  const sources: IntelligenceSource[] = [];
  response.candidates?.[0]?.groundingMetadata?.groundingChunks?.forEach((chunk: any) => {
    if (chunk.web) {
      sources.push({ title: chunk.web.title || 'Source', url: chunk.web.uri });
    }
  });

  return { data: JSON.parse(cleanJson(response.text)), sources };
};

/**
 * AGENT 2: The Master Planner
 * Combines Market Analysis, Pricing, and Copywriting into ONE call to save quota.
 */
const masterPlannerAgent = async (ai: GoogleGenAI, businessData: any) => {
  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: `You are the 'Master Strategist'. Based on this business data: ${JSON.stringify(businessData)}.
    
    TASK 1 (Market Analyst): Research trends for ${businessData.industry} in ${businessData.cityLocation || 'the local area'}.
    TASK 2 (Pricing Strategist): Create a robust pricing model with rules and 6-8 manual items.
    TASK 3 (Copywriter): Generate branding titles, a primary brand color (HEX), and 3-4 High-Value Upsell Packages.
    
    Ensure all logic is consistent with a professional service business.`,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          marketTrends: { type: Type.ARRAY, items: { type: Type.STRING } },
          suggestedQuestions: { type: Type.ARRAY, items: { type: Type.STRING } },
          pricingRules: { type: Type.STRING },
          headerTitle: { type: Type.STRING },
          headerSubtitle: { type: Type.STRING },
          primaryColor: { type: Type.STRING },
          widgetIcon: { type: Type.STRING, enum: ['calculator', 'wrench', 'home', 'sparkles', 'chat', 'currency'] },
          manualPriceList: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                label: { type: Type.STRING },
                price: { type: Type.STRING }
              },
              required: ['id', 'label', 'price']
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
          }
        },
        required: ['pricingRules', 'manualPriceList', 'headerTitle', 'primaryColor']
      }
    }
  });
  return JSON.parse(cleanJson(response.text));
};

/**
 * MASTER ORCHESTRATOR
 * Now performs only TWO sequential calls to respect low RPM limits on new keys.
 */
export const performMasterScan = async (url: string, customInstruction?: string): Promise<Partial<BusinessConfig>> => {
  return retryRequest(async () => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    // Step 1: Investigator (Uses Google Search)
    const { data: invData, sources } = await investigatorAgent(ai, url, customInstruction || '');
    
    // Safety pause to respect Rate Per Minute (RPM) limits
    await delay(3000);

    // Step 2: Planner (Consolidated tasks into one call)
    const plannedData = await masterPlannerAgent(ai, invData);
    
    return {
      ...invData,
      ...plannedData,
      intelligenceSources: sources
    };
  });
};

/**
 * ESTIMATION ENGINE
 */
export const getEstimate = async (task: EstimateTask, config: BusinessConfig): Promise<EstimationResult> => {
  return retryRequest(async () => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    const availableUpsells = (config.curatedRecommendations || []).filter(u => u.isApproved);
    const upsellContext = availableUpsells.map(u => `ID: ${u.id}, Label: ${u.label}, Description: ${u.description}`).join('\n');

    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: `
      As an AI estimation agent for ${config.name}, calculate costs for the request: "${task.description}".
      
      BUSINESS RULES & LOGIC:
      ${config.pricingRules}
      ${config.customAgentInstruction}
      
      DATA FROM USER:
      - Zip Code: ${task.zipCode}
      - Urgency: ${task.urgency}
      - Language: ${task.language || 'en'}
      
      YOUR MANDATORY CALCULATION PROCESS (SHOW WORK IN NOTES):
      1. Extract "Home Size / Floor SqFt" from description.
      2. Calculate Roof Squares = (SqFt * 1.35) / 100.
      3. Base Range = Squares * $450 to Squares * $550.
      4. Adjust for Pitch: Check if "Steep" is mentioned.
      5. Adjust for Material: Check if "Metal" is mentioned.
      6. Enforce Minimum of $6,000.
      
      Select relevant IDs from this list to recommend:
      ${upsellContext || 'No upsells available.'}`,
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
          required: ['estimatedCostRange', 'baseMinCost', 'baseMaxCost', 'laborEstimate', 'tasks', 'suggestedUpsellIds']
        }
      }
    });
    return JSON.parse(cleanJson(response.text));
  });
};

export const dispatchResendQuote = async (leadInfo: any, estimate: EstimationResult, config: BusinessConfig) => {
  console.log("Lead Dispatched:", leadInfo, "Estimate:", estimate);
  return { success: true };
};
