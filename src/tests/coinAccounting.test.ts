import assert from "node:assert/strict";
import {
  effectiveTimezone,
  fromCoinUnits,
  getEndOfNextLocalMonth,
  getLocalDate,
  getNextLocalMidnight,
  toCoinUnits,
} from "../lib/coinAccounting";

assert.equal(effectiveTimezone(null), "Asia/Taipei");
assert.equal(effectiveTimezone("Not/A-Timezone"), "Asia/Taipei");
assert.equal(effectiveTimezone("America/New_York"), "America/New_York");
assert.equal(toCoinUnits(7.505), 751);
assert.equal(fromCoinUnits(751), "7.51");

const taipeiNow = new Date("2026-09-12T03:00:00.000Z");
assert.equal(getLocalDate(taipeiNow, "Asia/Taipei"), "2026-09-12");
assert.equal(
  getNextLocalMidnight(taipeiNow, "Asia/Taipei").toISOString(),
  "2026-09-12T16:00:00.000Z",
);
assert.equal(
  getEndOfNextLocalMonth(taipeiNow, "Asia/Taipei").toISOString(),
  "2026-10-31T16:00:00.000Z",
);

// DST begins in New York on 2026-03-08; consecutive local midnights are
// therefore represented by different UTC offsets.
assert.equal(
  getNextLocalMidnight(
    new Date("2026-03-08T04:00:00.000Z"),
    "America/New_York",
  ).toISOString(),
  "2026-03-08T05:00:00.000Z",
);
assert.equal(
  getNextLocalMidnight(
    new Date("2026-03-08T10:00:00.000Z"),
    "America/New_York",
  ).toISOString(),
  "2026-03-09T04:00:00.000Z",
);

console.log("coin-accounting unit tests passed");
