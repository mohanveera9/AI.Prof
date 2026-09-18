import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api";

interface RealtimeSession {
  conversationId: string;
  model: string;
  clientSecret: string;
}

interface TranscriptLine {
  role: "user" | "assistant";
  text: string;
}

type VoiceStatus = "idle" | "connecting" | "live" | "error";

/**
 * Browser WebRTC widget against OpenAI Realtime. Tool calls are executed
 * on our backend (never in the model sandbox). Barge-in: server VAD
 * interrupt_response plus local ducking when the user starts speaking.
 */
export default function VoiceWidget() {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [tools, setTools] = useState<string[]>([]);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const assistantBuffer = useRef("");

  useEffect(() => {
    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function start() {
    setError(null);
    setStatus("connecting");
    try {
      const session = await api<RealtimeSession>("/api/ai/realtime/session", {
        method: "POST",
        body: JSON.stringify({}),
      });
      conversationIdRef.current = session.conversationId;

      const pc = new RTCPeerConnection();
      pcRef.current = pc;
      const remote = new MediaStream();
      if (audioRef.current) audioRef.current.srcObject = remote;
      pc.ontrack = (event) => {
        event.streams[0]?.getTracks().forEach((track) => remote.addTrack(track));
      };

      const local = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = local;
      local.getTracks().forEach((track) => pc.addTrack(track, local));

      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;
      dc.onmessage = (event) => {
        try {
          handleRealtimeEvent(JSON.parse(event.data as string) as Record<string, unknown>);
        } catch {
          /* ignore malformed */
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const sdpResponse = await fetch(`https://api.openai.com/v1/realtime?model=${encodeURIComponent(session.model)}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${session.clientSecret}`,
          "content-type": "application/sdp",
          "openai-beta": "realtime=v1",
        },
        body: offer.sdp,
      });
      if (!sdpResponse.ok) {
        throw new Error(`Voice handshake failed (${sdpResponse.status})`);
      }
      const answer = await sdpResponse.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answer });
      setStatus("live");
    } catch (err) {
      stop();
      const message =
        err instanceof ApiError && err.status === 503
          ? "Voice needs a real OPENAI_API_KEY on the backend."
          : err instanceof Error
            ? err.message
            : "Could not start voice";
      setError(message);
      setStatus("error");
    }
  }

  function stop() {
    dcRef.current?.close();
    pcRef.current?.close();
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    dcRef.current = null;
    pcRef.current = null;
    localStreamRef.current = null;
    conversationIdRef.current = null;
    setStatus("idle");
  }

  function sendEvent(payload: unknown) {
    const dc = dcRef.current;
    if (dc && dc.readyState === "open") dc.send(JSON.stringify(payload));
  }

  function handleRealtimeEvent(event: Record<string, unknown>) {
    const type = String(event.type ?? "");

    if (type === "input_audio_buffer.speech_started") {
      if (audioRef.current) audioRef.current.volume = 0.15;
      sendEvent({ type: "response.cancel" });
      return;
    }
    if (type === "input_audio_buffer.speech_stopped") {
      if (audioRef.current) audioRef.current.volume = 1;
      return;
    }
    if (type === "conversation.item.input_audio_transcription.completed") {
      const text = String(event.transcript ?? "");
      if (text) {
        setTranscript((prev) => [...prev, { role: "user", text }]);
        persistTranscript("user", text);
      }
      return;
    }
    if (type === "response.audio_transcript.delta") {
      assistantBuffer.current += String(event.delta ?? "");
      return;
    }
    if (type === "response.audio_transcript.done") {
      const text = assistantBuffer.current.trim() || String(event.transcript ?? "");
      assistantBuffer.current = "";
      if (text) {
        setTranscript((prev) => [...prev, { role: "assistant", text }]);
        persistTranscript("assistant", text);
      }
      return;
    }
    if (type === "response.function_call_arguments.done") {
      const name = String(event.name ?? "");
      const callId = String(event.call_id ?? "");
      let args: unknown = {};
      try {
        args = event.arguments ? JSON.parse(String(event.arguments)) : {};
      } catch {
        args = {};
      }
      void runTool(name, args, callId);
    }
  }

  async function runTool(name: string, args: unknown, callId: string) {
    const conversationId = conversationIdRef.current;
    if (!conversationId) return;
    setTools((prev) => [...prev, name]);
    let output: unknown;
    try {
      output = await api(`/api/ai/conversations/${conversationId}/tools`, {
        method: "POST",
        body: JSON.stringify({ name, arguments: args }),
      });
    } catch (err) {
      output = { error: err instanceof Error ? err.message : "Tool failed" };
    }
    sendEvent({
      type: "conversation.item.create",
      item: { type: "function_call_output", call_id: callId, output: JSON.stringify(output) },
    });
    sendEvent({ type: "response.create" });
  }

  function persistTranscript(role: "user" | "assistant", content: string) {
    const conversationId = conversationIdRef.current;
    if (!conversationId) return;
    void api(`/api/ai/conversations/${conversationId}/transcript`, {
      method: "POST",
      body: JSON.stringify({ role, content }),
    }).catch(() => undefined);
  }

  return (
    <section className="flex flex-col h-full bg-white rounded-xl border border-slate-200 shadow-sm">
      <header className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">Voice</h2>
          <p className="text-xs text-slate-500">WebRTC · live transcript · barge-in</p>
        </div>
        {status === "live" ? (
          <button type="button" onClick={stop} className="text-sm rounded-md bg-red-600 text-white px-3 py-1.5">
            Hang up
          </button>
        ) : (
          <button type="button" onClick={start} disabled={status === "connecting"} className="text-sm rounded-md bg-teal-700 text-white px-3 py-1.5 disabled:opacity-50">
            {status === "connecting" ? "Connecting…" : "Start talking"}
          </button>
        )}
      </header>
      <audio ref={audioRef} autoPlay className="hidden" />
      <div className="flex-1 overflow-y-auto p-4 space-y-2 min-h-[280px]">
        {transcript.length === 0 && <p className="text-sm text-slate-400">Press start and speak. Interrupt the assistant at any time.</p>}
        {transcript.map((line, i) => (
          <div key={i} className={`text-sm ${line.role === "user" ? "text-teal-800" : "text-slate-700"}`}>
            <span className="font-medium">{line.role === "user" ? "You" : "Assistant"}: </span>
            {line.text}
          </div>
        ))}
        {tools.length > 0 && <p className="text-xs text-slate-400">Tools: {tools.join(" → ")}</p>}
      </div>
      {error && <p className="px-4 pb-3 text-xs text-red-600">{error}</p>}
    </section>
  );
}
