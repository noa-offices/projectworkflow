import type { RealtimeTransport, StreamingPlayer, VoiceEvent } from "./use-noa-realtime-voice";

export function createRealtimeTransport(): RealtimeTransport {
  let dispose = () => {};
  return {
    close() { dispose(); },
    async connect(signal, receive) {
      dispose();
      const peer = new RTCPeerConnection();
      const channel = peer.createDataChannel("oai-events");
      let stream: MediaStream | undefined;
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        stream?.getTracks().forEach((track) => track.stop());
        channel.close(); peer.close();
        signal.removeEventListener("abort", close);
      };
      dispose = close;
      signal.addEventListener("abort", close, { once: true });
      if (signal.aborted) { close(); throw new Error("Cancelled"); }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        if (closed) { stream.getTracks().forEach((track) => track.stop()); throw new Error("Cancelled"); }
        stream.getTracks().forEach((track) => {
          peer.addTrack(track, stream!);
          track.onended = () => { if (!closed) receive({ type: "error" }); };
        });
        channel.onmessage = (message) => {
          if (closed || typeof message.data !== "string" || message.data.length > 32_000) return;
          try {
            const event: unknown = JSON.parse(message.data);
            if (event && typeof event === "object" && "type" in event && typeof event.type === "string") receive(event as VoiceEvent);
          } catch { /* Ignore malformed provider events; no payload logging. */ }
        };
        channel.onclose = () => { if (!closed) receive({ type: "error" }); };
        peer.onconnectionstatechange = () => {
          if (!closed && ["failed", "disconnected", "closed"].includes(peer.connectionState)) receive({ type: "error" });
        };
        const setupSignal = AbortSignal.any([signal, AbortSignal.timeout(20_000)]);
        const credential = await fetch("/api/noa/voice/session", { method: "POST", signal: setupSignal });
        if (!credential.ok) throw new Error("Voice unavailable");
        const { value } = await credential.json() as { value?: string };
        if (!value) throw new Error("Voice unavailable");
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        const answer = await fetch("https://api.openai.com/v1/realtime/calls", {
          method: "POST", body: offer.sdp,
          headers: { Authorization: `Bearer ${value}`, "Content-Type": "application/sdp" }, signal: setupSignal,
        });
        if (!answer.ok) throw new Error("Voice unavailable");
        await peer.setRemoteDescription({ type: "answer", sdp: await answer.text() });
        await new Promise<void>((resolve, reject) => {
          const finish = (error?: Error) => {
            setupSignal.removeEventListener("abort", aborted);
            channel.removeEventListener("open", opened);
            channel.removeEventListener("close", failed);
            channel.removeEventListener("error", failed);
            if (error) reject(error); else resolve();
          };
          const opened = () => finish();
          const failed = () => finish(new Error("Voice unavailable"));
          const aborted = () => finish(new Error("Cancelled"));
          channel.addEventListener("open", opened, { once: true });
          channel.addEventListener("close", failed, { once: true });
          channel.addEventListener("error", failed, { once: true });
          setupSignal.addEventListener("abort", aborted, { once: true });
          if (setupSignal.aborted || closed) aborted();
          else if (channel.readyState === "open") opened();
        });
      } catch (error) { close(); throw error; }
    },
  };
}

// Speech API PCM is signed 16-bit little endian, mono, 24 kHz. Schedule chunks as
// they arrive instead of buffering the entire utterance. No recording or storage.
export function createStreamingPlayer(): StreamingPlayer {
  let context: AudioContext | undefined;
  let cancel = () => {};
  return {
    async unlock() {
      context ??= new AudioContext();
      await context.resume();
    },
    stop() { cancel(); },
    dispose() { cancel(); if (context) void context.close().catch(() => {}); context = undefined; },
    async play(text, signal, started) {
      cancel();
      const audio = context;
      if (!audio || audio.state !== "running") throw new Error("Audio unavailable");
      const sources = new Set<AudioBufferSourceNode>();
      const abort = new AbortController();
      const stop = () => {
        abort.abort();
        sources.forEach((source) => { source.stop(); source.disconnect(); });
        sources.clear();
      };
      cancel = stop;
      signal.addEventListener("abort", stop, { once: true });
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      let finished = false;
      try {
        if (signal.aborted) { stop(); return; }
        const response = await fetch("/api/noa/voice/speech", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ voiceText: text }),
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(60_000)]),
        });
        if (!response.ok || !response.body) throw new Error("Speech unavailable");
        reader = response.body.getReader();
        let remainder: number | undefined;
        let next = audio.currentTime + 0.04;
        let samples = 0;
        let began = false;
        while (true) {
          const { value, done } = await reader.read();
          if (abort.signal.aborted) return;
          if (done) break;
          const bytes = new Uint8Array(value.length + (remainder === undefined ? 0 : 1));
          if (remainder !== undefined) bytes[0] = remainder;
          bytes.set(value, remainder === undefined ? 0 : 1);
          remainder = bytes.length % 2 ? bytes[bytes.length - 1] : undefined;
          const count = Math.floor(bytes.length / 2);
          if (!count) continue;
          samples += count;
          if (samples > 24_000 * 90) throw new Error("Speech too long");
          const buffer = audio.createBuffer(1, count, 24_000);
          const data = buffer.getChannelData(0);
          const view = new DataView(bytes.buffer);
          for (let index = 0; index < count; index++) data[index] = view.getInt16(index * 2, true) / 32768;
          const source = audio.createBufferSource();
          source.buffer = buffer; source.connect(audio.destination);
          sources.add(source);
          source.onended = () => { sources.delete(source); source.disconnect(); };
          next = Math.max(next, audio.currentTime + 0.01);
          source.start(next); next += buffer.duration;
          if (!began) { began = true; started(); }
        }
        if (!began || remainder !== undefined) throw new Error("Invalid speech stream");
        await new Promise<void>((resolve) => {
          const timer = setTimeout(done, Math.max(0, (next - audio.currentTime) * 1000));
          function done() { clearTimeout(timer); abort.signal.removeEventListener("abort", done); resolve(); }
          abort.signal.addEventListener("abort", done, { once: true });
          if (abort.signal.aborted) done();
        });
        finished = true;
      } finally {
        signal.removeEventListener("abort", stop);
        if (!finished) stop();
        if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      }
    },
  };
}
