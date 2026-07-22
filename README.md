# Asistente RAG para negocios

Chatbot de **RAG** (Retrieval-Augmented Generation) que responde preguntas sobre un
negocio usando únicamente su documentación interna, citando de qué fragmento salió
cada respuesta.

El caso de demostración es una clínica dental ficticia en Cuenca, Ecuador: el asistente
responde sobre horarios, precios, seguros y políticas de atención. El mismo código sirve
para cualquier negocio cambiando un archivo de texto.

> Proyecto educativo y de portafolio. La clínica y toda su información son inventadas.

## Por qué RAG y no un modelo afinado

Un LLM base no conoce los precios de una clínica de Cuenca, y preguntárselo produce
respuestas inventadas con total seguridad. Hay dos formas de darle ese conocimiento:

- **Fine-tuning:** reentrenar el modelo con los datos. Caro, lento, y hay que repetirlo
  cada vez que cambia un precio.
- **RAG:** dejar el modelo intacto y, en cada consulta, buscar los fragmentos relevantes
  del documento e inyectarlos en el prompt. Actualizar la información es reeditar un
  archivo de texto y volver a correr la ingesta.

Para conocimiento que cambia (precios, horarios, inventario), RAG es casi siempre la
respuesta correcta. El fine-tuning sirve para enseñar *formato* o *estilo*, no *hechos*.

## Arquitectura

```mermaid
flowchart TD
    subgraph ingesta["Ingesta (una vez, offline)"]
        A[Documento markdown] --> B[Chunking por secciones]
        B --> C[OpenAI Embeddings]
        C --> D[(Postgres + pgvector)]
    end

    subgraph consulta["Consulta (en cada pregunta)"]
        E[Pregunta del usuario] --> F[Embedding de la pregunta]
        F --> G[Búsqueda por similitud coseno]
        G --> H[Top 3 fragmentos]
        H --> I[Prompt aumentado]
        I --> J[LLM con streaming]
        J --> K[Respuesta + fuentes citadas]
    end

    D -.-> G
```

La idea central: tanto el documento como la pregunta se convierten en vectores en el
mismo espacio semántico. Buscar información se vuelve un problema geométrico — encontrar
los puntos más cercanos — lo que permite que *"¿cuánto sale una limpieza?"* recupere un
fragmento que dice *"Profilaxis (limpieza dental): 35 dólares"* sin compartir casi ninguna
palabra.

## Stack y decisiones

| Pieza | Elección | Por qué |
|---|---|---|
| Framework | Next.js 16 (App Router) | Los route handlers corren solo en servidor: las API keys nunca llegan al navegador |
| Base vectorial | Postgres + pgvector (Neon) | Un solo servicio en lugar de una base vectorial aparte; SQL normal y portable |
| Driver | `@neondatabase/serverless` | Habla por HTTP, sin conexión persistente: encaja con funciones serverless |
| Embeddings | `text-embedding-3-small` | 1536 dimensiones, 0,02 USD por millón de tokens; indexar este documento cuesta centésimas de centavo |
| LLM | `gpt-4o-mini` | Suficiente para responder con contexto dado; el trabajo difícil lo hace la recuperación |
| Streaming | Vercel AI SDK | Estandariza Server-Sent Events y estado del chat en cliente y servidor |

**Sobre no usar Pinecone o Weaviate:** a esta escala serían sobre-ingeniería. Una base
vectorial dedicada se justifica con millones de vectores o requisitos estrictos de
latencia; aquí solo añadiría un servicio más que administrar. pgvector escala bien hasta
cientos de miles de vectores con un índice HNSW.

## Las decisiones que más afectan la calidad

Tres detalles marcan la diferencia entre un RAG que funciona y uno que alucina:

**1. Chunking por secciones, no por cantidad fija de caracteres.** El documento se parte
en los encabezados `##` y `###`, respetando las fronteras semánticas que el autor ya
marcó. Cortar cada 1000 caracteres a ciegas parte ideas por la mitad y produce fragmentos
que no responden nada completo.

**2. Breadcrumb en cada fragmento.** Cada chunk se guarda precedido de su ruta de
secciones (`Precios de servicios > Endodoncia y cirugía`). Sin eso, el fragmento
*"Endodoncia en molar: 280 dólares"* embebido por sí solo no se parece mucho a la
pregunta *"¿cuánto cuesta un tratamiento de conducto?"*; el título aporta el vocabulario
que conecta ambos.

**3. Umbral de similitud.** La búsqueda vectorial *siempre* devuelve los N más cercanos,
aunque la pregunta no tenga nada que ver: preguntar por el clima devolvería igualmente
tres fragmentos sobre odontología. Descartar los que están por debajo de 0.3 de similitud
es lo que permite responder *"no tengo esa información"* en vez de improvisar sobre
contexto irrelevante.

A eso se suma un system prompt que prohíbe explícitamente responder fuera del contexto y
que redirige al WhatsApp de la clínica cuando no hay información — porque en un dominio
donde el usuario podría actuar según el dato, una respuesta plausible y falsa es peor que
un "no sé".

## Estructura

```
data/clinica-sonrisa-andina.md   Base de conocimiento (editable)
db/schema.sql                    Tabla documents + función match_documents + índice HNSW
scripts/ingest.ts                Chunking, embeddings y carga a Postgres
src/lib/db.ts                    Conexión perezosa a Neon
src/lib/retrieval.ts             Embedding de la consulta y búsqueda por similitud
src/app/api/chat/route.ts        Endpoint RAG con streaming
src/components/Chat.tsx          UI de chat con fuentes citadas
```

## Cómo ejecutarlo

**Requisitos:** Node 20+, una base Postgres con pgvector ([Neon](https://neon.tech) tiene
plan gratuito) y una API key de [OpenAI](https://platform.openai.com/api-keys).

```bash
git clone https://github.com/marcocjmr/rag-business-assistant.git
cd rag-business-assistant
npm install
```

Crea el archivo `.env.local` en la raíz (ver `.env.example`):

```
DATABASE_URL=postgresql://usuario:password@host.neon.tech/neondb?sslmode=require
OPENAI_API_KEY=sk-...
```

Ejecuta el contenido de `db/schema.sql` en tu base, y luego:

```bash
npm run ingest -- --dry-run   # inspecciona los chunks sin gastar en embeddings
npm run ingest                # genera embeddings y los guarda
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000).

## Adaptarlo a otro negocio

Reemplaza `data/clinica-sonrisa-andina.md` por la documentación de tu negocio
(manteniendo encabezados `##`), ajusta la constante `SOURCE_FILE` en `scripts/ingest.ts`,
edita el system prompt en `src/app/api/chat/route.ts` y vuelve a correr la ingesta.

## Limitaciones conocidas

Cosas que este demo deliberadamente no resuelve, y que serían los siguientes pasos en un
sistema real:

- **Preguntas de seguimiento.** Solo se embebe el último mensaje, así que *"¿y eso lo
  cubre el seguro?"* pierde el referente. La solución habitual es reescribir la consulta
  con el historial antes de buscar.
- **Búsqueda puramente semántica.** La búsqueda híbrida (vectorial + full-text) recupera
  mejor los términos exactos, como nombres propios o códigos.
- **Sin reranking.** Un modelo de reordenamiento sobre los ~20 candidatos más cercanos
  mejora bastante la precisión del top 3.
- **Sin evaluación automática.** Un conjunto de preguntas con respuestas esperadas
  permitiría medir si un cambio de chunking o de umbral mejora o empeora el sistema, en
  lugar de juzgarlo a ojo.
- **Sin rate limiting ni autenticación** en el endpoint, necesarios antes de exponerlo
  públicamente.
