import { env } from "@scholar-seek/env/server";
import Redis from "ioredis";

let client: Redis | null = null;

export function getRedis(): Redis | null {
	if (!client) {
		try {
			client = new Redis(env.REDIS_URL, {
				maxRetriesPerRequest: 0,
				lazyConnect: true,
				tls: {},
				enableOfflineQueue: false,
			});
			client.on("error", (err) => {
				console.error("[redis] connection error:", err.message);
			});
		} catch (e) {
			return null;
		}
	}
	return client;
}
