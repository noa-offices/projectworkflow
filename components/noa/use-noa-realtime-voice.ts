"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { NoaAnswer } from "@/lib/noa/noa-types";
import { createRealtimeTransport, createStreamingPlayer } from "./noa-realtime-transport";
import type { NoaVoiceProviderId, NoaVoiceSession } from "@/lib/noa/noa-voice-provider";

export type VoiceEvent = { type: string; item_id?: string; delta?: string; transcript?: string };
export type VoicePhase = "idle" | "connecting" | "listening" | "transcribing" | "thinking" | "speaking" | "error";
export type VoiceSnapshot = { phase: VoicePhase; transcript: string; error?: string; voiceSessionProvider: NoaVoiceProviderId | null };
export type VoiceSubmit = (text: string) => Promise<NoaAnswer | undefined> | undefined;

// Voice-only, closed corrections. A name elsewhere in ordinary prose is never rewritten.
export function normalizeNoaVoiceTranscript(text: string): string {
  return text.trim()
    .replace(/^(hey|hello|hi|okay|ok)\s+(?:noah|nova|noa)(?=\s*[,!?]|\s*$)/i, "$1 NOA")
    .replace(/\bInterstool(?=\s+chairs?\b)/gi, "Interstuhl")
    .replace(/(\bchairs?\s+from\s+)Interstool\b/gi, "$1Interstuhl");
}

export function isUnusableNoaVoiceTranscript(text: string): boolean {
  const normalized = text.toLowerCase().replace(/[’']/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  if (!normalized || /^(?:um|uh|erm|hmm)(?: (?:um|uh|erm|hmm))+$/.test(normalized)) return true;
  // Closed signatures of our static transcription context, including partial echoes.
  // Never a fuzzy score or a filter on unfamiliar business/product vocabulary.
  return /\bassistants name is noa\b|\bspelled n o a\b|\bwhen addressing the assistant\b|\btranscribe the name as noa not noah\b|\bpreserve noah when referring to a person\b|\bnoa projectworkflow las las mobili interstuhl\b/.test(normalized)
    || /^this is projectworkflow(?:$| the assistants?\b)/.test(normalized);
}
export interface RealtimeTransport {
  connect(signal: AbortSignal, receive: (event: VoiceEvent) => void): Promise<NoaVoiceSession>;
  close(): void;
}
export interface StreamingPlayer {
  unlock(): Promise<void>;
  play(text: string, signal: AbortSignal, started: () => void, session: NoaVoiceSession, replace: (next: NoaVoiceSession) => void): Promise<void>;
  stop(): void;
  dispose(): void;
}

// Internal seams keep lifecycle tests independent of microphone, network and audio hardware.
export function createNoaRealtimeVoice(transport: RealtimeTransport, player: StreamingPlayer, submit: VoiceSubmit) {
  let voiceSession: NoaVoiceSession | undefined;
  let snapshot: VoiceSnapshot = { phase: "idle", transcript: "", voiceSessionProvider: null };
  const getSnapshot = () => snapshot;
  const listeners = new Set<() => void>();
  let session = 0;
  let turn = 0;
  let currentItem = "";
  const items = new Map<string, number>();
  const completed = new Set<string>();
  let connection: AbortController | undefined;
  let playback: AbortController | undefined;
  let queue = Promise.resolve();
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let sessionTimer: ReturnType<typeof setTimeout> | undefined;
  const update = (phase: VoicePhase, transcript = snapshot.transcript) => {
    snapshot = { phase, transcript, voiceSessionProvider: voiceSession?.provider ?? null };
    listeners.forEach((listener) => listener());
  };
  const silence = () => { playback?.abort(); playback = undefined; player.stop(); };
  const stop = (phase: "idle" | "error" = "idle") => {
    session++;
    connection?.abort(); connection = undefined;
    silence(); transport.close(); player.dispose();
    voiceSession = undefined;
    clearTimeout(idleTimer); clearTimeout(sessionTimer);
    items.clear(); completed.clear(); currentItem = "";
    update(phase, "");
  };
  const touch = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => stop(), 120_000);
  };
  const start = async () => {
    if (snapshot.phase !== "idle" && snapshot.phase !== "error") return;
    stop();
    const activeSession = session;
    connection = new AbortController();
    const signal = connection.signal;
    const valid = () => session === activeSession && !signal.aborted;
    update("connecting", "");
    touch();
    sessionTimer = setTimeout(() => stop(), 600_000);
    const receive = (event: VoiceEvent) => {
      if (!valid()) return;
      if (event.type === "error" || event.type === "conversation.item.input_audio_transcription.failed") { stop("error"); return; }
      const id = event.item_id;
      if (!id) return;
      if (event.type === "input_audio_buffer.speech_started") {
        if (items.has(id)) return;
        if (items.size >= 100) { stop(); return; }
        currentItem = id;
        items.set(id, ++turn);
        silence(); touch(); update("listening", "");
        return;
      }
      // Server VAD assigns item_id at speech start. Out-of-order older finals cannot steal a turn.
      const activeTurn = items.get(id);
      if (id !== currentItem || activeTurn !== turn || completed.has(id)) return;
      if (event.type === "input_audio_buffer.speech_stopped") { update("transcribing"); return; }
      if (event.type === "conversation.item.input_audio_transcription.delta") {
        // Final-only display: an interim fragment can become a prompt echo in a later
        // delta. Never expose unvalidated provider text, even briefly, in the drawer.
        if (typeof event.delta === "string") update("transcribing", "");
        return;
      }
      if (event.type !== "conversation.item.input_audio_transcription.completed") return;
      completed.add(id);
      const text = typeof event.transcript === "string" ? normalizeNoaVoiceTranscript(event.transcript) : "";
      if (isUnusableNoaVoiceTranscript(text)) { update("listening", ""); return; }
      if (text.length > 2000) { stop("error"); return; }
      touch(); update("thinking", text);
      // Keep NOA requests ordered: each uses the references returned by its predecessor.
      // Already submitted requests finish visually, even after interruption or session end.
      queue = queue.then(async () => {
        if (!valid()) return;
        const answer = await submit(text);
        if (!valid() || turn !== activeTurn) return;
        const voiceText = answer?.voiceText;
        if (typeof voiceText !== "string" || !/[\p{L}\p{N}]/u.test(voiceText) || voiceText.length > 600) {
          update("listening"); return;
        }
        if (!voiceSession) { stop("error"); return; }
        playback = new AbortController();
        const speechSignal = playback.signal;
        // Do not hold the NOA queue while audio plays; new turns can interrupt it immediately.
        void player.play(voiceText, speechSignal, () => {
          if (valid() && turn === activeTurn && !speechSignal.aborted) update("speaking");
        }, voiceSession, (next) => {
          if (valid() && turn === activeTurn && !speechSignal.aborted) voiceSession = next;
        }).then(() => {
          if (valid() && turn === activeTurn && !speechSignal.aborted) { touch(); update("listening"); }
        }).catch(() => {
          if (valid() && turn === activeTurn && !speechSignal.aborted) {
            // Failed playback is stopped; any authorized replacement is for the next utterance.
            silence(); touch();
            snapshot = { phase: "listening", transcript: snapshot.transcript, voiceSessionProvider: voiceSession?.provider ?? null, error: "Speech couldn't play. You can keep talking or end voice." };
            listeners.forEach((listener) => listener());
          }
        });
      }).catch(() => { if (valid() && turn === activeTurn) stop("error"); });
    };
    try {
      // Called directly from the Start click so mobile audio is unlocked by a user gesture.
      await player.unlock();
      if (!valid()) return;
      const selected = await transport.connect(signal, receive);
      if (!valid()) return;
      voiceSession = selected;
      if (valid() && getSnapshot().phase === "connecting") update("listening");
    } catch { if (valid()) stop("error"); }
  };
  return { start, stop: () => stop(), getSnapshot, setSubmit: (next: VoiceSubmit) => { submit = next; },
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; } };
}

export function useNoaRealtimeVoice(isOpen: boolean, onSend: VoiceSubmit) {
  const [controller] = useState(() => createNoaRealtimeVoice(createRealtimeTransport(), createStreamingPlayer(), onSend));
  useEffect(() => { controller.setSubmit(onSend); }, [controller, onSend]);
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => {
    if (!isOpen) controller.stop();
    return () => controller.stop();
  }, [controller, isOpen]);
  return { ...snapshot, start: controller.start, stop: controller.stop,
    active: snapshot.phase !== "idle" && snapshot.phase !== "error" };
}
