# scholar-seek

A full-stack academic paper discovery platform. It crawls ArXiv via OAI-PMH, indexes papers into PostgreSQL, and exposes a search interface with filtering by author, journal, keyword, and date range — with LaTeX math rendering in abstracts.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TanStack Router, TailwindCSS v4, shadcn/ui |
| Backend | Elysia (Bun), Eden Treaty (type-safe client) |
| Database | PostgreSQL, Drizzle ORM |
| Queue | BullMQ + Redis |
| Monorepo | Turborepo, Bun workspaces |
| Tooling | Biome, Ultracite, TypeScript |

## File Structure

```
scholar-seek/
├── apps/
│   ├── web/                    # React + TanStack Router SPA
│   │   └── src/
│   │       ├── components/     # search UI, paper card, layout
│   │       ├── lib/            # API client, hooks, search state
│   │       ├── routes/         # /, /search, /paper/:id
│   │       └── types/
│   └── server/                 # Elysia API server (port 3000)
│       └── src/
│           ├── modules/
│           │   ├── papers/     # search, filter, facet endpoints
│           │   └── crawler/    # BullMQ queue + ArXiv OAI-PMH adapter
│           └── lib/            # Redis cache helpers
├── packages/
│   ├── db/                     # Drizzle schema, migrations, seed
│   │   └── docker-compose.yml  # Postgres + Redis containers
│   ├── ui/                     # Shared shadcn/ui primitives
│   ├── env/                    # Validated env vars (Zod)
│   └── config/                 # Shared tsconfig
└── turbo.json
```

## Quick Start

**Prerequisites:** Bun, Docker

1. Install dependencies:

```bash
bun install
```

2. Start Postgres and Redis:

```bash
bun run db:start
```

3. Copy and fill in environment variables:

```bash
cp apps/server/.env.example apps/server/.env
cp apps/web/.env.example apps/web/.env
cp packages/db/.env.example packages/db/.env
```

4. Push the schema:

```bash
bun run db:push
```

5. Start everything:

```bash
bun run dev
```

- Web: http://localhost:3001
- API: http://localhost:3000

## Scripts

| Command | Description |
|---|---|
| `bun run dev` | Start all apps in development mode |
| `bun run dev:web` | Start only the web app |
| `bun run dev:server` | Start only the API server |
| `bun run build` | Build all apps |
| `bun run check-types` | TypeScript type-check across all packages |
| `bun run check` | Lint and format check (Biome/Ultracite) |
| `bun run fix` | Auto-fix lint and formatting issues |
| `bun run db:start` | Start Postgres + Redis via Docker Compose |
| `bun run db:stop` | Stop Docker containers |
| `bun run db:push` | Push schema changes to the database |
| `bun run db:generate` | Generate Drizzle migration files |
| `bun run db:migrate` | Run pending migrations |
| `bun run db:seed` | Seed the database with sample data |
| `bun run db:studio` | Open Drizzle Studio |


