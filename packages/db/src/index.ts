import { env } from "@scholar-seek/env/db";
import { drizzle } from "drizzle-orm/node-postgres";

// Schema import
import * as authSchema from "./schema/auth";
import { crawlHistory as crawlHistorySchema } from "./schema/crawl-history";
import { papers as papersSchema } from "./schema/papers";

const schema = { ...papersSchema, ...crawlHistorySchema, ...authSchema };

export const db = drizzle(env.DATABASE_URL, { schema });
