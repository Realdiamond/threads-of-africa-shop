import { describe, expect, it } from "vitest";

import { countrySearchScore } from "@/lib/countries";

const COUNTRIES: Array<[string, string]> = [
  ["NE", "Niger"],
  ["NG", "Nigeria"],
  ["NI", "Nicaragua"],
  ["GB", "United Kingdom"],
  ["SG", "Singapore"],
  ["CI", "Côte d’Ivoire"],
  ["GH", "Ghana"],
  ["TT", "Trinidad & Tobago"],
];

const search = (query: string) =>
  COUNTRIES.map(([code, name]) => ({ name, score: countrySearchScore(code, name, query) }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((c) => c.name);

describe("country search", () => {
  it("lists every country before anything is typed", () => {
    expect(search("")).toHaveLength(COUNTRIES.length);
  });

  it("matches the start of the name first and never fuzzy-matches", () => {
    expect(search("nig")).toEqual(["Niger", "Nigeria"]);
    expect(search("NIGERIA")).toEqual(["Nigeria"]);
  });

  it("finds a word inside the name, or the text anywhere", () => {
    expect(search("kingdom")).toEqual(["United Kingdom"]);
    expect(search("tobago")).toEqual(["Trinidad & Tobago"]);
    expect(search("hana")).toEqual(["Ghana"]);
  });

  it("matches an exact two-letter code", () => {
    expect(search("gb")).toEqual(["United Kingdom"]);
    expect(search("ng")).toEqual(["Nigeria"]);
  });

  it("ignores accents", () => {
    expect(search("cote")).toEqual(["Côte d’Ivoire"]);
  });

  it("shows nothing for a search that matches no country", () => {
    expect(search("zzzz")).toEqual([]);
  });
});
