import { env } from "@scholar-seek/env/server";
import { drizzle } from "drizzle-orm/node-postgres";

// biome-ignore lint/performance/noNamespaceImport: schema namespace needed for drizzle introspection
import * as schema from "./schema";

export const db = drizzle(env.DATABASE_URL, { schema });
