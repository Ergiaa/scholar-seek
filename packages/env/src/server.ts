import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";
export const env = createEnv({
        server: {
                DATABASE_URL: z.string().min(1),
                REDIS_URL: z.string().min(1),
                CORS_ORIGIN: z.url(),
                PORT: z.coerce.number().default(3001),
                NODE_ENV: z
                        .enum(["development", "production", "test"])
                        .default("development"),
        },
        runtimeEnv: process.env,
        emptyStringAsUndefined: true,
});