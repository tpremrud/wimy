import { describe, expect, it } from "vitest";
import {
  makeOpening,
  makePlacedItem,
  makeRoom,
} from "../test/room-fixtures";
import { MAX_WIMY_FILE_BYTES, WimyRoomV1Schema } from "./document";
import { parseWimyFile, serializeWimyRoom } from "./wimy-file";

const makeStyleHeavyRoom = (styleTagsPerItem: number) => {
  const baseItem = makePlacedItem();
  const styleTags = Array.from(
    { length: styleTagsPerItem },
    () => "x".repeat(80),
  );

  return makeRoom({
    items: Array.from({ length: 100 }, (_, index) =>
      makePlacedItem({
        id: `item_${index}`,
        snapshot: { ...baseItem.snapshot, styleTags: [...styleTags] },
      }),
    ),
  });
};

describe("serializeWimyRoom", () => {
  it("uses fixed key order, two-space indentation, and one trailing newline", () => {
    const room = makeRoom();
    const expected = [
      "{",
      '  "format": "wimy-room",',
      '  "schemaVersion": 1,',
      '  "room": {',
      '    "name": "Test Room",',
      '    "dimensions": {',
      '      "width": 4,',
      '      "depth": 3,',
      '      "height": 2.7',
      "    },",
      '    "openings": [],',
      '    "items": []',
      "  }",
      "}",
      "",
    ].join("\n");

    expect(serializeWimyRoom(room)).toBe(expected);
  });

  it("rejects canonical exports over the file byte limit", () => {
    const room = makeStyleHeavyRoom(150);

    expect(WimyRoomV1Schema.safeParse(room).success).toBe(false);
    expect(() => serializeWimyRoom(room)).toThrow(
      `Wimy files must be at most ${MAX_WIMY_FILE_BYTES} bytes`,
    );
  });

  it("keeps v1 orientation in pose rotation without adding a second field", async () => {
    const room = makeRoom({
      items: [makePlacedItem({ pose: { x: 1, y: 1, rotationDeg: 180 } })],
    });
    const text = serializeWimyRoom(room);
    const parsed = await parseWimyFile(text);

    expect(text).not.toContain("facingDeg");
    expect(text).not.toContain('"orientation"');
    expect(parsed).toEqual({ ok: true, room });
    if (parsed.ok) expect(serializeWimyRoom(parsed.room)).toBe(text);
  });
});

describe("parseWimyFile", () => {
  it("round-trips semantically equal room content with stable IDs", async () => {
    const room = makeRoom({
      openings: [makeOpening()],
      items: [
        makePlacedItem({
          catalogRef: {
            catalogId: "unavailable-catalog",
            productId: "archived-chair",
          },
        }),
      ],
    });

    await expect(parseWimyFile(serializeWimyRoom(room))).resolves.toEqual({
      ok: true,
      room,
    });
  });

  it("canonicalizes negative-zero rotation across a semantic round-trip", async () => {
    const room = makeRoom({
      items: [
        makePlacedItem({
          pose: { x: 1, y: 1, rotationDeg: -0 },
        }),
      ],
    });
    const canonicalRoom = WimyRoomV1Schema.parse(room);
    const parsed = await parseWimyFile(serializeWimyRoom(room));

    expect(canonicalRoom.items[0]?.pose.rotationDeg).toBe(0);
    expect(parsed).toEqual({ ok: true, room: canonicalRoom });
  });

  it("accepts browser File inputs", async () => {
    const room = makeRoom();
    const file = new File([serializeWimyRoom(room)], "test-room.wimy", {
      type: "application/json",
    });

    await expect(parseWimyFile(file)).resolves.toEqual({ ok: true, room });
  });

  it("re-exports app-generated files byte-for-byte", async () => {
    const exported = serializeWimyRoom(
      makeRoom({
        openings: [makeOpening()],
        items: [makePlacedItem()],
      }),
    );
    const parsed = await parseWimyFile(exported);

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(serializeWimyRoom(parsed.room)).toBe(exported);
    }
  });

  it("rejects oversized bytes before attempting JSON parsing", async () => {
    const oversizedInvalidJson = new Uint8Array(MAX_WIMY_FILE_BYTES + 1);

    await expect(parseWimyFile(oversizedInvalidJson)).resolves.toMatchObject({
      ok: false,
      code: "FILE_TOO_LARGE",
    });
  });

  it("rejects under-limit minified input whose canonical file is oversized", async () => {
    const candidate = {
      format: "wimy-room",
      schemaVersion: 1,
      room: makeStyleHeavyRoom(100),
    };
    const minified = JSON.stringify(candidate);
    const canonicalFile = `${JSON.stringify(candidate, null, 2)}\n`;
    const encoder = new TextEncoder();

    expect(encoder.encode(minified).byteLength).toBeLessThanOrEqual(
      MAX_WIMY_FILE_BYTES,
    );
    expect(encoder.encode(canonicalFile).byteLength).toBeGreaterThan(
      MAX_WIMY_FILE_BYTES,
    );
    await expect(parseWimyFile(minified)).resolves.toMatchObject({
      ok: false,
      code: "INVALID_DOCUMENT",
      path: "room",
    });
  });

  it("returns INVALID_JSON for malformed JSON", async () => {
    await expect(parseWimyFile("{not-json")).resolves.toMatchObject({
      ok: false,
      code: "INVALID_JSON",
    });
  });

  it("fails closed on malformed UTF-8 bytes", async () => {
    const bytes = new TextEncoder().encode(serializeWimyRoom(makeRoom()));
    const roomNameStart = bytes.indexOf("T".charCodeAt(0));
    expect(roomNameStart).toBeGreaterThanOrEqual(0);
    bytes[roomNameStart] = 0x80;

    await expect(parseWimyFile(bytes)).resolves.toMatchObject({
      ok: false,
      code: "INVALID_JSON",
    });
  });

  it("distinguishes an unsupported file format", async () => {
    const input = JSON.stringify({
      format: "other-room",
      schemaVersion: 1,
      room: makeRoom(),
    });

    await expect(parseWimyFile(input)).resolves.toMatchObject({
      ok: false,
      code: "UNSUPPORTED_FORMAT",
    });
  });

  it("distinguishes an unsupported schema version", async () => {
    const input = JSON.stringify({
      format: "wimy-room",
      schemaVersion: 2,
      room: makeRoom(),
    });

    await expect(parseWimyFile(input)).resolves.toMatchObject({
      ok: false,
      code: "UNSUPPORTED_SCHEMA_VERSION",
    });
  });

  it("reports INVALID_DOCUMENT with a concise validation path", async () => {
    const input = JSON.stringify({
      format: "wimy-room",
      schemaVersion: 1,
      room: makeRoom({
        dimensions: { width: 0.5, depth: 3, height: 2.7 },
      }),
    });

    await expect(parseWimyFile(input)).resolves.toMatchObject({
      ok: false,
      code: "INVALID_DOCUMENT",
      path: "room.dimensions.width",
    });
  });

  it("reports the later duplicate opening at its actual ID path", async () => {
    const input = JSON.stringify({
      format: "wimy-room",
      schemaVersion: 1,
      room: makeRoom({
        openings: [
          makeOpening({ centerOffset: 1 }),
          makeOpening({ centerOffset: 2 }),
        ],
      }),
    });

    await expect(parseWimyFile(input)).resolves.toMatchObject({
      ok: false,
      code: "INVALID_DOCUMENT",
      path: "room.openings[1].id",
    });
  });

  it("reports a later item that repeats an opening ID at the item ID path", async () => {
    const sharedId = "shared_entity";
    const input = JSON.stringify({
      format: "wimy-room",
      schemaVersion: 1,
      room: makeRoom({
        openings: [makeOpening({ id: sharedId })],
        items: [makePlacedItem({ id: sharedId })],
      }),
    });

    await expect(parseWimyFile(input)).resolves.toMatchObject({
      ok: false,
      code: "INVALID_DOCUMENT",
      path: "room.items[0].id",
    });
  });
});
