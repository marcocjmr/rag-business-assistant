import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

let client: NeonQueryFunction<false, false> | null = null;

/**
 * Devuelve el cliente SQL, creándolo la primera vez que se usa.
 *
 * La conexión se resuelve de forma perezosa a propósito: si se creara al
 * importar el módulo, `next build` fallaría, porque el build importa cada route
 * handler para analizarlo y en ese momento las variables de entorno pueden no
 * existir todavía. En general, un módulo no debería lanzar excepciones solo por
 * ser importado.
 *
 * El cliente se memoiza para no reconstruirlo en cada consulta.
 *
 * Uso: getSql()`select * from documents where id = ${id}`
 * La interpolación del tagged template se convierte en consulta parametrizada,
 * nunca en concatenación de strings, así que no hay inyección SQL.
 */
export function getSql(): NeonQueryFunction<false, false> {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL no está definida — copia .env.example a .env.local");
    }
    client = neon(url);
  }
  return client;
}
