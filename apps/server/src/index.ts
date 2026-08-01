import { cors } from "@elysiajs/cors";
import { env } from "@scholar-seek/env/server";
import { Elysia } from "elysia";
import { auth, ensureRootAdmin } from "./lib/auth";
import { crawlerModule } from "./modules/crawler";
import {
	cleanupStuckJobs,
	startCrawlWorker,
	stopCrawlWorker,
} from "./modules/crawler/queue";
import { ensureDefaultSchedules } from "./modules/crawler/schedule-service";
import { papersModule } from "./modules/papers";

const app = new Elysia()
	.onError(({ code, error, set }) => {
		if (code === "VALIDATION") {
			set.status = 400;
			return { error: error.message };
		}
		if (code === "NOT_FOUND") {
			set.status = 404;
			return { error: "Not found" };
		}
		set.status = 500;
		return { error: "Internal server error" };
	})
	.use(
		cors({
			origin: env.CORS_ORIGIN,
			methods: ["GET", "POST", "OPTIONS"],
			credentials: true,
		})
	)
	.all("/api/auth/*", ({ request, status }) => {
		if (request.method === "GET" || request.method === "POST") {
			return auth.handler(request);
		}
		return status(405);
	})
	.use(papersModule)
	.use(crawlerModule)
	.get("/", () => "OK", {
		detail: {
			summary: "Health check",
			tags: ["health"],
		},
	});

app.listen(3000, () => {
	console.log(
		`🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
	);
	ensureRootAdmin()
		.then(() => ensureDefaultSchedules())
		.catch((err) => console.error("[auth] boot seeding failed:", err.message));
	cleanupStuckJobs()
		.catch((err) => console.warn("[crawler] cleanup skipped:", err.message))
		.then(() => startCrawlWorker());
});

async function shutdown() {
	console.log("[server] shutting down...");
	await stopCrawlWorker();
	app.stop();
	process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

export type App = typeof app;
