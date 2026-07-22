/**
 * Ingesta: documento markdown -> chunks -> embeddings -> Postgres/pgvector.
 *
 *   npm run ingest -- --dry-run   ve los chunks sin llamar a OpenAI ni a la base
 *   npm run ingest                genera embeddings y los guarda
 *
 * El script es idempotente: reemplaza el contenido de la tabla en cada corrida,
 * así que volver a ejecutarlo tras editar el documento no duplica filas.
 */
import { config } from "dotenv";
import { embedMany } from "ai";
import { openai } from "@ai-sdk/openai";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

config({ path: ".env.local", quiet: true });

const SOURCE_FILE = resolve("data/clinica-sonrisa-andina.md");

/**
 * Tamaño máximo de chunk, en caracteres.
 *
 * Esta es la decisión que más afecta la calidad de un RAG:
 * - Chunks muy grandes diluyen el embedding (un vector que "promedia" varios temas
 *   no se parece mucho a ninguna pregunta concreta) y desperdician contexto del LLM.
 * - Chunks muy pequeños fragmentan la respuesta: el precio queda en un chunk y la
 *   condición que lo matiza en otro, y el modelo recupera solo la mitad.
 * Para un documento de FAQ/informativo, ~1000 caracteres (≈250 tokens) equivale a
 * un par de párrafos: suficiente para una idea completa, específico para buscar.
 */
const MAX_CHUNK_CHARS = 1000;

const EMBEDDING_MODEL = "text-embedding-3-small";

type Section = { breadcrumb: string; body: string };
type Chunk = { content: string; metadata: Record<string, unknown> };

/**
 * Divide el markdown en secciones usando los encabezados `##` y `###`.
 *
 * Partir por encabezados (en vez de cada N caracteres a ciegas) respeta las
 * fronteras semánticas que el autor ya marcó: cada sección trata un solo tema.
 * Se arrastra un "breadcrumb" (`Precios de servicios > Endodoncia y cirugía`)
 * para que un subapartado no pierda el contexto de su sección padre.
 */
function splitIntoSections(markdown: string): Section[] {
  const sections: Section[] = [];
  let h2 = "";
  let current: Section | null = null;

  for (const line of markdown.split("\n")) {
    const h2Match = line.match(/^##\s+(.+)$/);
    const h3Match = line.match(/^###\s+(.+)$/);

    if (h2Match) {
      if (current) sections.push(current);
      h2 = h2Match[1].trim();
      current = { breadcrumb: h2, body: "" };
    } else if (h3Match) {
      if (current) sections.push(current);
      current = { breadcrumb: `${h2} > ${h3Match[1].trim()}`, body: "" };
    } else if (current) {
      current.body += line + "\n";
    }
  }
  if (current) sections.push(current);

  return sections.filter((s) => s.body.trim().length > 0);
}

/**
 * Convierte secciones en chunks listos para embeber.
 *
 * Si una sección excede el máximo, se reparte por párrafos (nunca a mitad de una
 * frase). Cada chunk lleva su breadcrumb como encabezado: sin eso, el fragmento
 * "Endodoncia en molar: 280 dólares" embebido solo no se parece a la pregunta
 * "¿cuánto cuesta un tratamiento de conducto?" — el título aporta el vocabulario
 * que conecta ambos.
 */
function chunkSections(sections: Section[], source: string): Chunk[] {
  const chunks: Chunk[] = [];

  for (const section of sections) {
    const paragraphs = section.body
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean);

    const parts: string[] = [];
    let buffer = "";

    for (const paragraph of paragraphs) {
      const candidate = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
      if (candidate.length > MAX_CHUNK_CHARS && buffer) {
        parts.push(buffer);
        buffer = paragraph;
      } else {
        buffer = candidate;
      }
    }
    if (buffer) parts.push(buffer);

    parts.forEach((part, index) => {
      chunks.push({
        content: `${section.breadcrumb}\n\n${part}`,
        metadata: {
          source,
          section: section.breadcrumb,
          part: index + 1,
          totalParts: parts.length,
        },
      });
    });
  }

  return chunks;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const markdown = await readFile(SOURCE_FILE, "utf-8");
  const sections = splitIntoSections(markdown);
  const chunks = chunkSections(sections, basename(SOURCE_FILE));

  const lengths = chunks.map((c) => c.content.length);
  console.log(`Documento: ${basename(SOURCE_FILE)}`);
  console.log(`Secciones: ${sections.length} | Chunks: ${chunks.length}`);
  console.log(
    `Tamaño de chunk — mín ${Math.min(...lengths)}, máx ${Math.max(...lengths)}, ` +
      `promedio ${Math.round(lengths.reduce((a, b) => a + b, 0) / chunks.length)} caracteres\n`,
  );

  if (dryRun) {
    chunks.forEach((chunk, i) => {
      console.log(`--- chunk ${i + 1}/${chunks.length} (${chunk.content.length} chars) ---`);
      console.log(chunk.content);
      console.log();
    });
    console.log("Dry run: no se generaron embeddings ni se escribió en la base.");
    return;
  }

  // Una sola llamada para todos los chunks: la API acepta lotes, y hacerlo así
  // evita N round-trips y respeta mejor los límites de tasa.
  console.log(`Generando embeddings con ${EMBEDDING_MODEL}...`);
  const { embeddings, usage } = await embedMany({
    model: openai.embedding(EMBEDDING_MODEL),
    values: chunks.map((c) => c.content),
  });

  // text-embedding-3-small cuesta 0,02 USD por millón de tokens.
  const cost = ((usage.tokens ?? 0) / 1_000_000) * 0.02;
  console.log(
    `${embeddings.length} embeddings de ${embeddings[0].length} dimensiones · ` +
      `${usage.tokens} tokens · ~$${cost.toFixed(6)}`,
  );

  const { getSql } = await import("../src/lib/db");
  const sql = getSql();

  // Borrado + inserción dentro de una transacción: si algo falla a medio camino
  // no queda la tabla vacía ni a medias.
  await sql.transaction([
    sql`delete from documents`,
    ...chunks.map(
      (chunk, i) => sql`
        insert into documents (content, metadata, embedding)
        values (
          ${chunk.content},
          ${JSON.stringify(chunk.metadata)}::jsonb,
          ${JSON.stringify(embeddings[i])}::vector
        )
      `,
    ),
  ]);

  console.log(`Listo: ${chunks.length} chunks guardados en la tabla documents.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
