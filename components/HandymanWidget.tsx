
import React, { useState, useRef } from 'react';
// Fix: Use EstimateTask instead of non-existent HandymanTask, and import BusinessConfig
import { WidgetState, EstimateTask, EstimationResult, BusinessConfig } from '../types';
import { getEstimate } from '../services/geminiService';

const HandymanWidget: React.FC = () => {
  const [state, setState] = useState<WidgetState>(WidgetState.CLOSED);
  // Fix: Use the correct EstimateTask type
  const [task, setTask] = useState<EstimateTask>({
    description: '',
    urgency: 'within-3-days',
    zipCode: '',
  });
  const [result, setResult] = useState<EstimationResult | null>(null);
  const [loadingMessage, setLoadingMessage] = useState('Checking my toolbox...');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fix: Provide a default BusinessConfig to satisfy the getEstimate function signature, including missing pricingRules, useSheetData, and manualPriceList
  // Added missing leadGenConfig property
  // Fix: Added missing 'fields' property to leadGenConfig to satisfy LeadGenConfig interface
  // Added missing 'customField' and 'serviceType' to fields object to satisfy LeadGenConfig interface requirements
  // Added missing 'headerTitle', 'headerSubtitle', and 'profilePic' to satisfy BusinessConfig interface requirements
  // Fix: Added missing 'hoverTitle', 'hoverTitleBgColor', and 'widgetIcon' to satisfy BusinessConfig interface requirements
  // Fix: Added missing 'curatedRecommendations' to satisfy BusinessConfig interface requirements
  // Fix: Added missing 'pricingKnowledgeBase' to satisfy BusinessConfig interface requirements
  // Fix: Added missing 'defaultLanguage' and 'supportedLanguages' to satisfy BusinessConfig interface
  // Fix: Added missing 'customAgentInstruction' to satisfy BusinessConfig interface requirement
  const handymanConfig: BusinessConfig = {
    name: 'SwiftFix Handyman',
    industry: 'Handyman Services',
    primaryColor: '#ea580c',
    headerTitle: 'SwiftFix Handyman AI',
    headerSubtitle: 'Instant Project Estimation',
    profilePic: 'https://images.unsplash.com/photo-1560250097-0b93528c311a?q=80&w=128&h=128&auto=format&fit=crop',
    hoverTitle: 'Get Instant Quote',
    hoverTitleBgColor: '#0f172a',
    widgetIcon: 'calculator',
    services: ['Plumbing', 'Electrical', 'Furniture Assembly', 'Painting'],
    locationContext: 'General Los Angeles Area',
    pricingRules: 'Minimum service fee is $95. Labor is $85/hour. Materials are marked up 15%. Weekend/Urgent requests have a 25% surcharge.',
    pricingKnowledgeBase: '',
    customAgentInstruction: 'You are a friendly, expert local handyman who prioritizes safety and clean work sites.',
    useSheetData: false,
    manualPriceList: [],
    curatedRecommendations: [],
    // Fix: Added missing 'suggestedQuestions' property to satisfy BusinessConfig interface
    suggestedQuestions: ['Fix leak?', 'Mount TV?', 'Patch wall?'],
    leadGenConfig: {
      enabled: false,
      destination: 'email',
      targetEmail: '',
      // Fix: Added missing required properties to match LeadGenConfig interface
      resendApiKey: '',
      webhookUrl: '',
      slackWebhookUrl: '',
      twilioConfig: { accountSid: '', authToken: '', fromNumber: '', toNumber: '' },
      fields: {
        name: { visible: true, required: true },
        email: { visible: true, required: true },
        phone: { visible: true, required: true },
        city: { visible: false, required: false },
        company: { visible: false, required: false },
        notes: { visible: false, required: false },
        customField: { visible: false, required: false },
        serviceType: { visible: false, required: false },
        // Fix: Added missing 'date' and 'time' fields to satisfy LeadGenConfig interface
        date: { visible: false, required: false },
        time: { visible: false, required: false },
      }
    },
    defaultLanguage: 'en',
    supportedLanguages: ['en', 'es'],
  };

  const toggleWidget = () => {
    if (state === WidgetState.CLOSED) {
      setState(WidgetState.IDLE);
    } else {
      setState(WidgetState.CLOSED);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setTask(prev => ({ ...prev, image: reader.result as string }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleEstimate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!task.description || !task.zipCode) return;

    setState(WidgetState.LOADING);
    const messages = [
      'Checking material costs...',
      'Calculating labor hours...',
      'Checking local rates...',
      'Getting the wrench ready...',
      'Almost there...'
    ];
    let i = 0;
    const interval = setInterval(() => {
      setLoadingMessage(messages[i % messages.length]);
      i++;
    }, 2000);

    try {
      // Fix: Call getEstimate with both task and config arguments
      const est = await getEstimate(task, handymanConfig);
      setResult(est);
      setState(WidgetState.RESULT);
    } catch (error) {
      console.error(error);
      alert('Estimation failed. Please try again.');
      setState(WidgetState.IDLE);
    } finally {
      clearInterval(interval);
    }
  };

  const resetWidget = () => {
    setTask({ description: '', urgency: 'within-3-days', zipCode: '' });
    setResult(null);
    setState(WidgetState.IDLE);
  };

  return (
    <div className="fixed bottom-6 right-6 z-[9999] flex flex-col items-end">
      {/* Pop-up Window */}
      {state !== WidgetState.CLOSED && (
        <div className="w-[380px] sm:w-[420px] max-h-[80vh] bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col mb-4 animate-in fade-in slide-in-from-bottom-4 duration-300">
          {/* Header */}
          <div className="bg-orange-600 p-6 text-white flex justify-between items-center">
            <div>
              <h3 className="font-bold text-lg leading-tight">AI Estimator</h3>
              <p className="text-orange-100 text-xs">Instantly estimate your project</p>
            </div>
            <button 
              onClick={toggleWidget}
              className="p-2 hover:bg-white/10 rounded-full transition"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50">
            {state === WidgetState.IDLE && (
              <form onSubmit={handleEstimate} className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">
                    What needs fixing?
                  </label>
                  <textarea
                    required
                    value={task.description}
                    onChange={(e) => setTask({ ...task, description: e.target.value })}
                    placeholder="E.g. Leaking kitchen faucet, wall mount TV, assemble IKEA bed..."
                    className="w-full p-4 rounded-xl border border-slate-200 focus:ring-2 focus:ring-orange-500 focus:border-transparent min-h-[100px] text-sm resize-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-1">
                      Zip Code
                    </label>
                    <input
                      required
                      type="text"
                      value={task.zipCode}
                      onChange={(e) => setTask({ ...task, zipCode: e.target.value })}
                      placeholder="90210"
                      className="w-full p-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-orange-500 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-1">
                      Urgency
                    </label>
                    <select
                      value={task.urgency}
                      onChange={(e) => setTask({ ...task, urgency: e.target.value as any })}
                      className="w-full p-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-orange-500 text-sm appearance-none bg-white"
                    >
                      <option value="same-day">Same Day</option>
                      <option value="next-day">Next Day</option>
                      <option value="within-3-days">Within 3 Days</option>
                      <option value="flexible">Flexible</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">
                    Add Photos (Optional)
                  </label>
                  <div 
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed border-slate-300 rounded-xl p-4 text-center cursor-pointer hover:border-orange-500 transition-colors group bg-white"
                  >
                    {task.image ? (
                      <div className="relative inline-block">
                        <img src={task.image} className="h-20 w-20 object-cover rounded-lg mx-auto" alt="Task" />
                        <button 
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setTask({...task, image: undefined}); }}
                          className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center">
                        <svg className="w-8 h-8 text-slate-400 group-hover:text-orange-500 transition-colors mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        <span className="text-xs text-slate-500">Tap to upload or take a photo</span>
                      </div>
                    )}
                    <input 
                      type="file" 
                      ref={fileInputRef} 
                      onChange={handleFileChange} 
                      className="hidden" 
                      accept="image/*"
                    />
                  </div>
                </div>

                <button 
                  type="submit"
                  className="w-full bg-orange-600 hover:bg-orange-700 text-white font-bold py-4 rounded-xl transition-all shadow-lg shadow-orange-200 flex items-center justify-center space-x-2"
                >
                  <span>Get AI Estimate</span>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </button>
              </form>
            )}

            {state === WidgetState.LOADING && (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="relative">
                  <div className="w-16 h-16 border-4 border-orange-100 border-t-orange-600 rounded-full animate-spin"></div>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <svg className="w-6 h-6 text-orange-600 animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z" />
                    </svg>
                  </div>
                </div>
                <p className="mt-6 text-slate-600 font-medium animate-pulse">{loadingMessage}</p>
              </div>
            )}

            {state === WidgetState.RESULT && result && (
              <div className="space-y-6">
                <div className="bg-orange-50 border border-orange-100 p-6 rounded-2xl text-center">
                  <p className="text-orange-800 text-xs font-bold uppercase tracking-wider mb-1">Estimated Cost</p>
                  <p className="text-4xl font-black text-orange-600">{result.estimatedCostRange}</p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-white p-3 rounded-xl border border-slate-200">
                    <p className="text-[10px] text-slate-500 font-bold uppercase">Labor</p>
                    <p className="text-sm font-semibold text-slate-800">{result.laborEstimate}</p>
                  </div>
                  <div className="bg-white p-3 rounded-xl border border-slate-200">
                    <p className="text-[10px] text-slate-500 font-bold uppercase">Materials</p>
                    <p className="text-sm font-semibold text-slate-800">{result.materialsEstimate}</p>
                  </div>
                </div>

                <div className="bg-blue-50 border border-blue-100 p-4 rounded-xl flex items-start space-x-3">
                  <div className="bg-blue-100 p-2 rounded-lg mt-0.5">
                    <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-xs text-blue-800 font-bold mb-0.5">Time Estimate</p>
                    <p className="text-sm text-blue-900">{result.timeEstimate}</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <h4 className="text-sm font-bold text-slate-800">Planned Steps:</h4>
                  <ul className="space-y-1.5">
                    {result.tasks.map((t, i) => (
                      <li key={i} className="flex items-start space-x-2 text-xs text-slate-600">
                        <span className="flex-shrink-0 w-4 h-4 bg-orange-100 text-orange-600 rounded-full flex items-center justify-center text-[10px] font-bold mt-0.5">{i+1}</span>
                        <span>{t}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="space-y-2">
                  <h4 className="text-sm font-bold text-slate-800">Pro Tips:</h4>
                  <ul className="space-y-1.5">
                    {result.recommendations.map((r, i) => (
                      <li key={i} className="flex items-start space-x-2 text-xs text-slate-600">
                        <svg className="w-3.5 h-3.5 text-green-500 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                        <span>{r}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="p-4 bg-slate-100 rounded-xl">
                  <p className="text-[10px] text-slate-500 leading-tight italic">
                    Note: {result.caveats[0]}
                  </p>
                </div>

                <div className="flex space-x-2 pt-2">
                  <button 
                    onClick={resetWidget}
                    className="flex-1 border border-slate-200 hover:bg-slate-100 text-slate-600 font-bold py-3 rounded-xl text-sm transition"
                  >
                    Edit Info
                  </button>
                  <button 
                    onClick={() => alert("Redirecting to booking...")}
                    className="flex-[2] bg-orange-600 hover:bg-orange-700 text-white font-bold py-3 rounded-xl text-sm transition shadow-lg shadow-orange-200"
                  >
                    Book for This Price
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Floating Toggle Button */}
      <button
        onClick={toggleWidget}
        className={`w-16 h-16 rounded-full flex items-center justify-center text-white shadow-2xl transition-all duration-300 transform active:scale-95 relative ${
          state === WidgetState.CLOSED 
            ? 'bg-orange-600 hover:bg-orange-700 hover:rotate-12 floating-handyman' 
            : 'bg-white text-orange-600 border border-slate-200'
        }`}
      >
        {state === WidgetState.CLOSED ? (
          <>
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z" />
            </svg>
            <span className="absolute -top-1 -right-1 bg-green-500 border-2 border-white w-4 h-4 rounded-full"></span>
          </>
        ) : (
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>
    </div>
  );
};

export default HandymanWidget;
