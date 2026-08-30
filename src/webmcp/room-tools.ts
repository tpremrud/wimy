/// <reference types="webmcp-types" />

import { z } from "zod";
import {
  EntityIdSchema,
  PoseSchema,
  type WimyRoomV1,
} from "../room/document";
import { findLayoutWarnings, type RoomWarning } from "../room/placement";
import type { RoomStore } from "../room/store";

export type WebMcpToolDefinition = WebMCP.ModelContextTool;
export type WebMcpRegistrationStatus =
  | { available: false; registered: []; errors: [] }
  | { available: true; registered: string[]; errors: string[] };

export const MAX_WEBMCP_WARNINGS = 50;
export const MAX_WEBMCP_OUTPUT_BYTES = 128 * 1_024;

const conciseRegistrationError = (reason: unknown) => {
  const rawMessage =
    reason instanceof Error
      ? reason.message
      : typeof reason === "string"
        ? reason
        : "registration failed";
  const withoutControlCharacters = Array.from(rawMessage, (character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined &&
      (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f))
      ? " "
      : character;
  }).join("");
  const message = withoutControlCharacters
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 160);

  return message || "registration failed";
};

const projectWarning = (warning: RoomWarning): RoomWarning => {
  if (warning.code === "OVERLAP") {
    return {
      code: warning.code,
      message: `${warning.itemIds[0]} overlaps ${warning.itemIds[1]}`,
      itemIds: [...warning.itemIds],
    };
  }

  if (warning.code === "DOOR_CLEARANCE") {
    return {
      code: warning.code,
      message: warning.message,
      itemIds: [...warning.itemIds],
    };
  }

  return {
    code: warning.code,
    message: `${warning.itemIds[0]} references an unavailable catalog item`,
    itemIds: [...warning.itemIds],
  };
};

const projectWarnings = (warnings: readonly RoomWarning[]) => ({
  warnings: warnings.slice(0, MAX_WEBMCP_WARNINGS).map(projectWarning),
  warningCount: warnings.length,
  warningsTruncated: warnings.length > MAX_WEBMCP_WARNINGS,
});

const enforceWebMcpOutputBound = <Output,>(output: Output): Output => {
  const byteLength = new TextEncoder().encode(JSON.stringify(output)).byteLength;
  if (byteLength > MAX_WEBMCP_OUTPUT_BYTES) {
    throw new RangeError(
      `WebMCP output exceeds ${MAX_WEBMCP_OUTPUT_BYTES} UTF-8 bytes`,
    );
  }

  return output;
};

const InspectRoomInputSchema = z.object({}).strict();

const ENTITY_ID_INPUT_SCHEMA = {
  type: "string",
  pattern: "^[A-Za-z][A-Za-z0-9_-]{0,63}$",
  minLength: 1,
  maxLength: 64,
} as const;
const PORTABLE_COORDINATE_INPUT_SCHEMA = {
  type: "number",
  multipleOf: 0.001,
} as const;

const inspectRoom = (
  store: RoomStore,
  rawInput: Record<string, unknown>,
) => {
  if (!InspectRoomInputSchema.safeParse(rawInput).success) {
    throw new TypeError("inspect_room input must be an empty object");
  }

  const state = store.getState();
  const room = structuredClone(state.room) as WimyRoomV1;

  const warnings = findLayoutWarnings(room, () => false);
  return enforceWebMcpOutputBound({
    revision: state.revision,
    units: "meters" as const,
    room: {
      name: room.name,
      dimensions: { ...room.dimensions },
      openings: room.openings.map((opening) => ({ ...opening })),
      items: room.items.map((item) => ({
        id: item.id,
        name: item.snapshot.name,
        category: item.snapshot.category,
        dimensions: { ...item.snapshot.dimensions },
        pose: { ...item.pose },
      })),
    },
    coordinateConvention: {
      origin: "northwest interior floor corner",
      xAxis: "east/right",
      yAxis: "south/down",
      rotation: "clockwise quarter turns in degrees",
    },
    ...projectWarnings(warnings),
  });
};

const APPLY_ROOM_EDIT_INPUT_SCHEMA = {
  type: "object",
  properties: {
    expectedRevision: { type: "integer", minimum: 1 },
    operations: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: {
        oneOf: [
          {
            type: "object",
            properties: {
              type: { const: "transform" },
              itemId: ENTITY_ID_INPUT_SCHEMA,
              pose: {
                type: "object",
                properties: {
                  x: PORTABLE_COORDINATE_INPUT_SCHEMA,
                  y: PORTABLE_COORDINATE_INPUT_SCHEMA,
                  rotationDeg: { enum: [0, 90, 180, 270] },
                },
                minProperties: 1,
                additionalProperties: false,
              },
            },
            required: ["type", "itemId", "pose"],
            additionalProperties: false,
          },
          {
            type: "object",
            properties: {
              type: { const: "remove" },
              itemId: ENTITY_ID_INPUT_SCHEMA,
            },
            required: ["type", "itemId"],
            additionalProperties: false,
          },
        ],
      },
    },
  },
  required: ["expectedRevision", "operations"],
  additionalProperties: false,
} as const;

const TransformPoseSchema = PoseSchema.partial().refine(
  (pose) => Object.keys(pose).length > 0,
  "A transform pose must change at least one field",
);
const WebMcpRoomOperationSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("transform"),
      itemId: EntityIdSchema,
      pose: TransformPoseSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("remove"),
      itemId: EntityIdSchema,
    })
    .strict(),
]);
const ApplyRoomEditInputSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    operations: z.array(WebMcpRoomOperationSchema).min(1).max(8),
  })
  .strict();

const applyRoomEdit = (
  store: RoomStore,
  rawInput: unknown,
) => {
  const current = store.getState();
  if (
    rawInput === null ||
    typeof rawInput !== "object" ||
    Array.isArray(rawInput)
  ) {
    return enforceWebMcpOutputBound({
      ok: false as const,
      revision: current.revision,
      code: "INVALID_DOCUMENT" as const,
      message: "input must contain only exact transform or remove operations",
    });
  }
  const inputObject = rawInput as Record<string, unknown>;

  if (
    typeof inputObject.expectedRevision !== "number" ||
    !Number.isInteger(inputObject.expectedRevision) ||
    inputObject.expectedRevision < 1
  ) {
    return enforceWebMcpOutputBound({
      ok: false as const,
      revision: current.revision,
      code: "INVALID_DOCUMENT" as const,
      message: "expectedRevision must be a positive integer",
    });
  }
  if (
    !Array.isArray(inputObject.operations) ||
    inputObject.operations.length < 1 ||
    inputObject.operations.length > 8
  ) {
    return enforceWebMcpOutputBound({
      ok: false as const,
      revision: current.revision,
      code: "TOO_MANY_OPERATIONS" as const,
      message: "operations must contain 1 to 8 items",
    });
  }

  const parsedInput = ApplyRoomEditInputSchema.safeParse(inputObject);
  if (!parsedInput.success) {
    return enforceWebMcpOutputBound({
      ok: false as const,
      revision: current.revision,
      code: "INVALID_DOCUMENT" as const,
      message: "input must contain only exact transform or remove operations",
    });
  }

  const input = parsedInput.data;
  const result = current.transact({
    expectedRevision: input.expectedRevision,
    origin: "webmcp",
    change: { type: "edit", operations: input.operations },
  });

  if (!result.ok) {
    return enforceWebMcpOutputBound({
      ok: false as const,
      revision: result.revision,
      code: result.code,
      message: result.message,
    });
  }

  return enforceWebMcpOutputBound({
    ok: true as const,
    revision: result.revision,
    applied: result.applied,
    itemIds: [...result.affectedItemIds],
    ...projectWarnings(result.warnings),
  });
};

export const createRoomToolDefinitions = (
  store: RoomStore,
): WebMcpToolDefinition[] => {
  const definitions: WebMcpToolDefinition[] = [
    {
      name: "inspect_room",
      title: "Inspect room",
      description:
        "Read the current Wimy room revision, geometry, placed items, and layout warnings.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      annotations: {
        readOnlyHint: true,
        untrustedContentHint: true,
      },
      execute: (input) => inspectRoom(store, input),
    },
    {
      name: "apply_room_edit",
      title: "Apply room edit",
      description:
        "Atomically transform or remove placed items at an exact room revision.",
      inputSchema: APPLY_ROOM_EDIT_INPUT_SCHEMA,
      annotations: {
        readOnlyHint: false,
        untrustedContentHint: true,
      },
      execute: (input) => applyRoomEdit(store, input),
    },
  ];

  return definitions;
};

export const registerRoomTools = async (
  modelContext: WebMCP.ModelContext | undefined,
  store: RoomStore,
  controller: AbortController,
): Promise<WebMcpRegistrationStatus> => {
  if (!modelContext) {
    return { available: false, registered: [], errors: [] };
  }

  const definitions = createRoomToolDefinitions(store);
  const settlements = await Promise.allSettled(
    definitions.map((definition) =>
      Promise.resolve().then(async () => {
        if (controller.signal.aborted) return false;

        await modelContext.registerTool(definition, {
          signal: controller.signal,
        });
        return true;
      }),
    ),
  );
  const registered: string[] = [];
  const errors: string[] = [];

  settlements.forEach((settlement, index) => {
    const definition = definitions[index];
    if (!definition) return;

    if (settlement.status === "fulfilled" && settlement.value) {
      registered.push(definition.name);
      return;
    }

    if (settlement.status === "fulfilled") return;

    errors.push(
      `${definition.name}: ${conciseRegistrationError(settlement.reason)}`,
    );
  });

  return { available: true, registered, errors };
};
