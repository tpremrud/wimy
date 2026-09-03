import { z } from "zod";
import { openingsOverlap } from "./geometry";

export const WIMY_FORMAT = "wimy-room" as const;
export const WIMY_SCHEMA_VERSION = 2 as const;
export const MAX_WIMY_FILE_BYTES = 1_000_000;
const CONTAINMENT_EPSILON_METERS = 1e-9;

const hasAtMostDecimalPlaces = (value: number, places: number) => {
  const scaled = value * 10 ** places;
  return Math.abs(scaled - Math.round(scaled)) <= 1e-9;
};

const canonicalizeDecimalPlaces = (value: number, places: number) => {
  const canonical = Math.round(value * 10 ** places) / 10 ** places;
  return Object.is(canonical, -0) ? 0 : canonical;
};

const PortableNumberSchema = z
  .custom<number>(
    (value) =>
      typeof value === "number" &&
      Number.isFinite(value) &&
      hasAtMostDecimalPlaces(value, 3),
    "Expected a finite number with at most three decimal places",
  )
  .transform((value) => canonicalizeDecimalPlaces(value, 3));
const PositivePortableNumberSchema = PortableNumberSchema.refine(
  (value) => value > 0,
  "Expected a positive number",
);

const containsControlCharacter = (value: string) =>
  Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return (
      codePoint !== undefined &&
      (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f))
    );
  });
const boundedText = (maxLength: number) =>
  z
    .string()
    .refine((value) => !containsControlCharacter(value), {
      message: "Control characters are not allowed",
    })
    .transform((value) => value.trim())
    .pipe(z.string().min(1).max(maxLength));

const HttpsUrlSchema = boundedText(2_048).refine((value) => {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}, "Expected an HTTPS URL");

export const EntityIdSchema = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/u, "Invalid entity ID");

export const RotationDegSchema = z.union([
  z.literal(0).transform(() => 0 as const),
  z.literal(90),
  z.literal(180),
  z.literal(270),
]);

export const DimensionsSchema = z.object({
  width: PositivePortableNumberSchema,
  depth: PositivePortableNumberSchema,
  height: PositivePortableNumberSchema,
}).strict();

const RoomFloorDimensionSchema = PortableNumberSchema.refine(
  (value) => value >= 1 && value <= 30,
  "Room width and depth must be between 1 and 30 meters",
);
const RoomHeightSchema = PortableNumberSchema.refine(
  (value) => value >= 2 && value <= 10,
  "Room height must be between 2 and 10 meters",
);

export const RoomDimensionsSchema = z
  .object({
    width: RoomFloorDimensionSchema,
    depth: RoomFloorDimensionSchema,
    height: RoomHeightSchema,
  })
  .strict();

export const RoomGeometrySchema = z.discriminatedUnion("shape", [
  z.object({ shape: z.literal("rectangle") }).strict(),
  z.object({
    shape: z.literal("l-shape"),
    notch: z.object({
      corner: z.literal("south-east"),
      width: PositivePortableNumberSchema,
      depth: PositivePortableNumberSchema,
    }).strict(),
  }).strict(),
]);

export const PoseSchema = z.object({
  x: PortableNumberSchema,
  y: PortableNumberSchema,
  rotationDeg: RotationDegSchema,
}).strict();

export const OpeningSchema = z.object({
  id: EntityIdSchema,
  kind: z.enum(["door", "window"]),
  wall: z.enum(["north", "east", "south", "west"]),
  centerOffset: PortableNumberSchema,
  width: PositivePortableNumberSchema,
  bottom: PortableNumberSchema,
  height: PositivePortableNumberSchema,
}).strict();

const ColorSchema = z
  .string()
  .max(32)
  .startsWith("#")
  .refine((value) => !containsControlCharacter(value), {
    message: "Control characters are not allowed",
  });

export const AppearanceSchema = z.object({ color: ColorSchema }).strict();

const PriceAmountSchema = PortableNumberSchema.refine(
  (value) => value >= 0 && hasAtMostDecimalPlaces(value, 2),
  "Price must be non-negative with at most two decimal places",
).transform((value) => canonicalizeDecimalPlaces(value, 2));

export const PriceSchema = z
  .object({ amount: PriceAmountSchema, currency: boundedText(16) })
  .strict();

export const CommerceSnapshotSchema = z
  .object({
    price: PriceSchema,
    productUrl: HttpsUrlSchema.optional(),
    observedAt: boundedText(64).optional(),
  })
  .strict();

export const FurnitureSnapshotSchema = z.object({
  name: boundedText(120),
  category: z.enum([
    "bed",
    "desk",
    "chair",
    "sofa",
    "dresser",
    "rug",
    "table",
    "plant",
    "generic",
  ]),
  dimensions: DimensionsSchema,
  appearance: AppearanceSchema,
  material: boundedText(80).optional(),
  styleTags: z.array(boundedText(80)),
  commerce: CommerceSnapshotSchema.optional(),
}).strict();

export const CatalogRefSchema = z
  .object({
    catalogId: boundedText(128),
    productId: boundedText(128),
  })
  .strict();

export type CatalogRef = z.infer<typeof CatalogRefSchema>;

export const PlacedItemSchema = z.object({
  id: EntityIdSchema,
  catalogRef: CatalogRefSchema.optional(),
  pose: PoseSchema,
  snapshot: FurnitureSnapshotSchema,
}).strict();

const WimyRoomV1ObjectSchema = z.object({
  name: boundedText(80),
  dimensions: RoomDimensionsSchema,
  geometry: RoomGeometrySchema.optional(),
  openings: z.array(OpeningSchema).max(20),
  items: z.array(PlacedItemSchema).max(100),
}).strict();

const LegacyWimyRoomV1ObjectSchema = z.object({
  name: boundedText(80),
  dimensions: RoomDimensionsSchema,
  openings: z.array(OpeningSchema).max(20),
  items: z.array(PlacedItemSchema).max(100),
}).strict();

export const toCanonicalWimyFileText = (
  room: z.infer<typeof WimyRoomV1ObjectSchema>,
) =>
  `${JSON.stringify(
    {
      format: WIMY_FORMAT,
      schemaVersion: WIMY_SCHEMA_VERSION,
      room,
    },
    null,
    2,
  )}\n`;

const getCanonicalWimyFileByteLength = (
  room: z.infer<typeof WimyRoomV1ObjectSchema>,
) => new TextEncoder().encode(toCanonicalWimyFileText(room)).byteLength;

const validateRoomInvariants = (
  room: z.infer<typeof WimyRoomV1ObjectSchema>,
  context: z.RefinementCtx,
) => {
  const notch = room.geometry?.shape === "l-shape"
    ? room.geometry.notch
    : undefined;
  if (
    notch &&
    (notch.width >= room.dimensions.width - CONTAINMENT_EPSILON_METERS ||
      notch.depth >= room.dimensions.depth - CONTAINMENT_EPSILON_METERS)
  ) {
    context.addIssue({
      code: "custom",
      message: "An L-shaped room notch must be smaller than the room bounds",
      path: ["geometry", "notch"],
    });
  }

  const entityIdentities = [
    ...room.openings.map(({ id }, index) => ({
      id,
      path: ["openings", index, "id"] as const,
    })),
    ...room.items.map(({ id }, index) => ({
      id,
      path: ["items", index, "id"] as const,
    })),
  ];
  const seenIds = new Set<string>();
  const duplicateIdentity = entityIdentities.find(({ id }) => {
    if (seenIds.has(id)) {
      return true;
    }

    seenIds.add(id);
    return false;
  });

  if (duplicateIdentity) {
    context.addIssue({
      code: "custom",
      message: "Duplicate entity identity",
      path: [...duplicateIdentity.path],
    });
  }

  room.openings.forEach((opening, index) => {
    let wallLength =
      opening.wall === "north" || opening.wall === "south"
        ? room.dimensions.width
        : room.dimensions.depth;
    if (notch && opening.wall === "east") wallLength -= notch.depth;
    if (notch && opening.wall === "south") wallLength -= notch.width;
    const halfWidth = opening.width / 2;

    if (
      opening.centerOffset - halfWidth < -CONTAINMENT_EPSILON_METERS ||
      opening.centerOffset + halfWidth >
        wallLength + CONTAINMENT_EPSILON_METERS
    ) {
      context.addIssue({
        code: "custom",
        message: "Opening must fit on its wall",
        path: ["openings", index],
      });
    }

    if (opening.kind === "door" && opening.bottom !== 0) {
      context.addIssue({
        code: "custom",
        message: "Doors must start at floor level",
        path: ["openings", index, "bottom"],
      });
    }

    if (
      opening.bottom < -CONTAINMENT_EPSILON_METERS ||
      opening.bottom + opening.height >
        room.dimensions.height + CONTAINMENT_EPSILON_METERS
    ) {
      context.addIssue({
        code: "custom",
        message: "Opening height must fit inside the room",
        path: ["openings", index, "height"],
      });
    }
  });

  room.openings.forEach((opening, index) => {
    const overlappingIndex = room.openings.findIndex(
      (candidate, candidateIndex) =>
        candidateIndex > index && openingsOverlap(opening, candidate),
    );
    if (overlappingIndex >= 0) {
      context.addIssue({
        code: "custom",
        message: `Openings ${opening.id} and ${room.openings[overlappingIndex]?.id ?? "unknown"} overlap on the same wall`,
        path: ["openings", overlappingIndex],
      });
    }
  });

  room.items.forEach((item, index) => {
    const isQuarterTurn =
      item.pose.rotationDeg === 90 || item.pose.rotationDeg === 270;
    const footprintWidth = isQuarterTurn
      ? item.snapshot.dimensions.depth
      : item.snapshot.dimensions.width;
    const footprintDepth = isQuarterTurn
      ? item.snapshot.dimensions.width
      : item.snapshot.dimensions.depth;

    if (
      item.pose.x - footprintWidth / 2 < -CONTAINMENT_EPSILON_METERS ||
      item.pose.x + footprintWidth / 2 >
        room.dimensions.width + CONTAINMENT_EPSILON_METERS ||
      item.pose.y - footprintDepth / 2 < -CONTAINMENT_EPSILON_METERS ||
      item.pose.y + footprintDepth / 2 >
        room.dimensions.depth + CONTAINMENT_EPSILON_METERS
    ) {
      context.addIssue({
        code: "custom",
        message: "Placed item footprint must fit inside the room",
        path: ["items", index, "pose"],
      });
    }


    if (notch) {
      const left = item.pose.x - footprintWidth / 2;
      const right = item.pose.x + footprintWidth / 2;
      const top = item.pose.y - footprintDepth / 2;
      const bottom = item.pose.y + footprintDepth / 2;
      const notchLeft = room.dimensions.width - notch.width;
      const notchTop = room.dimensions.depth - notch.depth;
      if (
        left < room.dimensions.width - CONTAINMENT_EPSILON_METERS &&
        right > notchLeft + CONTAINMENT_EPSILON_METERS &&
        top < room.dimensions.depth - CONTAINMENT_EPSILON_METERS &&
        bottom > notchTop + CONTAINMENT_EPSILON_METERS
      ) {
        context.addIssue({
          code: "custom",
          message: "Placed item footprint must fit inside the L-shaped room",
          path: ["items", index, "pose"],
        });
      }
    }

    if (
      item.snapshot.dimensions.height >
      room.dimensions.height + CONTAINMENT_EPSILON_METERS
    ) {
      context.addIssue({
        code: "custom",
        message: "Placed item height must fit inside the room",
        path: ["items", index, "snapshot", "dimensions", "height"],
      });
    }
  });

  if (getCanonicalWimyFileByteLength(room) > MAX_WIMY_FILE_BYTES) {
    context.addIssue({
      code: "custom",
      message: `Wimy files must be at most ${MAX_WIMY_FILE_BYTES} bytes`,
      path: [],
    });
  }
};

export const WimyRoomV1Schema =
  WimyRoomV1ObjectSchema.superRefine(validateRoomInvariants);

export const LegacyWimyRoomV1Schema =
  LegacyWimyRoomV1ObjectSchema.superRefine(validateRoomInvariants);

export const WimyFileV1Schema = z.object({
  format: z.literal(WIMY_FORMAT),
  schemaVersion: z.literal(1),
  room: LegacyWimyRoomV1Schema,
}).strict();

export const WimyFileV2Schema = z.object({
  format: z.literal(WIMY_FORMAT),
  schemaVersion: z.literal(WIMY_SCHEMA_VERSION),
  room: WimyRoomV1Schema,
}).strict();

export type EntityId = z.infer<typeof EntityIdSchema>;
export type RotationDeg = z.infer<typeof RotationDegSchema>;
export type Dimensions = z.infer<typeof DimensionsSchema>;
export type RoomDimensions = z.infer<typeof RoomDimensionsSchema>;
export type Pose = z.infer<typeof PoseSchema>;
export type Opening = z.infer<typeof OpeningSchema>;
export type RoomGeometry = z.infer<typeof RoomGeometrySchema>;
export type FurnitureSnapshot = z.infer<typeof FurnitureSnapshotSchema>;
export type PlacedItem = z.infer<typeof PlacedItemSchema>;
export type WimyRoomV1 = z.infer<typeof WimyRoomV1Schema>;
export type WimyFileV1 = z.infer<typeof WimyFileV1Schema>;
export type WimyFileV2 = z.infer<typeof WimyFileV2Schema>;
