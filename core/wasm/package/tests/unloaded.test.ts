// the module is never loaded in this file, so every call must say what to do.

import assert from "node:assert/strict";
import { test } from "node:test";
import { Follower, ScoringError, follow, scorePassage } from "../src/index.ts";

const says = (e: unknown): boolean => e instanceof ScoringError && /init/.test(e.message);

test("using the engine before loading it says what to do", () => {
  assert.throws(() => follow([], []), says);
  assert.throws(() => scorePassage([], []), says);
  assert.throws(() => new Follower([]), says);
});
