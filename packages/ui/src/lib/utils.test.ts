import { describe, expect, it } from "bun:test";
import { cn } from "./utils";

describe("cn", () => {
	it("joins simple class names", () => {
		expect(cn("a", "b")).toBe("a b");
	});

	it("resolves conflicting Tailwind classes, keeping the last one", () => {
		expect(cn("p-2", "p-4")).toBe("p-4");
	});

	it("drops falsy values", () => {
		expect(cn("a", false, undefined, null, "b")).toBe("a b");
	});
});
