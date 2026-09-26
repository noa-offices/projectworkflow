"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

// Local Web Speech types: no global augmentation or additional dependency.
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
type VoiceBrowser = {
  SpeechRecognition?: new () => Recognition;
  webkitSpeechRecognition?: new () => Recognition;
  speechSynthesis?: SpeechSynthesis;
  SpeechSynthesisUtterance?: new (text: string) => SpeechSynthesisUtterance;
  navigator?: { language?: string };
};
const INITIAL = { recognitionSupported: false, speechSupported: false, listening: false, ending: false, speakingId: null as string | null, error: "" };

export function appendVoiceTranscript(value: string, transcript: string) {
  const text = transcript.trim();
  return text ? (value.trim() ? `${value.trimEnd()} ${text}` : text) : value;
}

export function hasSpeechText(text: string) {
  return /[\p{L}\p{N}]/u.test(text);
}

// One controller per drawer. Browser callbacks are detached before cancellation so late
// results cannot refill a submitted input or update a closed/unmounted drawer.
export function createNoaVoice() {
  let snapshot = INITIAL;
  let browser: VoiceBrowser | null = null;
  let recognition: Recognition | null = null;
  let utterance: SpeechSynthesisUtterance | null = null;
  const listeners = new Set<() => void>();
  const update = (patch: Partial<typeof INITIAL>) => {
    snapshot = { ...snapshot, ...patch };
    listeners.forEach((listener) => listener());
  };
  const abortInput = () => {
    const current = recognition;
    recognition = null;
    if (current) {
      current.onresult = current.onerror = current.onend = null;
      try { current.abort(); } catch { /* Already ended. */ }
    }
    update({ listening: false, ending: false });
  };
  const stopSpeech = () => {
    if (utterance) {
      utterance.onend = utterance.onerror = null;
      utterance = null;
      try { browser?.speechSynthesis?.cancel(); } catch { /* Unavailable engine. */ }
    }
    update({ speakingId: null });
  };
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => snapshot,
    getServerSnapshot: () => INITIAL,
    connect(host: VoiceBrowser, enabled: boolean) {
      browser = enabled ? host : null;
      update({ ...INITIAL,
        recognitionSupported: Boolean(browser && (browser.SpeechRecognition || browser.webkitSpeechRecognition)),
        speechSupported: Boolean(browser?.speechSynthesis && browser?.SpeechSynthesisUtterance),
      });
    },
    dispose() {
      abortInput();
      stopSpeech();
      browser = null;
      update(INITIAL);
    },
    abortInput,
    stopSpeech,
    toggleInput(onTranscript: (text: string) => void) {
      if (!browser) return;
      if (recognition) {
        if (snapshot.ending) return;
        update({ ending: true });
        try { recognition.stop(); } catch { abortInput(); }
        return;
      }
      const Constructor = browser.SpeechRecognition || browser.webkitSpeechRecognition;
      if (!Constructor) { update({ error: "Voice input isn't supported in this browser." }); return; }
      stopSpeech();
      let receivedFinal = false;
      const seen = new Set<number>();
      try {
        const current = new Constructor();
        recognition = current;
        current.lang = browser.navigator?.language || "en-US";
        current.continuous = false;
        current.interimResults = false;
        current.onresult = (event) => {
          if (recognition !== current) return;
          const finals: string[] = [];
          for (let index = event.resultIndex; index < event.results.length; index++) {
            const result = event.results[index];
            if (result.isFinal && !seen.has(index)) {
              seen.add(index);
              if (result[0].transcript.trim()) finals.push(result[0].transcript.trim());
            }
          }
          if (finals.length) { receivedFinal = true; onTranscript(finals.join(" ")); }
        };
        current.onerror = ({ error }) => {
          if (recognition !== current) return;
          abortInput();
          const errors: Record<string, string> = {
            "not-allowed": "Microphone permission was denied.",
            "service-not-allowed": "Voice input is unavailable or blocked by this browser.",
            "audio-capture": "No microphone is available.",
            "no-speech": "I didn't catch anything. Try again.",
            aborted: "Voice input stopped.",
            network: "Voice input couldn't connect. Try again.",
            "language-not-supported": "Voice input doesn't support your browser language.",
          };
          update({ error: errors[error] || "Voice input is unavailable. Try again." });
        };
        current.onend = () => {
          if (recognition !== current) return;
          recognition = null;
          current.onresult = current.onerror = current.onend = null;
          update({ listening: false, ending: false, error: receivedFinal ? "" : "I didn't catch anything. Try again." });
        };
        update({ listening: true, ending: false, error: "" });
        current.start();
      } catch (error) {
        abortInput();
        update({ error: error instanceof Error && error.name === "NotAllowedError"
          ? "Microphone permission was denied." : "Voice input is unavailable. Try again." });
      }
    },
    speak(id: string, text: string) {
      if (!browser || !snapshot.speechSupported || !hasSpeechText(text)) return;
      if (snapshot.speakingId === id) { stopSpeech(); return; }
      abortInput();
      stopSpeech();
      try {
        const next = new browser.SpeechSynthesisUtterance!(text);
        utterance = next;
        next.lang = browser.navigator?.language || "en-US";
        next.onend = () => { if (utterance === next) { utterance = null; update({ speakingId: null }); } };
        next.onerror = () => { if (utterance === next) { utterance = null; update({ speakingId: null, error: "Couldn't read this response aloud. Try again." }); } };
        update({ speakingId: id, error: "" });
        browser.speechSynthesis!.speak(next);
      } catch {
        stopSpeech();
        update({ error: "Couldn't read this response aloud. Try again." });
      }
    },
  };
}

export function useNoaVoice(isOpen: boolean) {
  const [controller] = useState(createNoaVoice);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getServerSnapshot);
  useEffect(() => {
    controller.connect(window as VoiceBrowser, isOpen && process.env.NEXT_PUBLIC_NOA_VOICE_V1 === "true");
    return () => controller.dispose();
  }, [controller, isOpen]);
  return { ...state, ...controller };
}

export type NoaVoice = ReturnType<typeof useNoaVoice>;
