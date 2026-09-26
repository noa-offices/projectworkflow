"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { NoaAnswer } from "@/lib/noa/noa-types";
import { createRealtimeTransport, createStreamingPlayer } from "./noa-realtime-transport";

export type VoiceEvent = { type: string; item_id?: string; delta?: string; transcript?: string };
export type VoicePhase = "idle" | "connecting" | "listening" | "transcribing" | "thinking" | "speaking" | "error";
export type VoiceSnapshot = { phase: VoicePhase; transcript: string; error?: string };
export type VoiceSubmit = (text: string) => Promise<NoaAnswer | undefined> | undefined;

// Voice-only, closed corrections. A name elsewhere in ordinary prose is never rewritten.
export function normalizeNoaVoiceTranscript(text: string): string {
  return text.trim()
    .replace(/^(hey|hello|hi|okay|ok)\s+(?:noah|nova|noa)(?=\s*[,!?]|\s*$)/i, "$1 NOA")
    .replace(/\bInterstool(?=\s+chairs?\b)/gi, "Interstuhl")
    .replace(/(\bchairs?\s+from\s+)Interstool\b/gi, "$1Interstuhl");
}
export interface RealtimeTransport {
  connect(signal: AbortSignal, receive: (event: VoiceEvent) => void): Promise<void>;
  close(): void;
}
export interface StreamingPlayer {
  unlock(): Promise<void>;
  play(text: string, signal: AbortSignal, started: () => void): Promise<void>;
  stop(): void;
  dispose(): void;
}

// Internal seams keep lifecycle tests independent of microphone, network and audio hardware.
export function createNoaRealtimeVoice(transport: RealtimeTransport, player: StreamingPlayer, submit: VoiceSubmit) {
  let snapshot: VoiceSnapshot = { phase: "idle", transcript: "" };
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
    snapshot = { phase, transcript };
    listeners.forEach((listener) => listener());
  };
  const silence = () => { playback?.abort(); playback = undefined; player.stop(); };
  const stop = (phase: "idle" | "error" = "idle") => {
    session++;
    connection?.abort(); connection = undefined;
    silence(); transport.close(); player.dispose();
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
        if (typeof event.delta === "string") update("transcribing", (snapshot.transcript + event.delta).slice(0, 2000));
        return;
      }
      if (event.type !== "conversation.item.input_audio_transcription.completed") return;
      completed.add(id);
      const text = typeof event.transcript === "string" ? normalizeNoaVoiceTranscript(event.transcript) : "";
      if (!text) { update("listening", ""); return; }
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
        playback = new AbortController();
        const speechSignal = playback.signal;
        // Do not hold the NOA queue while audio plays; new turns can interrupt it immediately.
        void player.play(voiceText, speechSignal, () => {
          if (valid() && turn === activeTurn && !speechSignal.aborted) update("speaking");
        }).then(() => {
          if (valid() && turn === activeTurn && !speechSignal.aborted) { touch(); update("listening"); }
        }).catch(() => {
          if (valid() && turn === activeTurn && !speechSignal.aborted) {
            // Keep neural playback ownership until End; never switch engines on a TTS error.
            silence(); touch();
            snapshot = { phase: "listening", transcript: snapshot.transcript, error: "Speech couldn't play. You can keep talking or end voice." };
            listeners.forEach((listener) => listener());
          }
        });
      }).catch(() => { if (valid() && turn === activeTurn) stop("error"); });
    };
    try {
      // Called directly from the Start click so mobile audio is unlocked by a user gesture.
      await player.unlock();
      if (!valid()) return;
      await transport.connect(signal, receive);
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
