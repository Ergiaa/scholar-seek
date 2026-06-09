// server entry point
import path from "node:path";
import fs from "node:fs";
import { staticPlugin } from "@elysia/static";
import { cors } from "@elysiajs/cors";
import { Elysia } from "elysia";
import { crawlerModule } from "./modules/crawler";
import {
	cleanupStuckJobs,
	startCrawlWorker,
	stopCrawlWorker,
} from "./modules/crawler/queue";
import { papersModule } from "./modules/papers";

let frontendAssetsPath = path.resolve(process.cwd(), "apps/web/dist");
let frontendIndexPath = path.resolve(process.cwd(), "apps/web/dist/index.html");
const clientIndexPath = path.resolve(process.cwd(), "apps/web/dist/client/index.html");

if (fs.existsSync(clientIndexPath)) {
    frontendAssetsPath = path.resolve(process.cwd(), "apps/web/dist/client");
    frontendIndexPath = clientIndexPath;
    console.log("✅ Web UI otomatis terdeteksi di /dist/client");
} else if (fs.existsSync(frontendIndexPath)) {
    console.log("✅ Web UI otomatis terdeteksi di /dist");
} else {
    console.error("❌ index.html gagal ditemukan! Mencetak isi folder dist:");
    try {
        console.error(fs.readdirSync(path.resolve(process.cwd(), "apps/web/dist")));
    } catch (err) {
        console.error("Folder dist tidak dapat dibaca atau tidak ada!");
    }
}

const app = new Elysia()
	.onError(({ code, error, set }) => {
		if (code === "VALIDATION") {
			set.status = 400;
			return { error: error.message };
		}
		console.error(error);
		set.status = 500;
		return { error: "Internal Server Error" };
	})
	.use(cors())
	.use(staticPlugin({ assets: frontendAssetsPath, prefix: "/" }))
	.use(crawlerModule)
	.use(papersModule)
	.get("/*", () => {
		return Bun.file(frontendIndexPath);
	});

const PORT = Number(process.env.PORT) || 3000;
app.listen({ port: PORT, hostname: "0.0.0.0" }, (server) => {
	console.log(`Server running at http://${server?.hostname}:${server?.port}`);
});
startCrawlWorker();

process.on("SIGINT", async () => {
	console.log("Shutting down gracefully...");
	await stopCrawlWorker();
	await cleanupStuckJobs();
	await app.stop();
	process.exit(0);
});
