
import { GoogleGenAI, Type } from "@google/genai";
import { EstimateTask, EstimationResult, BusinessConfig, IntelligenceSource } from "../types";

async function retryRequest<T>(fn: () => Promise<T>, retries = 3, initialDelay = 5000): Promise<T> {
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
      await new Promise(resolve => setTimeout(resolve, initialDelay));
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
 * AGENT 2: Market Analyst
 */
const marketAnalystAgent = async (ai: GoogleGenAI, businessData: any) => {
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `You are the 'Market Analyst' agent. Research the market for ${businessData.industry} in ${businessData.cityLocation || 'the local area'}.
    Identify typical customer pain points and standard service offerings.`,
    config: {
      tools: [{ googleSearch: {} }],
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          marketTrends: { type: Type.ARRAY, items: { type: Type.STRING } },
          suggestedQuestions: { type: Type.ARRAY, items: { type: Type.STRING } }
        }
      }
    }
  });
  return JSON.parse(cleanJson(response.text));
};

/**
 * AGENT 3: Pricing Strategist
 */
const pricingStrategistAgent = async (ai: GoogleGenAI, businessData: any) => {
  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: `You are the 'Pricing Strategist' agent. Create a pricing model for ${businessData.name} (${businessData.industry}).
    Services: ${businessData.services.join(', ')}.
    Include: General pricing rules and a specific manual price list of 5-10 common items.`,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          pricingRules: { type: Type.STRING },
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
          }
        },
        required: ['pricingRules', 'manualPriceList']
      }
    }
  });
  return JSON.parse(cleanJson(response.text));
};

/**
 * AGENT 4: Content Copywriter
 */
const copywriterAgent = async (ai: GoogleGenAI, businessData: any) => {
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `You are the 'Content Copywriter' agent. Create high-converting brand details for ${businessData.name}.
    Generate: Header Title, Subtitle, Widget Icon choice, and 3-4 High-Value Upsell Packages.`,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          headerTitle: { type: Type.STRING },
          headerSubtitle: { type: Type.STRING },
          primaryColor: { type: Type.STRING },
          widgetIcon: { type: Type.STRING, enum: ['calculator', 'wrench', 'home', 'sparkles', 'chat', 'currency'] },
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
        }
      }
    }
  });
  return JSON.parse(cleanJson(response.text));
};

/**
 * MASTER ORCHESTRATOR
 */
export const performMasterScan = async (url: string, customInstruction?: string): Promise<Partial<BusinessConfig>> => {
  return retryRequest(async () => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
    const { data: invData, sources } = await investigatorAgent(ai, url, customInstruction || '');
    const [marketData, priceData, copyData] = await Promise.all([
      marketAnalystAgent(ai, invData),
      pricingStrategistAgent(ai, invData),
      copywriterAgent(ai, invData)
    ]);
    return {
      ...invData,
      ...marketData,
      ...priceData,
      ...copyData,
      intelligenceSources: sources
    };
  });
};

/**
 * ESTIMATION ENGINE
 */
export const getEstimate = async (task: EstimateTask, config: BusinessConfig): Promise<EstimationResult> => {
  return retryRequest(async () => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
    
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
