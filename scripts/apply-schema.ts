/**
 * Aplica db/schema.sql a la base de datos usando el driver HTTP de Neon.
 *
 *   npm run db:setup
 *
 * Por qué existe este script en vez de usar el SQL Editor de Neon:
 *  - Corre sobre HTTPS (puerto 443), el MISMO canal que usa la app. Si una red
 *    restrictiva bloquea el puerto 5432 (psql) o los WebSockets de la consola
 *    web, esto sigue funcionando.
 *  - Es reproducible: cualquiera que clone el repo levanta el schema con un
 *    comando, sin pasos manuales en un panel web.
 */
import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";
import { readFile } from "node:fs/promises";

config({ path: ".env.local", quiet: true });

const dryRun = process.argv.includes("--dry-run");

if (!dryRun && !process.env.DATABASE_URL) {
  console.error("DATABASE_URL no está definida — créala en .env.local");
  process.exit(1);
}

/**
 * Divide un archivo .sql en sentencias individuales.
 *
 * El driver HTTP ejecuta una sentencia por llamada, así que hay que separarlas.
 * No se puede partir ingenuamente en cada ";": un punto y coma puede estar
 * dentro de un comentario (`-- ...;`), de un literal ('...') o del cuerpo de una
 * función delimitado por `$$`. El parser sigue el estado para dividir solo en
 * los ";" que realmente terminan una sentencia.
 */
function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inString = false; // dentro de '...'
  let inDollar = false; // dentro de $$...$$
  let inLineComment = false; // dentro de -- ...

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    const next = sql[i + 1];

    if (inLineComment) {
      current += char;
      if (char === "\n") inLineComment = false;
    } else if (inString) {
      current += char;
      if (char === "'") inString = false;
    } else if (inDollar) {
      if (char === "$" && next === "$") {
        current += "$$";
        i++;
        inDollar = false;
      } else {
        current += char;
      }
    } else if (char === "-" && next === "-") {
      current += char;
      inLineComment = true;
    } else if (char === "'") {
      current += char;
      inString = true;
    } else if (char === "$" && next === "$") {
      current += "$$";
      i++;
      inDollar = true;
    } else if (char === ";") {
      if (current.trim()) statements.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

async function main() {
  const file = await readFile("db/schema.sql", "utf-8");
  const statements = splitStatements(file);

  if (dryRun) {
    console.log(`${statements.length} sentencias detectadas:\n`);
    statements.forEach((statement, i) => {
      console.log(`--- sentencia ${i + 1} ---`);
      console.log(statement);
      console.log();
    });
    console.log("Dry run: no se conectó a la base ni se ejecutó nada.");
    return;
  }

  const sql = neon(process.env.DATABASE_URL!);

  console.log(`Aplicando ${statements.length} sentencias a Neon (vía HTTPS)...\n`);

  for (const statement of statements) {
    // Primera línea de la sentencia, para un log legible.
    const label = statement.split("\n").find((l) => l.trim() && !l.trim().startsWith("--"));
    console.log(`  → ${label?.slice(0, 60) ?? statement.slice(0, 60)}`);
    await sql.query(statement);
  }

  const [{ count }] = (await sql`select count(*)::int as count from documents`) as {
    count: number;
  }[];
  console.log(`\nListo. La tabla documents existe y tiene ${count} filas.`);
}

main().catch((error) => {
  console.error("\nFalló la aplicación del schema:");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
