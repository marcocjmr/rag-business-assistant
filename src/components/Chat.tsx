"use client";

import { useChat } from "@ai-sdk/react";
import { useEffect, useRef, useState } from "react";
import type { ChatMessage, Source } from "@/lib/types";

const SUGGESTIONS = [
  "¿Cuáles son los horarios de atención?",
  "¿Cuánto cuesta una limpieza dental?",
  "¿Trabajan con Salud S.A.?",
  "¿Atienden los sábados?",
];

export default function Chat() {
  // En el AI SDK v5+ `useChat` ya no gestiona el input: se maneja con estado
  // propio y se envía con `sendMessage`. Da más control sobre la UI.
  const { messages, sendMessage, status, error } = useChat<ChatMessage>();
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const isBusy = status === "submitted" || status === "streaming";

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, status]);

  function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isBusy) return;
    sendMessage({ text: trimmed });
    setInput("");
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6">
        <div className="mx-auto flex max-w-2xl flex-col gap-6">
          {messages.length === 0 ? (
            <EmptyState onPick={submit} disabled={isBusy} />
          ) : (
            messages.map((message) => <Message key={message.id} message={message} />)
          )}

          {status === "submitted" && <TypingIndicator />}

          {error && (
            <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
              Ocurrió un error al procesar la consulta. Revisa que las variables de entorno
              estén configuradas y que la ingesta se haya ejecutado.
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      <div className="border-t border-slate-200 bg-white/80 px-4 py-4 backdrop-blur sm:px-6 dark:border-slate-800 dark:bg-slate-950/80">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(input);
          }}
          className="mx-auto flex max-w-2xl items-center gap-2"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Pregunta sobre horarios, precios o seguros..."
            aria-label="Escribe tu pregunta"
            className="flex-1 rounded-full border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
          />
          <button
            type="submit"
            disabled={isBusy || !input.trim()}
            aria-label="Enviar pregunta"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-teal-600 text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path d="M3.4 2.6a1 1 0 0 0-1.3 1.2l1.8 5.4L12 10l-8.1.8-1.8 5.4a1 1 0 0 0 1.3 1.2l14-7a1 1 0 0 0 0-1.8l-14-7Z" />
            </svg>
          </button>
        </form>
        <p className="mx-auto mt-2 max-w-2xl text-center text-xs text-slate-400 dark:text-slate-500">
          Demo educativa. Clínica ficticia; la información no es real.
        </p>
      </div>
    </div>
  );
}

function EmptyState({
  onPick,
  disabled,
}: {
  onPick: (text: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-6 py-10 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-teal-600 text-2xl">
        🦷
      </div>
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          ¿En qué puedo ayudarte?
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Respondo con información de la clínica: horarios, precios, seguros y servicios.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion}
            onClick={() => onPick(suggestion)}
            disabled={disabled}
            className="rounded-full border border-slate-300 px-3.5 py-1.5 text-sm text-slate-600 transition hover:border-teal-500 hover:text-teal-700 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:border-teal-500 dark:hover:text-teal-400"
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
}

function Message({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  const text = message.parts
    .filter((part) => part.type === "text")
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-teal-600 px-4 py-2.5 text-sm text-white">
          {text}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal-100 text-sm dark:bg-teal-900/50">
        🦷
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="rounded-2xl rounded-tl-sm bg-slate-100 px-4 py-2.5 text-sm whitespace-pre-wrap text-slate-800 dark:bg-slate-800 dark:text-slate-100">
          {text}
        </div>
        <Sources sources={message.metadata?.sources} />
      </div>
    </div>
  );
}

/**
 * Mostrar las fuentes es lo que separa un demo de RAG creíble de una caja negra:
 * el usuario ve de qué sección salió la respuesta y con qué similitud, lo que
 * hace verificable la afirmación de que no está inventando.
 */
function Sources({ sources }: { sources?: Source[] }) {
  if (!sources || sources.length === 0) return null;

  return (
    <details className="group px-1">
      <summary className="cursor-pointer list-none text-xs text-slate-400 transition hover:text-teal-600 dark:text-slate-500 dark:hover:text-teal-400">
        {sources.length} fragmento{sources.length > 1 ? "s" : ""} consultado
        {sources.length > 1 ? "s" : ""}
        <span className="ml-1 inline-block transition group-open:rotate-90">›</span>
      </summary>
      <ul className="mt-2 space-y-1">
        {sources.map((source, i) => (
          <li
            key={i}
            className="flex items-center justify-between gap-3 rounded-md bg-slate-50 px-2.5 py-1.5 text-xs text-slate-500 dark:bg-slate-900 dark:text-slate-400"
          >
            <span className="truncate">{source.section ?? "sin sección"}</span>
            <span className="shrink-0 font-mono text-teal-600 dark:text-teal-400">
              {(source.similarity * 100).toFixed(0)}%
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function TypingIndicator() {
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal-100 text-sm dark:bg-teal-900/50">
        🦷
      </div>
      <div className="flex items-center gap-1 rounded-2xl rounded-tl-sm bg-slate-100 px-4 py-3.5 dark:bg-slate-800">
        {[0, 150, 300].map((delay) => (
          <span
            key={delay}
            className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 dark:bg-slate-500"
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </div>
    </div>
  );
}
