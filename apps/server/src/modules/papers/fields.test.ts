import { describe, expect, it } from "bun:test";
import { fieldCondition, isFieldOfStudy } from "./fields";

describe("isFieldOfStudy", () => {
	it("returns true for a canonical field name", () => {
		expect(isFieldOfStudy("Computer Science")).toBe(true);
	});

	it("returns false for an arbitrary string", () => {
		expect(isFieldOfStudy("Not A Field")).toBe(false);
	});
});

describe("fieldCondition", () => {
	it("returns a defined SQL condition for a field with arXiv prefixes", () => {
		expect(fieldCondition("Physics")).toBeDefined();
	});

	it("returns a defined SQL condition for a field without arXiv prefixes", () => {
		expect(fieldCondition("Art")).toBeDefined();
	});
});
