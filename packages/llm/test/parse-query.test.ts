import { describe, expect, it } from "vitest";
import { keepRequestedLevels } from "../src/parse-query";

describe("keepRequestedLevels", () => {
  it("drops levels the query didn't ask for", () => {
    expect(keepRequestedLevels("staff software engineer in NYC", ["staff", "sr"])).toEqual(["staff"]);
    expect(keepRequestedLevels("Sr. backend engineer", ["senior", "sr"])).toEqual(["senior", "sr"]);
    expect(keepRequestedLevels("senior staff engineer", ["senior staff", "staff"])).toEqual(["senior staff", "staff"]);
    expect(keepRequestedLevels("backend engineer", ["senior"])).toEqual([]);
  });
  it("keeps unknown level words", () => {
    expect(keepRequestedLevels("L6 engineer", ["l6"])).toEqual(["l6"]);
  });
});
