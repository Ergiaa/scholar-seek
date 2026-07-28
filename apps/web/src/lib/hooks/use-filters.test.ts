import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useFilters } from "./use-filters";

const navigate = vi.fn();

vi.mock("@tanstack/react-router", () => ({
	useRouter: () => ({ navigate }),
}));

beforeEach(() => {
	navigate.mockClear();
	window.history.replaceState({}, "", "/search");
});

describe("useFilters", () => {
	it("computes activeFilterCount from author, journal, keyword, and year filters", () => {
		const { result } = renderHook(() =>
			useFilters({
				author: "Ada Lovelace",
				journal: ["J1"],
				keyword: ["k1", "k2"],
				yearFrom: 2010,
				yearTo: 2020,
			})
		);

		expect(result.current.activeFilterCount).toBe(4);
	});

	it("reports zero active filters for an empty search", () => {
		const { result } = renderHook(() => useFilters({}));
		expect(result.current.activeFilterCount).toBe(0);
	});

	it("setAuthorFilter navigates with the new author and resets the page", () => {
		const { result } = renderHook(() => useFilters({ q: "test" }));

		result.current.setAuthorFilter("Grace Hopper");

		expect(navigate).toHaveBeenCalledWith({
			to: "/search",
			search: { q: "test", author: "Grace Hopper", page: 1 },
		});
	});

	it("setYearRange omits from/to when they equal the defaults", () => {
		const { result } = renderHook(() => useFilters({}));

		result.current.setYearRange(
			result.current.YEAR_MIN,
			result.current.YEAR_MAX
		);

		expect(navigate).toHaveBeenCalledWith({
			to: "/search",
			search: { yearFrom: undefined, yearTo: undefined, page: 1 },
		});
	});

	it("clearAllFilters keeps only q and resets the page", () => {
		const { result } = renderHook(() =>
			useFilters({ q: "test", author: "Ada", journal: ["J1"] })
		);

		result.current.clearAllFilters();

		expect(navigate).toHaveBeenCalledWith({
			to: "/search",
			search: { q: "test", page: 1 },
		});
	});
});
