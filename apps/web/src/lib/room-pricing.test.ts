import { describe, expect, it } from "vitest";

import { roomHirePence, standardHireSentence, type RoomPricingFields } from "./room-pricing";

// The Main Function Room, exactly as prod holds it.
const mainRoom: RoomPricingFields = {
  standard_price_pence: 15000,
  standard_hours: 4.5,
  extra_hour_pence: 2500,
  price_pence_per_hour: null,
  price_pence_half_day: null,
  price_pence_full_day: null,
};

describe("the standard hire rule (Adam: £150 for 4.5 hours, £25 per half hour after)", () => {
  it("charges £150 for the standard window and anything shorter", () => {
    expect(roomHirePence(mainRoom, "19:00", "23:30")).toBe(15000);
    expect(roomHirePence(mainRoom, "19:00", "22:00")).toBe(15000);
  });

  it("one minute over triggers the next £25 half hour", () => {
    expect(roomHirePence(mainRoom, "19:00", "23:31")).toBe(17500);
    expect(roomHirePence(mainRoom, "19:00", "23:59")).toBe(17500);
  });

  it("each started half hour adds £25", () => {
    expect(roomHirePence(mainRoom, "18:00", "23:00")).toBe(17500); // 5h = 1 extra half
    expect(roomHirePence(mainRoom, "18:00", "23:30")).toBe(20000); // 5.5h = 2
    expect(roomHirePence(mainRoom, "18:00", "23:31")).toBe(22500); // 5h31 = 3
  });

  it("refuses a backwards window", () => {
    expect(roomHirePence(mainRoom, "23:00", "19:00")).toBeNull();
  });

  it("says the rule on the card the way the club says it", () => {
    expect(standardHireSentence(mainRoom)).toBe(
      "£150 for up to 4½ hours, then £25 for each additional half hour (any part of one counts).",
    );
  });
});

describe("the per-hour fallback tiers", () => {
  const hourly: RoomPricingFields = {
    standard_price_pence: null,
    standard_hours: null,
    extra_hour_pence: null,
    price_pence_per_hour: 2000,
    price_pence_half_day: 6000,
    price_pence_full_day: 10000,
  };

  it("still prices a room set up the old way", () => {
    expect(roomHirePence(hourly, "19:00", "21:00")).toBe(4000);
    expect(roomHirePence(hourly, "12:00", "16:00")).toBe(6000);
    expect(roomHirePence(hourly, "10:00", "18:00")).toBe(10000);
    expect(standardHireSentence(hourly)).toBeNull();
  });
});
