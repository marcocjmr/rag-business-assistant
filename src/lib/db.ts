import { neon } from "@neondatabase/serverless";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL no está definida — copia .env.example a .env.local");
}

// Cliente SQL como tagged template: sql`select ... where id = ${id}`
// interpola de forma segura (parametrizada), nunca por concatenación de strings.
export const sql = neon(process.env.DATABASE_URL);
