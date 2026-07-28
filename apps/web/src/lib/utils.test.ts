import { describe, expect, it } from "vitest";
import { formatDate, normalizeToArray } from "./utils";

describe("normalizeToArray", () => {
	it("returns undefined for undefined", () => {
		expect(normalizeToArray(undefined)).toBeUndefined();
	});

	it("wraps a single string in an array", () => {
		expect(normalizeToArray("a")).toEqual(["a"]);
	});

	it("passes arrays through unchanged", () => {
		expect(normalizeToArray(["a", "b"])).toEqual(["a", "b"]);
	});
});

describe("formatDate", () => {
	it("formats a valid ISO date string", () => {
		expect(formatDate("2020-05-01T00:00:00.000Z")).toBe("May 1, 2020");
	});

	it("falls back to the raw string for an invalid date", () => {
		// Intl.DateTimeFormat.format on an Invalid Date throws a RangeError,
		// which the try/catch turns into a pass-through of the raw input.
		expect(formatDate("not-a-date")).toBe("not-a-date");
	});
});
