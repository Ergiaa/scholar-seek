import { beforeEach, describe, expect, it } from "vitest";
import {
	clearSearchState,
	getSearchState,
	saveSearchState,
} from "./search-state";

beforeEach(() => {
	sessionStorage.clear();
});

describe("search-state", () => {
	it("returns null when nothing has been saved", () => {
		expect(getSearchState()).toBeNull();
	});

	it("round-trips a saved state through sessionStorage", () => {
		const state = {
			page: 2,
			pageSize: 20,
			q: "neural nets",
			url: "/search?q=neural",
		};
		saveSearchState(state);
		expect(getSearchState()).toEqual(state);
	});

	it("returns null for malformed stored JSON instead of throwing", () => {
		sessionStorage.setItem("lastSearchState", "{not valid json");
		expect(getSearchState()).toBeNull();
	});

	it("clears the saved state", () => {
		saveSearchState({ page: 1, pageSize: 10, q: "", url: "/search" });
		clearSearchState();
		expect(getSearchState()).toBeNull();
	});
});
