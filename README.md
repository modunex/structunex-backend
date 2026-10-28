# Structunex Backend

Express + PostgreSQL (Prisma) API for the AI structural design MVP.
Node orchestrates and stores data; the Python `calc-service` does the actual solving,
and the heavy results live in S3 as Parquet.

## Requirements

- Node.js 22
- PostgreSQL 14+ (local Docker, or Render Postgres)

## Setup (local)

```bash
# 1. Postgres local
docker run -d --name structunex-pg -e POSTGRES_PASSWORD=dev -p 5432:5432 postgres:17

# 2. Dependencias (postinstall ejecuta `prisma generate`)
npm install

# 3. Variables: DATABASE_URL apunta al contenedor de arriba
cp .env.example .env   # then edit values if needed

# 4. Crear las tablas
npm run db:deploy      # aplica prisma/migrations

# 5. Arrancar
npm run dev            # http://localhost:4000
```

Useful commands:

| Command              | What it does                                                   |
| -------------------- | -------------------------------------------------------------- |
| `npm run db:migrate` | After editing `prisma/schema.prisma`: creates a new migration and applies it locally |
| `npm run db:deploy`  | Applies pending migrations (what Render runs before each deploy) |
| `npm run db:studio`  | Opens Prisma Studio to browse the tables                       |
| `npm test`           | Unit tests (load combos, spectra)                              |

## Environment (.env)

| Variable                     | Default                    | Description                                  |
| ---------------------------- | -------------------------- | -------------------------------------------- |
| PORT                         | 4000                       | API port                                     |
| DATABASE_URL                 | —                          | PostgreSQL connection string                 |
| DATABASE_POOL_MAX            | 5                          | Max connections in the pool                  |
| CALC_SERVICE_URL             | http://localhost:8000      | Python solver microservice                   |
| CALC_SERVICE_HOSTPORT        | —                          | `host:port` of the calc-service (set by Render); used if CALC_SERVICE_URL is absent |
| CLIENT_ORIGIN                | https://app.structunex.com | Frontend origin(s) for CORS, comma-separated |
| CLERK_PUBLISHABLE_KEY        | pk_test_...                | Clerk publishable key                        |
| CLERK_SECRET_KEY             | sk_test_...                | Clerk secret key (backend auth)              |
| CLERK_WEBHOOK_SIGNING_SECRET | whsec_...                  | Verifies `/api/webhooks/clerk`               |
| MAILCHIMP_API_KEY / MAILCHIMP_AUDIENCE_ID | —             | Syncs new users to Mailchimp                 |
| AWS_REGION / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_S3_BUCKET | — | Analysis results bucket |

> Clerk keys are written to `.env.local` by `clerk init` (git-ignored). The
> table above documents them; do not commit real values.

## Authentication

All `/api/projects` and catalog routes require a valid Clerk session. The client must
send the Clerk session token on every request:

```
Authorization: Bearer <clerk-session-token>
```

`GET /api/health` stays public. The owner (`ownerId`) is taken from the authenticated
Clerk user — it is **not** sent in the request body — and each user can only access
their own projects and catalogs. The `users` table mirrors Clerk through the
`/api/webhooks/clerk` webhook.

## API

Every row is exposed with an `_id` (a UUID). The structural model can be saved whole
(`PUT /api/projects/:id/model`, used by the frontend autosave) or per entity.

**Projects**

| Method | Route              | Description                              |
| ------ | ------------------ | ---------------------------------------- |
| GET    | /api/health        | Health check (public)                    |
| GET    | /api/projects      | List the caller's projects (metadata)    |
| POST   | /api/projects      | Create a project                         |
| GET    | /api/projects/:id  | Get project metadata                     |
| PATCH  | /api/projects/:id  | Update project metadata                  |
| DELETE | /api/projects/:id  | Delete project + everything it owns      |

**Model**

| Method | Route                       | Description                                        |
| ------ | --------------------------- | -------------------------------------------------- |
| GET    | /api/projects/:id/model     | Whole model + configuration                        |
| PUT    | /api/projects/:id/model     | Replace the collections present in the body (one transaction) |

Per-entity CRUD (`GET`/`POST` on the collection, `GET`/`PATCH`/`DELETE` on
`/:entityId`) for `nodes | elements | supports | loads | areas`.

**Catalogs** (per user): `/api/materials`, `/api/sections`, `/api/area-sections`.

**Analysis / Design**

| Method | Route                                         | Description                      |
| ------ | --------------------------------------------- | -------------------------------- |
| GET    | /api/projects/:id/analysis                    | Status + progress + last run     |
| POST   | /api/projects/:id/analysis                    | Launch the solver (202)          |
| DELETE | /api/projects/:id/analysis                    | Cancel                           |
| GET    | /api/projects/:id/analysis/runs               | Run history                      |
| GET    | /api/projects/:id/analysis/runs/:runId/urls   | Presigned URLs of one load case  |
| …      | /api/projects/:id/design…                     | Same shape for code checking     |

## Data model

The schema lives in `prisma/schema.prisma`; migrations in `prisma/migrations/`.

| Table                         | Holds                                   | Key constraint                        |
| ----------------------------- | --------------------------------------- | ------------------------------------- |
| `users`                       | Clerk mirror                            | `clerkId` unique                      |
| `catalog_materials`           | User materials                          | index `(ownerId, createdAt)`          |
| `catalog_frame_sections`      | User frame sections                     | FK material (`RESTRICT`)              |
| `catalog_area_sections`       | User shell sections                     | FK material (`RESTRICT`)              |
| `projects`                    | Project metadata + job progress         | index `(ownerId, createdAt)`          |
| `model_configuration`         | Grid, load patterns, combos, spectra… (JSONB) | PK = `projectId`                |
| `model_nodes`, `model_elements`, `model_areas` | Geometry                | `(projectId, id)` unique              |
| `model_supports`              | Restraints                              | `(projectId, nodeId)` unique          |
| `model_loads`, `model_frame_loads`, `model_area_loads` | Loads           | index `(projectId, seq)`              |
| `model_area_springs`          | Subgrade springs                        | `(projectId, areaId)` unique          |
| `analysis_runs`, `design_runs`| Run metadata (results are in S3)        | index `(projectId, startedAt)`        |

Notes:

- Every table hangs from `projects` with `ON DELETE CASCADE`: deleting a project
  removes its model, configuration and runs in one statement.
- Model tables have a `pk` (exposed as `_id`) because `id` is the domain id (`"N1"`),
  plus a `seq` column: reads are ordered by it so the model comes back in the order it
  was saved.
- Elements/areas reference catalog sections with `ON DELETE SET NULL`; deleting a
  material still used by a section is refused (409).

## Structure

```
prisma/
├── schema.prisma     # tables, relations, indexes
└── migrations/       # SQL history applied by `prisma migrate deploy`
src/
├── index.js          # entry point (connects DB, starts server)
├── app.js            # Express config (middlewares, routes, CORS)
├── config/           # env + Prisma client
├── models/           # CHILD_MODELS: the model tables iterated by the services
├── lib/ids.js        # UUID validation + row -> API shape (`_id`, no nulls)
├── schemas/          # Zod validation (per-entity)
├── controllers/      # thin per-resource handlers + crudFactory
├── services/         # business logic, jobs, S3, calc-service client
├── routes/           # one router per resource, nested under projects
└── middleware/       # auth (Clerk) + loadProject + validate + errorHandler
```

## Data flow

```
routes -> requireAuth -> loadProject -> validate (Zod) -> controller -> service -> (PostgreSQL | S3 | Python calc-service)
```

## Deploy (Render)

`render.yaml` is a Render Blueprint with the database, this API, the calc-service
(private service) and the frontend (static site). Render runs
`npx prisma migrate deploy` before each deploy of the API.

> Prisma downloads its migration engine from `binaries.prisma.sh` the first time a
> `prisma` command runs. If a corporate network blocks that host, `npm install`
> fails at `prisma generate`; run it from another network or ask IT to allow it.
> Render has no such restriction.
