import { streamText, convertToModelMessages, type UIMessage } from "ai";
import { openai } from "@ai-sdk/openai";
import { retrieveContext, formatContext } from "@/lib/retrieval";

// Este archivo solo corre en el servidor: OPENAI_API_KEY y DATABASE_URL
// nunca se envían al navegador.
export const maxDuration = 30;

const CHAT_MODEL = "gpt-4o-mini";

/**
 * El system prompt es el que convierte una búsqueda en un RAG confiable.
 * Las tres reglas que importan:
 *  1. Responder SOLO con el contexto -> evita que el modelo invente precios.
 *  2. Admitir cuando no sabe -> preferible a una respuesta plausible y falsa,
 *     sobre todo en un dominio donde el usuario podría actuar según el dato.
 *  3. Rol y tono explícitos -> mantiene la respuesta dentro del personaje.
 */
function buildSystemPrompt(context: string): string {
  return `Eres el asistente virtual de la Clínica Dental Sonrisa Andina, en Cuenca, Ecuador.
Ayudas a pacientes con consultas sobre horarios, precios, seguros, servicios y agendamiento.

REGLAS:
- Responde ÚNICAMENTE con la información del CONTEXTO que aparece abajo.
- Si el contexto no contiene la respuesta, dilo con claridad y sugiere contactar
  a la clínica por WhatsApp al 099 812 4470. No inventes datos, precios ni horarios.
- No hagas diagnósticos médicos ni recomiendes tratamientos: para eso indica que
  se requiere una consulta de valoración.
- Responde en español, en tono cordial y profesional, de forma breve y concreta.
- Cuando menciones precios, aclara que son referenciales y pueden variar según el caso.

CONTEXTO:
${context}`;
}

/** En el AI SDK v5+ un mensaje es una lista de `parts`, no un string plano. */
function extractText(message: UIMessage | undefined): string {
  if (!message) return "";
  return message.parts
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join(" ")
    .trim();
}

export async function POST(req: Request) {
  try {
    const { messages }: { messages: UIMessage[] } = await req.json();

    const question = extractText(messages.at(-1));
    if (!question) {
      return new Response("No se recibió ninguna pregunta.", { status: 400 });
    }

    // Recuperación: solo la última pregunta se usa para buscar. Es lo correcto
    // para consultas autocontenidas; una pregunta de seguimiento como "¿y eso
    // lo cubre el seguro?" se beneficiaría de reescribir la consulta con el
    // historial antes de embeberla (mejora natural para una siguiente versión).
    const chunks = await retrieveContext(question);

    const result = streamText({
      model: openai(CHAT_MODEL),
      system: buildSystemPrompt(formatContext(chunks)),
      messages: await convertToModelMessages(messages),
      temperature: 0.3, // bajo: en un asistente informativo se prefiere fidelidad a creatividad
    });

    // Devuelve un stream: el usuario ve la respuesta formándose token a token
    // en vez de esperar varios segundos a que el modelo termine.
    return result.toUIMessageStreamResponse({
      // Expone las fuentes al cliente para poder mostrarlas bajo la respuesta.
      messageMetadata: () => ({
        sources: chunks.map((chunk) => ({
          section: chunk.metadata.section,
          similarity: Number(chunk.similarity.toFixed(3)),
        })),
      }),
    });
  } catch (error) {
    console.error("Error en /api/chat:", error);
    return new Response("Error procesando la consulta.", { status: 500 });
  }
}
