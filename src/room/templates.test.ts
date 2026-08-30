import { describe, expect, it } from "vitest";
import { parseWimyFile, serializeWimyRoom } from "./wimy-file";
import {
  getTemplate,
  LIVING_ROOM_TEMPLATE,
  TEMPLATE_IDS,
} from "./templates";

describe("room templates", () => {
  it("provides three independent rooms accepted by the production codec", async () => {
    expect(TEMPLATE_IDS).toEqual([
      "blank-room",
      "compact-bedroom",
      "living-room",
    ]);
    for (const templateId of TEMPLATE_IDS) {
      const room = getTemplate(templateId);
      const parsed = await parseWimyFile(serializeWimyRoom(room));
      expect(parsed).toEqual({ ok: true, room });
      expect(getTemplate(templateId)).not.toBe(room);
    }
  });

  it("uses a unique room name for each template", () => {
    const names = TEMPLATE_IDS.map((templateId) => getTemplate(templateId).name);

    expect(new Set(names).size).toBe(TEMPLATE_IDS.length);
  });

  it("preserves stable, document-unique fixture IDs", () => {
    for (const templateId of TEMPLATE_IDS) {
      const firstRoom = getTemplate(templateId);
      const secondRoom = getTemplate(templateId);
      const firstIds = [
        ...firstRoom.openings.map(({ id }) => id),
        ...firstRoom.items.map(({ id }) => id),
      ];
      const secondIds = [
        ...secondRoom.openings.map(({ id }) => id),
        ...secondRoom.items.map(({ id }) => id),
      ];

      expect(new Set(firstIds).size).toBe(firstIds.length);
      expect(secondIds).toEqual(firstIds);
    }
  });

  it("deep-clones rooms so callers cannot mutate template constants", () => {
    for (const templateId of TEMPLATE_IDS) {
      const room = getTemplate(templateId);
      const originalWidth = room.dimensions.width;
      room.dimensions.width = originalWidth + 1;

      expect(getTemplate(templateId).dimensions.width).toBe(originalWidth);
    }
  });

  it("isolates registry sources from exported template object mutation", () => {
    const originalName = LIVING_ROOM_TEMPLATE.room.name;

    try {
      LIVING_ROOM_TEMPLATE.room.name = "Mutated Export";
      expect(getTemplate("living-room").name).toBe(originalName);
    } finally {
      LIVING_ROOM_TEMPLATE.room.name = originalName;
    }
  });
});
