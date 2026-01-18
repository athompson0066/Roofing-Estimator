
import React, { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { WidgetState, EstimateTask, EstimationResult, BusinessConfig, LeadGenConfig, RecommendedService, ManualPriceItem } from '../types';
import { getEstimate, dispatchResendQuote } from '../services/geminiService.ts';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { supabase, isSupabaseConfigured } from '../services/supabaseClient.ts';

interface Props {
  config: BusinessConfig;
}

const UI_TRANSLATIONS: Record<string, Record<string, string>> = {
  en: {
    back: 'Back',
    next: 'Next',
    getEstimate: 'Get Estimate',
    confirmQuote: 'Confirm Quote',
    newRequest: 'New Request',
    zipCode: 'Zip Code',
    urgency: 'Urgency',
    placeholder: 'Tell us about your project...',
    voiceStart: 'Talk to Agent',
    voiceListening: 'Listening...',
    voiceSpeaking: 'Speaking...',
    labor: 'Labor',
    parts: 'Parts',
    time: 'Time',
    submitGetQuote: 'Request Quote',
    within3Days: 'Within 3 Days',
    sameDay: 'Same Day',
    flexible: 'Flexible',
    recommendedUpgrades: 'Smart Add-ons',
    baseEstimate: 'Base Price',
    totalWithUpgrades: 'Updated Total',
    finalDetails: 'Contact Details'
  },
  es: {
    back: 'Volver',
    next: 'Siguiente',
    getEstimate: 'Obtener Presupuesto',
    confirmQuote: 'Confirmar',
    newRequest: 'Nueva Solicitud',
    zipCode: 'Código Postal',
    urgency: 'Urgencia',
    placeholder: 'Cuéntanos sobre tu proyecto...',
    voiceStart: 'Hablar con Agente',
    voiceListening: 'Escuchando...',
    voiceSpeaking: 'Hablando...',
    labor: 'Mano de obra',
    parts: 'Materiales',
    time: 'Tiempo',
    submitGetQuote: 'Solicitar Presupuesto',
    within3Days: 'En 3 días',
    sameDay: 'Mismo día',
    flexible: 'Flexible',
    recommendedUpgrades: 'Complementos Inteligentes',
    baseEstimate: 'Precio Base',
    totalWithUpgrades: 'Total Actualizado',
    finalDetails: 'Detalles de contacto'
  }
};

const formatCurrency = (amount: number, locale: string = 'en-US') => {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount);
};

function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
  return bytes;
}

function encode(bytes: Uint8Array) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

async function decodeAudioData(data: Uint8Array, ctx: AudioContext, sampleRate: number, numChannels: number): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
  }
  return buffer;
}

const AIWidget: React.FC<Props> = ({ config: initialConfig }) => {
  const [config, setConfig] = useState<BusinessConfig>(initialConfig);
  const [state, setState] = useState<WidgetState>(WidgetState.CLOSED);
  const [mode, setMode] = useState<'text' | 'voice'>('text');
  const [language, setLanguage] = useState(config.defaultLanguage || 'en');
  const [leadFormStep, setLeadFormStep] = useState(0);
  const [task, setTask] = useState<EstimateTask>({ description: '', urgency: 'within-3-days', zipCode: '' });
  const [result, setResult] = useState<EstimationResult | null>(null);
  const [selectedUpsellIds, setSelectedUpsellIds] = useState<string[]>([]);
  const [loadingMessage, setLoadingMessage] = useState('Agent thinking...');
  const [leadInfo, setLeadInfo] = useState<Record<string, string>>({
    name: '', email: '', phone: '', city: '', company: '', notes: '', serviceType: '', date: '', time: '',
  });

  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [isAiSpeaking, setIsAiSpeaking] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const streamRef = useRef<MediaStream | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const sessionRef = useRef<any>(null);

  const t = UI_TRANSLATIONS[language] || UI_TRANSLATIONS['en'];

  useEffect(() => {
    setConfig(initialConfig);
  }, [initialConfig]);

  const toggleWidget = () => {
    const newState = state === WidgetState.CLOSED ? WidgetState.IDLE : WidgetState.CLOSED;
    setState(newState);
    if (newState === WidgetState.CLOSED) stopVoiceSession();
    setLeadFormStep(0);
  };

  const stopVoiceSession = () => {
    setIsVoiceActive(false);
    setIsAiSpeaking(false);
    if (streamRef.current) streamRef.current.getTracks().forEach(track => track.stop());
    if (scriptProcessorRef.current) scriptProcessorRef.current.disconnect();
    if (sessionRef.current) sessionRef.current = null;
    sourcesRef.current.forEach(source => source.stop());
    sourcesRef.current.clear();
  };

  const startVoiceSession = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setIsVoiceActive(true);
      const ai = new GoogleGenAI({ apiKey: (window as any).process?.env?.API_KEY || '' });
      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      audioContextRef.current = outputCtx;
      streamRef.current = stream;

      const systemInstruction = `You are a friendly AI Agent for ${config.name}. Goal: Converse and estimate projects. Rules: ${config.pricingRules}. Language: ${language}.`;
      
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            const source = inputCtx.createMediaStreamSource(stream);
            const scriptProcessor = inputCtx.createScriptProcessor(4096, 1, 1);
            scriptProcessorRef.current = scriptProcessor;
            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const int16 = new Int16Array(inputData.length);
              for (let i = 0; i < inputData.length; i++) int16[i] = inputData[i] * 32768;
              const pcmBlob = { data: encode(new Uint8Array(int16.buffer)), mimeType: 'audio/pcm;rate=16000' };
              sessionPromise.then(session => session.sendRealtimeInput({ media: pcmBlob }));
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(inputCtx.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (base64Audio) {
              setIsAiSpeaking(true);
              const ctx = audioContextRef.current!;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
              const audioBuffer = await decodeAudioData(decode(base64Audio), ctx, 24000, 1);
              const source = ctx.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(ctx.destination);
              source.addEventListener('ended', () => {
                sourcesRef.current.delete(source);
                if (sourcesRef.current.size === 0) setIsAiSpeaking(false);
              });
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += audioBuffer.duration;
              sourcesRef.current.add(source);
            }
          },
        },
        config: { responseModalities: [Modality.AUDIO], systemInstruction }
      });
      sessionRef.current = sessionPromise;
    } catch (err) { alert("Microphone access is required for voice mode."); }
  };

  const handleEstimate = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!task.description || !task.zipCode) return;
    setState(WidgetState.LOADING);
    const messages = ['Calculating scope...', 'Finding best price...', 'Finalizing quote...'];
    let i = 0;
    const interval = setInterval(() => { i++; setLoadingMessage(messages[i % messages.length]); }, 1800);
    try {
      const est = await getEstimate({ ...task, language }, config);
      setResult(est);
      setSelectedUpsellIds(est.suggestedUpsellIds || []);
      setState(WidgetState.RESULT);
    } catch (error) {
      console.error(error);
      alert('Estimation failed. Please check your connection.');
      setState(WidgetState.IDLE);
    } finally { clearInterval(interval); }
  };

  const relevantUpsells = useMemo(() => {
    if (!result) return [];
    const allApproved = (config.curatedRecommendations || []).filter(r => r.isApproved);
    if (result.suggestedUpsellIds && result.suggestedUpsellIds.length > 0) {
      return allApproved.filter(u => result.suggestedUpsellIds.includes(u.id));
    }
    return allApproved;
  }, [result, config.curatedRecommendations]);

  const totalCostDisplay = useMemo(() => {
    if (!result) return { total: '' };
    let extra = 0;
    (config.curatedRecommendations || []).forEach(u => {
      if (selectedUpsellIds.includes(u.id)) {
        const match = u.suggestedPrice.match(/(\d+(\.\d+)?)/);
        extra += match ? parseFloat(match[0]) : 0;
      }
    });
    const min = (result.baseMinCost || 0) + extra;
    const max = (result.baseMaxCost || 0) + extra;
    return { total: max > min ? `${formatCurrency(min)} - ${formatCurrency(max)}` : formatCurrency(min) };
  }, [result, selectedUpsellIds, config.curatedRecommendations]);

  const handleLeadSubmit = async () => {
    setState(WidgetState.LOADING);
    setLoadingMessage('Securing your spot...');
    
    try {
      // 1. Save to Supabase if configured
      if (isSupabaseConfigured()) {
        const payload = {
          ...leadInfo,
          estimate_range: totalCostDisplay.total,
          task_description: task.description,
          created_at: new Date().toISOString(),
          metadata: {
            zipCode: task.zipCode,
            urgency: task.urgency,
            upsells: selectedUpsellIds
          }
        };
        const { error } = await supabase.from('leads').insert([payload]);
        if (error) console.error("Lead saving error:", error);
      }

      // 2. Dispatch via Resend/Email if API Key provided
      await dispatchResendQuote(leadInfo, result!, config);
      
      setState(WidgetState.SUCCESS);
    } catch (err) { 
      console.error("Submission error:", err);
      setState(WidgetState.SUCCESS); 
    }
  };

  const leadSteps = useMemo(() => {
    const fields = (Object.keys(config.leadGenConfig.fields) as Array<keyof LeadGenConfig['fields']>)
      .filter(k => config.leadGenConfig.fields[k].visible);
    const groups = [];
    for (let i = 0; i < fields.length; i += 2) groups.push(fields.slice(i, i + 2));
    return groups.length > 0 ? groups : [[]];
  }, [config.leadGenConfig.fields]);

  const currentStepFields = leadSteps[leadFormStep] || [];
  const isLastStep = leadFormStep === leadSteps.length - 1;

  const handleNextStep = (e: React.FormEvent) => {
    e.preventDefault();
    if (isLastStep) handleLeadSubmit();
    else { setLeadFormStep(prev => prev + 1); }
  };

  const primaryColor = config.primaryColor || '#ea580c';

  return (
    <div className="fixed bottom-6 right-6 z-[2147483647] flex flex-col items-end font-sans text-slate-900">
      <AnimatePresence>
        {state !== WidgetState.CLOSED && (
          <motion.div initial={{ opacity: 0, y: 40, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 40, scale: 0.95 }} className="w-[380px] sm:w-[420px] max-h-[85vh] bg-white rounded-[2.5rem] shadow-2xl border border-slate-200 overflow-hidden flex flex-col mb-4">
            <div style={{ backgroundColor: primaryColor }} className="p-6 text-white shadow-md z-10">
              <div className="flex justify-between items-center mb-4">
                <div className="flex items-center space-x-3">
                  <img src={config.profilePic} className="w-12 h-12 rounded-full border-2 border-white object-cover shadow-sm" />
                  <div>
                    <h3 className="font-black text-lg truncate max-w-[150px]">{config.headerTitle}</h3>
                    <p className="text-white/70 text-[10px] uppercase font-bold tracking-widest">{config.headerSubtitle}</p>
                  </div>
                </div>
                <button onClick={toggleWidget} className="p-2 hover:bg-white/10 rounded-full transition-colors"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" /></svg></button>
              </div>
              <div className="flex bg-black/10 p-1 rounded-xl">
                <button onClick={() => setMode('text')} className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${mode === 'text' ? 'bg-white text-slate-900 shadow-sm' : 'text-white/70 hover:text-white'}`}>Text Agent</button>
                <button onClick={() => setMode('voice')} className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${mode === 'voice' ? 'bg-white text-slate-900 shadow-sm' : 'text-white/70 hover:text-white'}`}>Voice Agent</button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 bg-slate-50 flex flex-col relative custom-scrollbar">
              <AnimatePresence mode="wait">
                {mode === 'voice' ? (
                  <motion.div key="voice" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex-1 flex flex-col items-center justify-center text-center space-y-6 py-8">
                    <div className={`w-32 h-32 rounded-full flex items-center justify-center relative shadow-xl transition-all ${isVoiceActive ? 'scale-110' : ''}`} style={{ backgroundColor: isVoiceActive ? primaryColor : '#cbd5e1' }}>
                      <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
                      {isVoiceActive && <div className="absolute inset-0 rounded-full border-4 border-white/30 animate-ping"></div>}
                    </div>
                    <h4 className="text-xl font-black">{isAiSpeaking ? t.voiceSpeaking : isVoiceActive ? t.voiceListening : t.voiceStart}</h4>
                    {!isVoiceActive && <button onClick={startVoiceSession} style={{ backgroundColor: primaryColor }} className="px-8 py-3 rounded-full text-white font-bold text-sm shadow-lg hover:brightness-110 active:scale-95 transition-all">{t.voiceStart}</button>}
                  </motion.div>
                ) : (
                  <div className="flex-1">
                    {state === WidgetState.IDLE && (
                      <motion.form key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onSubmit={handleEstimate} className="space-y-4">
                        <div className="space-y-1">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">What can we help with?</label>
                          <textarea required value={task.description} onChange={(e) => setTask({ ...task, description: e.target.value })} className="w-full p-4 rounded-2xl border border-slate-200 text-sm h-32 outline-none focus:ring-2 shadow-sm transition-all" style={{ '--tw-ring-color': primaryColor } as any} placeholder={t.placeholder} />
                          {config.suggestedQuestions && (
                            <div className="flex gap-2 overflow-x-auto pb-1 mt-2 no-scrollbar">
                              {config.suggestedQuestions.map(q => (
                                <button key={q} type="button" onClick={() => setTask({...task, description: q})} className="whitespace-nowrap bg-white border border-slate-100 shadow-sm px-3 py-1.5 rounded-full text-[10px] font-bold text-slate-600 hover:border-indigo-600 active:scale-95 transition-all">{q}</button>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-1">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">{t.zipCode}</label>
                            <input required type="text" value={task.zipCode} onChange={(e) => setTask({ ...task, zipCode: e.target.value })} className="w-full p-3 border rounded-xl shadow-sm outline-none focus:ring-2" style={{ '--tw-ring-color': primaryColor } as any} />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">{t.urgency}</label>
                            <select value={task.urgency} onChange={(e) => setTask({ ...task, urgency: e.target.value as any })} className="w-full p-3 border rounded-xl bg-white shadow-sm outline-none focus:ring-2" style={{ '--tw-ring-color': primaryColor } as any}>
                              <option value="within-3-days">{t.within3Days}</option>
                              <option value="same-day">{t.sameDay}</option>
                              <option value="flexible">{t.flexible}</option>
                            </select>
                          </div>
                        </div>
                        <button type="submit" style={{ backgroundColor: primaryColor }} className="w-full text-white font-black py-4 rounded-2xl shadow-lg hover:brightness-110 active:scale-95 transition-all">{t.getEstimate}</button>
                      </motion.form>
                    )}

                    {state === WidgetState.LOADING && (
                      <div className="flex-1 flex flex-col items-center justify-center py-10 space-y-6">
                        <div className="w-16 h-16 border-4 border-slate-100 border-t-indigo-600 rounded-full animate-spin" style={{ borderTopColor: primaryColor }}></div>
                        <p className="font-black text-lg text-slate-800 animate-pulse">{loadingMessage}</p>
                      </div>
                    )}

                    {state === WidgetState.RESULT && result && (
                      <motion.div key="result" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="space-y-5 pb-4">
                        <div style={{ backgroundColor: primaryColor + '10' }} className="p-6 rounded-3xl text-center border border-indigo-100 relative overflow-hidden">
                           <p className="text-[10px] font-black uppercase tracking-[0.2em] mb-1" style={{ color: primaryColor }}>{selectedUpsellIds.length > 0 ? t.totalWithUpgrades : t.baseEstimate}</p>
                           <motion.p key={totalCostDisplay.total} initial={{ y: 5, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="text-4xl font-black" style={{ color: primaryColor }}>{totalCostDisplay.total}</motion.p>
                        </div>

                        {relevantUpsells.length > 0 && (
                          <div className="space-y-3 bg-white p-4 rounded-3xl border shadow-sm">
                            <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1 flex items-center">
                              <svg className="w-3 h-3 mr-1 text-yellow-500" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" /></svg>
                              {t.recommendedUpgrades}
                            </h4>
                            <div className="space-y-2">
                              {relevantUpsells.map((u) => (
                                <div key={u.id} onClick={() => setSelectedUpsellIds(prev => prev.includes(u.id) ? prev.filter(i => i !== u.id) : [...prev, u.id])} className={`p-4 rounded-2xl border-2 transition-all cursor-pointer flex justify-between items-center ${selectedUpsellIds.includes(u.id) ? 'bg-indigo-50 border-indigo-500 shadow-sm' : 'bg-white border-slate-100 hover:border-indigo-200'}`}>
                                  <div className="flex-1 pr-4">
                                    <h5 className="text-xs font-black text-slate-800">{u.label}</h5>
                                    <p className="text-[10px] text-slate-500 leading-tight">{u.description}</p>
                                  </div>
                                  <div className="flex flex-col items-end">
                                    <span className="text-xs font-black text-indigo-600">+{u.suggestedPrice}</span>
                                    {selectedUpsellIds.includes(u.id) && <div className="mt-1 bg-indigo-600 rounded-full p-0.5 text-white shadow-sm"><svg className="w-2 h-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" d="M5 13l4 4L19 7" /></svg></div>}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        <div className="grid grid-cols-3 gap-2">
                          {['labor', 'parts', 'time'].map(key => (
                            <div key={key} className="bg-white p-3 rounded-2xl border border-slate-100 shadow-sm flex flex-col items-center">
                              <p className="text-[9px] text-slate-400 font-black uppercase tracking-tighter">{t[key]}</p>
                              <p className="text-[11px] font-black truncate w-full text-center">{(result as any)[`${key}Estimate`]}</p>
                            </div>
                          ))}
                        </div>
                        <div className="flex gap-2 pt-2">
                           <button onClick={() => setState(WidgetState.IDLE)} className="flex-1 py-4 border-2 border-slate-100 rounded-2xl text-xs font-black text-slate-400 hover:bg-slate-50 active:scale-95 transition-all">{t.back}</button>
                           <button onClick={() => setState(WidgetState.LEAD_FORM)} style={{ backgroundColor: primaryColor }} className="flex-[2] text-white font-black py-4 rounded-2xl shadow-lg hover:brightness-110 active:scale-95 transition-all">{t.confirmQuote}</button>
                        </div>
                      </motion.div>
                    )}

                    {state === WidgetState.LEAD_FORM && (
                      <motion.div key="lead-form" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex-1 flex flex-col h-full">
                        <div className="mb-6 flex justify-between items-center px-1">
                          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{t.finalDetails}</span>
                          <span className="text-[10px] font-black text-slate-900 uppercase tracking-widest">{leadFormStep + 1} / {leadSteps.length}</span>
                        </div>
                        <form onSubmit={handleNextStep} className="flex-1 flex flex-col gap-4">
                          <AnimatePresence mode="wait">
                            <motion.div key={leadFormStep} initial={{ x: 20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -20, opacity: 0 }} className="space-y-4">
                              {currentStepFields.map(f => (
                                <div key={f} className="space-y-1">
                                   <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">{f === 'serviceType' ? 'Service Required' : f.charAt(0).toUpperCase() + f.slice(1)}</label>
                                   {f === 'serviceType' ? (
                                     <select 
                                       required={config.leadGenConfig.fields[f].required} 
                                       value={leadInfo[f]} 
                                       onChange={(e) => setLeadInfo({...leadInfo, [f]: e.target.value})} 
                                       className="w-full p-4 border border-slate-200 rounded-2xl text-sm outline-none focus:ring-2 shadow-sm bg-white" 
                                       style={{ '--tw-ring-color': primaryColor } as any}
                                     >
                                       <option value="">Select a service...</option>
                                       {(config.services || []).map(s => (
                                         <option key={s} value={s}>{s}</option>
                                       ))}
                                       <option value="Other">Other / General Inquiry</option>
                                     </select>
                                   ) : (
                                     <input required={config.leadGenConfig.fields[f].required} type={f === 'email' ? 'email' : f === 'phone' ? 'tel' : 'text'} value={leadInfo[f]} onChange={(e) => setLeadInfo({...leadInfo, [f]: e.target.value})} className="w-full p-4 border border-slate-200 rounded-2xl text-sm outline-none focus:ring-2 shadow-sm" style={{ '--tw-ring-color': primaryColor } as any} />
                                   )}
                                </div>
                              ))}
                            </motion.div>
                          </AnimatePresence>
                          <div className="flex gap-3 pt-6 pb-2">
                              <button type="button" onClick={() => leadFormStep === 0 ? setState(WidgetState.RESULT) : setLeadFormStep(prev => prev - 1)} className="flex-1 py-4 border-2 border-slate-100 rounded-2xl text-xs font-black text-slate-400 hover:bg-slate-50 active:scale-95 transition-all">{t.back}</button>
                              <button type="submit" style={{ backgroundColor: primaryColor }} className="flex-[2] text-white font-black py-4 rounded-2xl shadow-xl hover:brightness-110 active:scale-95 transition-all">
                                {isLastStep ? t.submitGetQuote : t.next}
                              </button>
                           </div>
                        </form>
                      </motion.div>
                    )}

                    {state === WidgetState.SUCCESS && (
                      <motion.div key="success" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="flex-1 flex flex-col items-center justify-center text-center space-y-6">
                         <div className="w-24 h-24 rounded-full bg-green-100 flex items-center justify-center text-green-600 shadow-lg border-4 border-white">
                           <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" /></svg>
                         </div>
                         <div>
                            <h4 className="text-3xl font-black mb-2">Success!</h4>
                            <p className="text-sm text-slate-500 max-w-[240px] mx-auto font-medium">Your request for <strong>{totalCostDisplay.total}</strong> has been received. Our team will contact you shortly.</p>
                         </div>
                         <button onClick={() => { setState(WidgetState.IDLE); setResult(null); setLeadFormStep(0); setLeadInfo({name: '', email: '', phone: '', city: '', company: '', notes: '', serviceType: '', date: '', time: ''}); }} style={{ backgroundColor: primaryColor }} className="px-10 py-4 rounded-2xl text-white font-black text-sm shadow-xl hover:brightness-110 active:scale-95 transition-all">Start New Estimate</button>
                      </motion.div>
                    )}
                  </div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <button onClick={toggleWidget} style={{ backgroundColor: state === WidgetState.CLOSED ? primaryColor : '#ffffff' }} className={`w-16 h-16 rounded-full flex items-center justify-center shadow-2xl relative group transform active:scale-95 transition-all duration-300 ${state === WidgetState.CLOSED ? 'text-white' : 'text-slate-600 border border-slate-100'}`}>
        {state === WidgetState.CLOSED ? (
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        ) : <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7" /></svg>}
        {state === WidgetState.CLOSED && <div className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 border-2 border-white rounded-full animate-bounce"></div>}
      </button>
    </div>
  );
};

export default AIWidget;
