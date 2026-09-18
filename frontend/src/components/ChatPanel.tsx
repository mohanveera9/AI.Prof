import { FormEvent, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api";

interface ChatMessage {
  role: string;
  content: string;
  toolName?: string | null;
}

interface Conversation {
  id: string;
  messages?: ChatMessage[];
}

export default function ChatPanel() {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<Conversation>("/api/ai/conversations", { method: "POST", body: JSON.stringify({ channel: "web_chat" }) })
      .then((conv) => {
        setConversationId(conv.id);
        setMessages(conv.messages ?? []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not start chat"));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!conversationId || !draft.trim() || busy) return;
    const content = draft.trim();
    setDraft("");
    setMessages((prev) => [...prev, { role: "user", content }]);
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ reply: string; toolTrace: Array<{ name: string; success: boolean }> }>(
        `/api/ai/conversations/${conversationId}/messages`,
        { method: "POST", body: JSON.stringify({ content }) },
      );
      setMessages((prev) => [...prev, { role: "assistant", content: result.reply }]);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 503
          ? "Chat needs a real OPENAI_API_KEY on the backend."
          : err instanceof Error
            ? err.message
            : "Send failed",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col h-full bg-white rounded-xl border border-slate-200 shadow-sm">
      <header className="px-4 py-3 border-b border-slate-100">
        <h2 className="text-sm font-semibold text-slate-800">Text chat</h2>
        <p className="text-xs text-slate-500">Administrative scheduling assistant</p>
      </header>
      <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[280px]">
        {messages
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m, i) => (
            <div key={i} className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${m.role === "user" ? "ml-auto bg-teal-700 text-white" : "bg-slate-100 text-slate-800"}`}>
              {m.content}
            </div>
          ))}
        {busy && <p className="text-xs text-slate-400">Thinking…</p>}
        <div ref={bottomRef} />
      </div>
      {error && <p className="px-4 text-xs text-red-600">{error}</p>}
      <form onSubmit={send} className="p-3 border-t border-slate-100 flex gap-2">
        <input
          className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
          placeholder="Book an appointment, check availability…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" disabled={busy || !conversationId} className="rounded-md bg-teal-700 text-white px-3 py-2 text-sm disabled:opacity-50">
          Send
        </button>
      </form>
    </section>
  );
}
