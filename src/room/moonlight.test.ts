import { describe, expect, it } from "vitest";
import {
  calculateLunarIlluminationAtUtc,
  calculateLunarPositionAtUtc,
  deriveMoonDirection,
} from "./moonlight";

describe("calculateLunarIlluminationAtUtc", () => {
  it.each([
    {
      instant: "2026-09-11T03:27:00.000Z",
      label: "New Moon",
      maximumFraction: 0.01,
    },
    {
      instant: "2026-09-26T16:49:00.000Z",
      label: "Full Moon",
      minimumFraction: 0.99,
    },
  ])("matches the reviewed USNO primary phase at $instant", (fixture) => {
    const illumination = calculateLunarIlluminationAtUtc(new Date(fixture.instant));

    expect(illumination.phaseName).toBe(fixture.label);
    if (fixture.maximumFraction !== undefined) {
      expect(illumination.fraction).toBeLessThan(fixture.maximumFraction);
    }
    if (fixture.minimumFraction !== undefined) {
      expect(illumination.fraction).toBeGreaterThan(fixture.minimumFraction);
    }
  });
});

describe("calculateLunarPositionAtUtc", () => {
  it("returns a bounded topocentric direction for the room location and instant", () => {
    const position = calculateLunarPositionAtUtc(
      new Date("2026-09-26T23:00:00.000Z"),
      40.71,
      -74.01,
    );

    expect(position.azimuthDeg).toBeGreaterThanOrEqual(0);
    expect(position.azimuthDeg).toBeLessThan(360);
    expect(position.geometricAltitudeDeg).toBeGreaterThan(-90);
    expect(position.geometricAltitudeDeg).toBeLessThan(90);
    expect(position.apparentAltitudeDeg).toBeGreaterThanOrEqual(
      position.geometricAltitudeDeg,
    );
    expect(position.distanceKm).toBeGreaterThan(350_000);
    expect(position.distanceKm).toBeLessThan(410_000);
  });

  it("rejects invalid location input rather than inventing a moon", () => {
    expect(() =>
      calculateLunarPositionAtUtc(new Date("2026-09-26T23:00:00.000Z"), 91, 0),
    ).toThrow(/Latitude/u);
  });
});

describe("deriveMoonDirection", () => {
  it("uses the same true-bearing to Plan North projection as direct sunlight", () => {
    const direction = deriveMoonDirection(
      {
        azimuthDeg: 90,
        geometricAltitudeDeg: 30,
        apparentAltitudeDeg: 30,
        utcDate: "2026-09-26T23:00:00.000Z",
      },
      90,
    );

    expect(direction.isAboveHorizon).toBe(true);
    expect(direction.toward[0]).toBeCloseTo(0, 9);
    expect(direction.toward[1]).toBeCloseTo(0.5, 9);
    expect(direction.toward[2]).toBeCloseTo(-Math.sqrt(3) / 2, 9);
  });
});
