import { describe, expect, it } from "vitest";
import { projectFurnitureOrientation } from "./orientation";

describe("projectFurnitureOrientation", () => {
  it.each([
    [0, "north"],
    [90, "east"],
    [180, "south"],
    [270, "west"],
  ] as const)(
    "maps a sofa front at %i degrees to %s",
    (rotationDeg, direction) => {
      expect(
        projectFurnitureOrientation("sofa", rotationDeg),
      ).toMatchObject({
        cue: "facing",
        direction,
        label: `Facing ${direction}`,
        rotationDeg,
        directionVector: expect.any(Array),
      });
    },
  );

  it.each([
    [0, "south"],
    [90, "west"],
    [180, "north"],
    [270, "east"],
  ] as const)(
    "keeps a bed headboard at the opposite local edge for %i degrees",
    (rotationDeg, direction) => {
      expect(
        projectFurnitureOrientation("bed", rotationDeg),
      ).toMatchObject({
        cue: "head",
        direction,
        label: `Head ${direction}`,
        rotationDeg,
      });
    },
  );

  it("uses the local access edge for desks and rectangular tables", () => {
    expect(projectFurnitureOrientation("desk", 0)).toMatchObject({
      cue: "use-side",
      direction: "north",
      label: "Use side north",
    });
    expect(
      projectFurnitureOrientation("table", 90, { width: 1.2, depth: 0.6 }),
    ).toMatchObject({
      cue: "use-side",
      direction: "east",
      label: "Use side east",
    });
  });

  it.each(["rug", "plant", "generic"] as const)(
    "returns an explicit symmetric fallback for %s",
    (category) => {
      expect(projectFurnitureOrientation(category, 180)).toEqual({
        cue: "none",
        direction: null,
        directionVector: [0, 0],
        label: "No fixed direction",
        rotationDeg: 180,
      });
    },
  );

  it("treats a square table as symmetric because no access edge is meaningful", () => {
    expect(
      projectFurnitureOrientation("table", 270, { width: 0.8, depth: 0.8 }),
    ).toMatchObject({
      cue: "none",
      direction: null,
      label: "No fixed direction",
      rotationDeg: 270,
    });
  });
});
