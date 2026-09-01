import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  makeOpening,
  makePlacedItem,
  makeRoom,
} from "../test/room-fixtures";
import type { RotationDeg } from "./document";
import { orientedFootprint } from "./placement";
import {
  clientPointToSvg,
  planPointToRoom,
  projectRoomToScene,
  projectRoomToPlan,
  screenPointToRoom,
} from "./projection";

const originalDOMPoint = globalThis.DOMPoint;

class TestDOMPoint {
  readonly x: number;
  readonly y: number;

  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }

  matrixTransform(matrix: DOMMatrix) {
    return new TestDOMPoint(
      matrix.a * this.x + matrix.c * this.y + matrix.e,
      matrix.b * this.x + matrix.d * this.y + matrix.f,
    );
  }
}

beforeAll(() => {
  Object.defineProperty(globalThis, "DOMPoint", {
    configurable: true,
    value: TestDOMPoint,
  });
});

afterAll(() => {
  Object.defineProperty(globalThis, "DOMPoint", {
    configurable: true,
    value: originalDOMPoint,
  });
});

describe("orientedFootprint", () => {
  it.each([
    [0, 1.8, 0.85],
    [90, 0.85, 1.8],
    [180, 1.8, 0.85],
    [270, 0.85, 1.8],
  ] as const)(
    "projects %i degrees to the expected footprint",
    (rotationDeg, width, depth) => {
      expect(
        orientedFootprint(
          { width: 1.8, depth: 0.85, height: 0.8 },
          rotationDeg as RotationDeg,
        ),
      ).toEqual({ width, depth });
    },
  );
});

describe("projectRoomToPlan", () => {
  it("uses a stable padded scale from the northwest room origin", () => {
    const projection = projectRoomToPlan(makeRoom(), {
      width: 500,
      height: 400,
      padding: 40,
    });

    expect(projection.scale).toBe(105);
    expect(projection.origin).toEqual({ x: 40, y: 42.5 });
    expect(projection.roomRect).toEqual({
      x: 40,
      y: 42.5,
      width: 420,
      height: 315,
    });
    expect(projection.dimensions).toEqual({
      width: {
        value: 4,
        x: 250,
        y: 377.5,
      },
      depth: {
        value: 3,
        x: 20,
        y: 200,
      },
    });
  });

  it("projects item centers, quarter-turned rectangles, and label anchors", () => {
    const room = makeRoom({
      items: [
        makePlacedItem({
          pose: { x: 1, y: 1, rotationDeg: 90 },
          snapshot: {
            ...makePlacedItem().snapshot,
            dimensions: { width: 1.2, depth: 0.6, height: 0.8 },
          },
        }),
      ],
    });

    const projection = projectRoomToPlan(room, {
      width: 500,
      height: 400,
      padding: 40,
    });

    expect(projection.items[0]).toEqual({
      id: "item_chair_1",
      center: { x: 145, y: 147.5 },
      rect: { x: 113.5, y: 84.5, width: 63, height: 126 },
      labelAnchor: { x: 145, y: 147.5 },
    });
  });

  it("maps opening widths and offsets onto all four room walls", () => {
    const room = makeRoom({
      openings: [
        makeOpening({
          id: "opening_north",
          wall: "north",
          centerOffset: 1,
          width: 0.8,
        }),
        makeOpening({
          id: "opening_east",
          kind: "window",
          wall: "east",
          centerOffset: 1.2,
          width: 0.6,
        }),
        makeOpening({
          id: "opening_south",
          kind: "window",
          wall: "south",
          centerOffset: 3,
          width: 1,
        }),
        makeOpening({
          id: "opening_west",
          wall: "west",
          centerOffset: 2.2,
          width: 0.4,
        }),
      ],
    });

    const projection = projectRoomToPlan(room, {
      width: 500,
      height: 400,
      padding: 40,
    });

    expect(projection.openings).toEqual([
      {
        id: "opening_north",
        start: { x: 103, y: 42.5 },
        end: { x: 187, y: 42.5 },
      },
      {
        id: "opening_east",
        start: { x: 460, y: 137 },
        end: { x: 460, y: 200 },
      },
      {
        id: "opening_south",
        start: { x: 302.5, y: 357.5 },
        end: { x: 407.5, y: 357.5 },
      },
      {
        id: "opening_west",
        start: { x: 40, y: 252.5 },
        end: { x: 40, y: 294.5 },
      },
    ]);
  });

  it("does not mutate the input room or viewport", () => {
    const room = makeRoom({ items: [makePlacedItem()] });
    const viewport = { width: 500, height: 400, padding: 40 };
    const roomBefore = structuredClone(room);
    const viewportBefore = structuredClone(viewport);

    projectRoomToPlan(room, viewport);

    expect(room).toEqual(roomBefore);
    expect(viewport).toEqual(viewportBefore);
  });
});

describe("projectRoomToScene", () => {
  it("carries a catalog product ID only as presentation metadata", () => {
    const scene = projectRoomToScene(
      makeRoom({
        items: [
          makePlacedItem({
            catalogRef: {
              catalogId: "wimy-demo-v1",
              productId: "cove-shell-chair",
            },
          }),
        ],
      }),
    );

    expect(scene.items[0]).toMatchObject({
      catalogRef: {
        catalogId: "wimy-demo-v1",
        productId: "cove-shell-chair",
      },
      catalogProductId: "cove-shell-chair",
      size: [0.6, 0.8, 0.6],
    });
  });

  it("preserves an external catalog namespace when a product ID collides", () => {
    const scene = projectRoomToScene(
      makeRoom({
        items: [
          makePlacedItem({
            catalogRef: {
              catalogId: "external-catalog",
              productId: "cove-shell-chair",
            },
          }),
        ],
      }),
    );

    expect(scene.items[0]).toMatchObject({
      catalogRef: {
        catalogId: "external-catalog",
        productId: "cove-shell-chair",
      },
      catalogProductId: "cove-shell-chair",
    });
  });
});

describe("projectRoomToScene", () => {
  it("maps room x/y and item height to Three X/Z/Y", () => {
    const item = makePlacedItem({
      pose: { x: 1.2, y: 2.3, rotationDeg: 90 },
      snapshot: {
        ...makePlacedItem().snapshot,
        dimensions: { width: 1.8, depth: 0.8, height: 0.7 },
      },
    });

    const scene = projectRoomToScene(makeRoom({ items: [item] }));

    expect(scene.items[0]).toMatchObject({
      position: [1.2, 0.35, 2.3],
      rotationY: -Math.PI / 2,
    });
  });

  it("copies portable style tags into the derived scene without aliasing the Room Document", () => {
    const item = makePlacedItem({
      snapshot: {
        ...makePlacedItem().snapshot,
        styleTags: ["molded-shell", "lounge"],
      },
    });
    const room = makeRoom({ items: [item] });

    const scene = projectRoomToScene(room);

    expect(scene.items[0]?.styleTags).toEqual(["molded-shell", "lounge"]);
    expect(scene.items[0]?.styleTags).not.toBe(item.snapshot.styleTags);
    scene.items[0]?.styleTags.push("derived-only");
    expect(room.items[0]?.snapshot.styleTags).toEqual([
      "molded-shell",
      "lounge",
    ]);
  });

  it.each([
    [0, 0],
    [90, -1.5707963267948966],
    [180, -3.141592653589793],
    [270, -4.71238898038469],
  ] as const)(
    "maps clockwise %i degree turns to %f Y radians",
    (rotationDeg, rotationY) => {
      const scene = projectRoomToScene(
        makeRoom({
          items: [makePlacedItem({ pose: { x: 1, y: 1, rotationDeg } })],
        }),
      );

      expect(scene.items[0]?.rotationY).toBe(rotationY);
    },
  );

  it("derives literal floor, wall, opening, and safe generic-box facts", () => {
    const scene = projectRoomToScene(
      makeRoom({
        dimensions: { width: 6, depth: 5, height: 3 },
        openings: [
          makeOpening({
            id: "window_east",
            kind: "window",
            wall: "east",
            centerOffset: 1.5,
            width: 1.2,
            bottom: 0.8,
            height: 1.1,
          }),
        ],
        items: [
          makePlacedItem({
            snapshot: {
              ...makePlacedItem().snapshot,
              category: "generic",
              appearance: { color: "#not-a-color" },
            },
          }),
        ],
      }),
    );

    expect(scene.floor).toEqual({ position: [3, 0, 2.5], size: [6, 5] });
    expect(scene.walls).toEqual([
      { wall: "north", position: [3, 1.5, 0], size: [6, 3, 0.08] },
      { wall: "east", position: [6, 1.5, 2.5], size: [0.08, 3, 5] },
      { wall: "south", position: [3, 1.5, 5], size: [6, 3, 0.08] },
      { wall: "west", position: [0, 1.5, 2.5], size: [0.08, 3, 5] },
    ]);
    expect(scene.openings).toEqual([
      {
        id: "window_east",
        kind: "window",
        wall: "east",
        position: [5.945, 1.35, 1.5],
        size: [0.02, 1.1, 1.2],
      },
    ]);
    expect(scene.items[0]).toMatchObject({
      category: "generic",
      color: "#8a8a8a",
      size: [0.6, 0.8, 0.6],
    });
  });

  it("projects opening hints onto separate interior surfaces on every wall", () => {
    const scene = projectRoomToScene(
      makeRoom({
        dimensions: { width: 6, depth: 5, height: 3 },
        openings: [
          makeOpening({
            id: "opening_north",
            wall: "north",
            centerOffset: 1.5,
            height: 2,
          }),
          makeOpening({
            id: "opening_east",
            wall: "east",
            centerOffset: 1.5,
            height: 2,
          }),
          makeOpening({
            id: "opening_south",
            wall: "south",
            centerOffset: 1.5,
            height: 2,
          }),
          makeOpening({
            id: "opening_west",
            wall: "west",
            centerOffset: 1.5,
            height: 2,
          }),
        ],
      }),
    );

    expect(
      scene.openings.map(({ position, size, wall }) => ({
        position,
        size,
        wall,
      })),
    ).toEqual([
      {
        wall: "north",
        position: [1.5, 1, 0.055],
        size: [0.9, 2, 0.02],
      },
      {
        wall: "east",
        position: [5.945, 1, 1.5],
        size: [0.02, 2, 0.9],
      },
      {
        wall: "south",
        position: [1.5, 1, 4.945],
        size: [0.9, 2, 0.02],
      },
      {
        wall: "west",
        position: [0.055, 1, 1.5],
        size: [0.02, 2, 0.9],
      },
    ]);
  });
});

describe("plan coordinate conversion", () => {
  it("converts client coordinates through SVG space back to room meters", () => {
    const projection = projectRoomToPlan(makeRoom(), {
      width: 500,
      height: 400,
      padding: 40,
    });
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    Object.defineProperty(svg, "getScreenCTM", {
      configurable: true,
      value: () => ({
        inverse: () => ({ a: 1, b: 0, c: 0, d: 1, e: -60, f: -20 }),
      }),
    });

    expect(clientPointToSvg(svg, { x: 310, y: 220 })).toEqual({
      x: 250,
      y: 200,
    });
    expect(planPointToRoom(projection, { x: 250, y: 200 })).toEqual({
      x: 2,
      y: 1.5,
    });
    expect(
      screenPointToRoom(svg, { x: 310, y: 220 }, projection),
    ).toEqual({ x: 2, y: 1.5 });
  });

  it("inverts the rendered CTM when the responsive SVG is scaled and letterboxed", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    Object.defineProperty(svg, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: 20,
        left: 0,
        top: 20,
        right: 1_102,
        bottom: 480.8,
        width: 1_102,
        height: 460.8,
        toJSON: () => ({}),
      }),
    });
    Object.defineProperty(svg, "getScreenCTM", {
      configurable: true,
      value: () => ({
        inverse: () => ({
          a: 1 / 0.882,
          b: 0,
          c: 0,
          d: 1 / 0.882,
          e: -233.48 / 0.882,
          f: -20 / 0.882,
        }),
      }),
    });

    const point = clientPointToSvg(svg, {
      x: 233.48 + 250 * 0.882,
      y: 20 + 200 * 0.882,
    });

    expect(point?.x).toBeCloseTo(250, 10);
    expect(point?.y).toBeCloseTo(200, 10);
  });

  it("fails closed when the SVG CTM is missing or not invertible", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");

    expect(clientPointToSvg(svg, { x: 10, y: 20 })).toBeNull();

    Object.defineProperty(svg, "getScreenCTM", {
      configurable: true,
      value: () => ({
        inverse: () => {
          throw new DOMException("The matrix is not invertible");
        },
      }),
    });

    expect(clientPointToSvg(svg, { x: 10, y: 20 })).toBeNull();
  });
});
