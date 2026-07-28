import { beforeEach, describe, expect, it, mock } from "bun:test";

const get = mock<(key: string) => Promise<string | null>>();
const set = mock<(...args: unknown[]) => Promise<string>>();
const keys = mock<(pattern: string) => Promise<string[]>>();
const del = mock<(...keys: string[]) => Promise<number>>();

mock.module("./redis", () => ({
	getRedis: () => ({ get, set, keys, del }),
}));

const { cacheDel, cacheGet, cacheSet } = await import("./cache");

beforeEach(() => {
	get.mockReset();
	set.mockReset();
	keys.mockReset();
	del.mockReset();
});

describe("cacheGet", () => {
	it("returns null when redis has no value", async () => {
		get.mockResolvedValueOnce(null);
		expect(await cacheGet("missing")).toBeNull();
	});

	it("parses and returns the stored JSON value", async () => {
		get.mockResolvedValueOnce(JSON.stringify({ a: 1 }));
		expect(await cacheGet<{ a: number }>("present")).toEqual({ a: 1 });
	});
});

describe("cacheSet", () => {
	it("serializes the value and sets it with an expiry", async () => {
		await cacheSet("key", { a: 1 }, 300);
		expect(set).toHaveBeenCalledWith(
			"key",
			JSON.stringify({ a: 1 }),
			"EX",
			300
		);
	});
});

describe("cacheDel", () => {
	it("deletes matching keys when the pattern matches something", async () => {
		keys.mockResolvedValueOnce(["a", "b"]);
		await cacheDel("papers:*");
		expect(del).toHaveBeenCalledWith("a", "b");
	});

	it("does not call del when no keys match", async () => {
		keys.mockResolvedValueOnce([]);
		await cacheDel("papers:*");
		expect(del).not.toHaveBeenCalled();
	});
});
