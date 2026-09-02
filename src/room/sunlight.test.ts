import { describe, expect, it } from "vitest";
import {
  calculateSolarPositionAtUtc,
  deriveSunBeams,
  deriveSunDirection,
  validateSunStudyScenario,
  type SunStudyScenario,
} from "./sunlight";

const makeScenario = (
  overrides: Partial<SunStudyScenario> = {},
): SunStudyScenario => ({
  latitude: 40.71,
  longitude: -74.01,
  date: "2026-09-01",
  localTime: "12:00",
  timeZone: "America/New_York",
  planNorthAzimuthDeg: 0,
  ...overrides,
});

describe("calculateSolarPositionAtUtc", () => {
  it.each([
    {
      date: "2017-08-21T18:25:00.000Z",
      latitude: 36.8656,
      longitude: -87.4886,
      expected: { azimuth: 198.10581, altitude: 63.980867 },
    },
    {
      date: "2026-09-01T16:00:00.000Z",
      latitude: 40.7128,
      longitude: -74.006,
      expected: { azimuth: 155.265528, altitude: 55.096072 },
    },
  ])("matches the reviewed geometric USNO fixture: $date", (fixture) => {
    const position = calculateSolarPositionAtUtc(
      new Date(fixture.date),
      fixture.latitude,
      fixture.longitude,
    );

    expect(position.azimuthDeg).toBeCloseTo(fixture.expected.azimuth, 2);
    expect(position.geometricAltitudeDeg).toBeCloseTo(
      fixture.expected.altitude,
      2,
    );
    expect(position.apparentAltitudeDeg).toBeGreaterThan(
      position.geometricAltitudeDeg,
    );
  });
});

describe("validateSunStudyScenario", () => {
  it("normalizes accepted coarse input and resolves its UTC instant", () => {
    const result = validateSunStudyScenario(
      makeScenario({ localTime: "12:00", timeZone: "America/New_York" }),
    );

    expect(result).toMatchObject({ valid: true });
    if (!result.valid) throw new Error("Expected a valid sun scenario");
    expect(result.value).toMatchObject({
      latitude: 40.71,
      longitude: -74.01,
      planNorthAzimuthDeg: 0,
      utcDate: "2026-09-01T16:00:00.000Z",
    });
  });

  it.each([
    ["latitude", { latitude: 90.01 }],
    ["longitude", { longitude: 180.01 }],
    ["coarse latitude", { latitude: 40.711 }],
    ["date", { date: "2026-02-30" }],
    ["time", { localTime: "25:00" }],
    ["timezone", { timeZone: "Not/A-Timezone" }],
    ["Plan North", { planNorthAzimuthDeg: 360 }],
  ] as const)("rejects invalid %s input", (_label, overrides) => {
    const result = validateSunStudyScenario(makeScenario(overrides));
    expect(result.valid).toBe(false);
  });
});

describe("deriveSunDirection", () => {
  it("converts true-north azimuth into Wimy Plan North scene axes", () => {
    const direction = deriveSunDirection({
      azimuthDeg: 90,
      geometricAltitudeDeg: 45,
      apparentAltitudeDeg: 45,
      utcDate: "2026-09-01T16:00:00.000Z",
    }, 90);

    expect(direction.isAboveHorizon).toBe(true);
    expect(direction.toward[0]).toBeCloseTo(0, 9);
    expect(direction.toward[1]).toBeCloseTo(Math.SQRT1_2, 9);
    expect(direction.toward[2]).toBeCloseTo(-Math.SQRT1_2, 9);
    expect(direction.lightPosition[0]).toBeCloseTo(0, 9);
    expect(direction.lightPosition[1]).toBeCloseTo(Math.SQRT1_2 * 10, 9);
    expect(direction.lightPosition[2]).toBeCloseTo(-Math.SQRT1_2 * 10, 9);
  });

  it("disables direct light at or below the horizon", () => {
    expect(
      deriveSunDirection(
        {
          azimuthDeg: 180,
          geometricAltitudeDeg: -1,
          apparentAltitudeDeg: -0.1,
          utcDate: "2026-09-01T04:00:00.000Z",
        },
        0,
      ),
    ).toMatchObject({ isAboveHorizon: false, toward: [0, 0, 0] });
  });
});

describe("deriveSunBeams", () => {
  const westWindow = {
    id: "window-west",
    kind: "window" as const,
    wall: "west" as const,
    position: [0.05, 1.5, 1.5] as [number, number, number],
    size: [0.02, 1, 1.2] as [number, number, number],
  };

  it("projects a bounded beam inward from a sun-facing window", () => {
    const beams = deriveSunBeams(
      [4, 2.7, 3],
      [westWindow],
      {
        isAboveHorizon: true,
        toward: [-Math.SQRT1_2, Math.SQRT1_2, 0],
        lightPosition: [-7.071, 7.071, 0],
      },
    );

    expect(beams).toHaveLength(1);
    expect(beams[0]).toMatchObject({
      openingId: "window-west",
      direction: [Math.SQRT1_2, -Math.SQRT1_2, -0],
      aperture: [1.2, 1],
    });
    expect(beams[0]?.length).toBeGreaterThan(1);
    expect(beams[0]?.length).toBeLessThan(3);
  });

  it("does not invent a beam for a window facing away from the sun", () => {
    expect(
      deriveSunBeams(
        [4, 2.7, 3],
        [westWindow],
        {
          isAboveHorizon: true,
          toward: [Math.SQRT1_2, Math.SQRT1_2, 0],
          lightPosition: [7.071, 7.071, 0],
        },
      ),
    ).toEqual([]);
  });
});
