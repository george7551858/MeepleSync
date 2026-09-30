import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { commitmentInput, judge, sha256Hex } from "../src/shared/games/rps";

describe("judge", () => {
  const players = ["a", "b", "c"];

  it("is a draw when all three hands appear", () => {
    expect(judge(players, { a: "rock", b: "paper", c: "scissors" })).toEqual({ winners: [], draw: true });
  });

  it("is a draw when everyone shows the same hand", () => {
    expect(judge(players, { a: "rock", b: "rock", c: "rock" })).toEqual({ winners: [], draw: true });
  });

  it("awards everyone holding the winning hand", () => {
    expect(judge(players, { a: "rock", b: "scissors", c: "rock" })).toEqual({ winners: ["a", "c"], draw: false });
    expect(judge(players, { a: "paper", b: "scissors", c: "paper" })).toEqual({ winners: ["b"], draw: false });
  });

  it("treats players who did not choose as losers", () => {
    expect(judge(players, { a: "rock", b: "rock" })).toEqual({ winners: ["a", "b"], draw: false });
    expect(judge(players, {})).toEqual({ winners: [], draw: true });
  });
});

describe("commitment", () => {
  it("server (node:crypto) and client (WebCrypto) hashes agree", async () => {
    const input = commitmentInput("abcd2345", 2, "user-1", "paper", "00ff");
    expect(await sha256Hex(input)).toBe(createHash("sha256").update(input).digest("hex"));
  });
});
