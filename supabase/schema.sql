-- Schema para el almacén de vectores del asistente RAG.
-- Ejecutar en el SQL Editor de Supabase (Dashboard > SQL Editor > New query).

-- pgvector añade el tipo de columna `vector` y los operadores de distancia.
-- En Supabase la extensión ya está disponible; solo hay que habilitarla.
create extension if not exists vector;

-- Cada fila es un "chunk": un fragmento del documento de la clínica
-- junto con su representación vectorial.
create table if not exists documents (
  id bigint primary key generated always as identity,
  content text not null,          -- el texto original del chunk (lo que se inyecta al prompt)
  metadata jsonb default '{}',    -- fuente, sección, etc. — útil para citar o filtrar
  embedding vector(1536) not null -- text-embedding-3-small produce 1536 dimensiones
);

-- Función de búsqueda por similitud, expuesta al cliente vía RPC.
-- `<=>` es el operador de distancia coseno de pgvector (0 = idénticos, 2 = opuestos);
-- se convierte a similitud con `1 - distancia` para que sea más legible (1 = idénticos).
create or replace function match_documents(
  query_embedding vector(1536),
  match_count int default 3
)
returns table (
  id bigint,
  content text,
  metadata jsonb,
  similarity float
)
language sql stable
as $$
  select
    d.id,
    d.content,
    d.metadata,
    1 - (d.embedding <=> query_embedding) as similarity
  from documents d
  order by d.embedding <=> query_embedding
  limit match_count;
$$;

-- Índice HNSW para búsqueda aproximada de vecinos cercanos.
-- Con decenas de filas es innecesario (un scan secuencial es instantáneo),
-- pero se incluye porque es lo que haría este schema viable a escala.
create index if not exists documents_embedding_idx
  on documents using hnsw (embedding vector_cosine_ops);
