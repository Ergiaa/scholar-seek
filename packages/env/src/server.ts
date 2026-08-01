import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
	server: {
		DATABASE_URL: z.string().min(1),
		REDIS_URL: z.string().min(1),
		CORS_ORIGIN: z.url(),
		NODE_ENV: z
			.enum(["development", "production", "test"])
			.default("development"),
		BETTER_AUTH_SECRET: z.string().min(1),
		BETTER_AUTH_URL: z.url(),
		// Seeded on boot as the sole initial account — public sign-up is
		// disabled, so this is the only way to bootstrap access.
		ROOT_ADMIN_EMAIL: z.string().email(),
		ROOT_ADMIN_PASSWORD: z.string().min(8),
		ROOT_ADMIN_NAME: z.string().min(1).default("Root Admin"),
		// Optional — Semantic Scholar crawls work unauthenticated (shared
		// public rate-limit pool) but a free key gives a dedicated 1 req/s.
		S2_API_KEY: z.string().min(1).optional(),
		// Optional — ML service base URL for semantic/hybrid search
		ML_SERVICE_URL: z.string().url().optional().default("http://localhost:8000"),
		// Optional — shared secret for ML service internal endpoints
		ML_RELOAD_TOKEN: z.string().min(1).optional(),
	},
	runtimeEnv: process.env,
	emptyStringAsUndefined: true,
});
