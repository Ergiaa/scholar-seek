import { getRedis } from "./redis";

export async function cacheGet<T>(key: string): Promise<T | null> {
	const redis = getRedis();
	if (!redis) return null;
	const raw = await redis.get(key);
	if (!raw) return null;
	return JSON.parse(raw) as T;
}

export async function cacheSet<T>(
	key: string,
	value: T,
	ttlSeconds: number
): Promise<void> {
	const redis = getRedis();
	if (!redis) return;
	await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
}

export async function cacheDel(pattern: string): Promise<void> {
	const redis = getRedis();
	if (!redis) return;
	const keys = await redis.keys(pattern);
	if (keys.length > 0) {
		await redis.del(...keys);
	}
}
