import { embed } from "ai";
import { openai } from "@ai-sdk/openai";
import { getSql } from "./db";

/**
 * Debe ser el MISMO modelo usado en la ingesta.
 * Los vectores de modelos distintos no son comparables entre sí: viven en
 * espacios geométricos diferentes, aunque tengan las mismas dimensiones.
 * Cambiar este modelo obliga a re-generar todos los embeddings guardados.
 */
const EMBEDDING_MODEL = "text-embedding-3-small";

/**
 * Cuántos chunks se recuperan. Tres es un punto medio deliberado:
 * suficientes para cubrir preguntas que cruzan dos temas ("¿cuánto cuesta
 * una limpieza y me lo cubre el seguro?"), pocos como para que el prompt siga
 * siendo barato y el modelo no se distraiga con texto irrelevante.
 */
const MATCH_COUNT = 3;

/**
 * Umbral de similitud coseno por debajo del cual un chunk se descarta.
 *
 * La búsqueda vectorial SIEMPRE devuelve los N más cercanos, incluso si la
 * pregunta no tiene nada que ver con el documento: preguntar por el clima
 * devolvería igual tres chunks sobre odontología. Filtrar por similitud es lo
 * que permite responder "no tengo esa información" en vez de alucinar sobre
 * contexto irrelevante. 0.3 es empírico para text-embedding-3-small.
 */
const MIN_SIMILARITY = 0.3;

export type RetrievedChunk = {
  id: number;
  content: string;
  metadata: { section?: string; source?: string };
  similarity: number;
};

/**
 * Convierte la pregunta en vector y busca los chunks más cercanos en pgvector.
 */
export async function retrieveContext(question: string): Promise<RetrievedChunk[]> {
  const { embedding } = await embed({
    model: openai.embedding(EMBEDDING_MODEL),
    value: question,
  });

  // `match_documents` vive en la base (db/schema.sql). El vector se envía como
  // parámetro y se castea, nunca concatenado en el texto de la consulta.
  const rows = (await getSql()`
    select id, content, metadata, similarity
    from match_documents(${JSON.stringify(embedding)}::vector, ${MATCH_COUNT})
  `) as RetrievedChunk[];

  return rows.filter((row) => row.similarity >= MIN_SIMILARITY);
}

/**
 * Arma el bloque de contexto que se inyecta al prompt.
 * Se numera cada fragmento y se nombra su sección para que el modelo pueda
 * citar la fuente ("según la sección de Horarios...").
 */
export function formatContext(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) return "No se encontró información relevante en la base de conocimiento.";

  return chunks
    .map(
      (chunk, i) =>
        `[Fragmento ${i + 1} — ${chunk.metadata.section ?? "sin sección"}]\n${chunk.content}`,
    )
    .join("\n\n");
}
