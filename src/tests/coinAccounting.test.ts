import assert from "node:assert/strict";
import {
  effectiveTimezone,
  fromCoinUnits,
  getEndOfNextLocalMonth,
  getLocalDate,
  getNextLocalMidnight,
  isCoinExpirySoon,
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

const septemberExpiry = getEndOfNextLocalMonth(
  new Date("2026-09-30T15:59:59Z"), "Asia/Taipei",
);
assert.equal(septemberExpiry.toISOString(), "2026-10-31T16:00:00.000Z");
assert.equal(isCoinExpirySoon(new Date("2026-10-24T15:59:59Z"), septemberExpiry, "Asia/Taipei"), false);
assert.equal(isCoinExpirySoon(new Date("2026-10-24T16:00:00Z"), septemberExpiry, "Asia/Taipei"), true);
assert.equal(isCoinExpirySoon(new Date("2026-10-31T15:59:59Z"), septemberExpiry, "Asia/Taipei"), true);
assert.equal(isCoinExpirySoon(septemberExpiry, septemberExpiry, "Asia/Taipei"), false);
// January rewards expire March 1, including leap-year February.
const leapExpiry = getEndOfNextLocalMonth(new Date("2028-01-15T12:00:00Z"), "Asia/Taipei");
assert.equal(leapExpiry.toISOString(), "2028-02-29T16:00:00.000Z");
assert.equal(isCoinExpirySoon(new Date("2028-02-22T15:59:59Z"), leapExpiry, "Asia/Taipei"), false);
assert.equal(isCoinExpirySoon(new Date("2028-02-22T16:00:00Z"), leapExpiry, "Asia/Taipei"), true);
// October rewards expire December 1; test across the New York DST transition.
assert.equal(getEndOfNextLocalMonth(new Date("2026-10-15T12:00:00Z"), "America/New_York").toISOString(), "2026-12-01T05:00:00.000Z");
assert.equal(getEndOfNextLocalMonth(new Date("2026-12-15T12:00:00Z"), "Asia/Taipei").toISOString(), "2027-01-31T16:00:00.000Z");

console.log("coin-accounting unit tests passed");
