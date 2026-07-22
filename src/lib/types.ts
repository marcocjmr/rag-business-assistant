import type { UIMessage } from "ai";

/** Fuente citada: de qué sección del documento salió el contexto usado. */
export type Source = {
  section?: string;
  similarity: number;
};

/**
 * Tipo de mensaje compartido entre el route handler y el cliente.
 * Parametrizar `UIMessage` con la forma de la metadata hace que el servidor y
 * la UI no puedan desincronizarse sin que TypeScript avise.
 */
export type ChatMessage = UIMessage<{ sources?: Source[] }>;
