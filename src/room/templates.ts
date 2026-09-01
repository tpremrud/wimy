import {
  WIMY_FORMAT,
  WIMY_SCHEMA_VERSION,
  type WimyFileV1,
  type WimyRoomV1,
} from "./document";

export const TEMPLATE_IDS = [
  "blank-room",
  "compact-bedroom",
  "living-room",
] as const;

export type TemplateId = (typeof TEMPLATE_IDS)[number];

export const BLANK_ROOM_TEMPLATE: WimyFileV1 = {
  format: WIMY_FORMAT,
  schemaVersion: WIMY_SCHEMA_VERSION,
  room: {
    name: "Blank Room",
    dimensions: { width: 4, depth: 3.5, height: 2.7 },
    openings: [
      {
        id: "opening_blank_door_west",
        kind: "door",
        wall: "west",
        centerOffset: 2.8,
        width: 0.9,
        bottom: 0,
        height: 2.1,
      },
      {
        id: "opening_blank_window_north",
        kind: "window",
        wall: "north",
        centerOffset: 2,
        width: 1.4,
        bottom: 1,
        height: 1.2,
      },
    ],
    items: [],
  },
};

export const COMPACT_BEDROOM_TEMPLATE: WimyFileV1 = {
  format: WIMY_FORMAT,
  schemaVersion: WIMY_SCHEMA_VERSION,
  room: {
    name: "Compact Bedroom",
    dimensions: { width: 3.6, depth: 3.2, height: 2.7 },
    openings: [
      {
        id: "opening_bedroom_door_west",
        kind: "door",
        wall: "west",
        centerOffset: 2.55,
        width: 0.8,
        bottom: 0,
        height: 2.1,
      },
      {
        id: "opening_bedroom_window_north",
        kind: "window",
        wall: "north",
        centerOffset: 1.8,
        width: 1.2,
        bottom: 0.9,
        height: 1.2,
      },
    ],
    items: [
      {
        id: "item_bedroom_bed",
        pose: { x: 1, y: 1.35, rotationDeg: 0 },
        snapshot: {
          name: "Compact Platform Bed",
          category: "bed",
          dimensions: { width: 1.4, depth: 2, height: 0.55 },
          appearance: { color: "#C9B79C" },
          styleTags: ["warm-modern", "compact"],
        },
      },
      {
        id: "item_bedroom_desk",
        pose: { x: 2.85, y: 0.45, rotationDeg: 180 },
        snapshot: {
          name: "Slim Writing Desk",
          category: "desk",
          dimensions: { width: 0.9, depth: 0.5, height: 0.75 },
          appearance: { color: "#8A6A4A" },
          styleTags: ["warm-modern", "compact"],
        },
      },
      {
        id: "item_bedroom_chair",
        pose: { x: 2.85, y: 1.2, rotationDeg: 0 },
        snapshot: {
          name: "Upholstered Desk Chair",
          category: "chair",
          dimensions: { width: 0.55, depth: 0.55, height: 0.85 },
          appearance: { color: "#6F7C72" },
          styleTags: ["warm-modern", "compact"],
        },
      },
    ],
  },
};

export const LIVING_ROOM_TEMPLATE: WimyFileV1 = {
  format: WIMY_FORMAT,
  schemaVersion: WIMY_SCHEMA_VERSION,
  room: {
    name: "Living Room",
    dimensions: { width: 4.8, depth: 4.2, height: 2.7 },
    openings: [
      {
        id: "opening_living_door_west",
        kind: "door",
        wall: "west",
        centerOffset: 3.45,
        width: 0.9,
        bottom: 0,
        height: 2.1,
      },
      {
        id: "opening_living_window_north",
        kind: "window",
        wall: "north",
        centerOffset: 2.4,
        width: 1.8,
        bottom: 0.9,
        height: 1.2,
      },
      {
        id: "opening_living_window_east",
        kind: "window",
        wall: "east",
        centerOffset: 1.3,
        width: 1.2,
        bottom: 0.8,
        height: 1.3,
      },
    ],
    items: [
      {
        id: "item_living_sofa",
        pose: { x: 2.4, y: 0.55, rotationDeg: 180 },
        snapshot: {
          name: "Linen Apartment Sofa",
          category: "sofa",
          dimensions: { width: 1.8, depth: 0.85, height: 0.8 },
          appearance: { color: "#C9B79C" },
          styleTags: ["warm-modern", "compact"],
        },
      },
      {
        id: "item_living_rug",
        pose: { x: 2.4, y: 2.35, rotationDeg: 0 },
        snapshot: {
          name: "Warm Woven Rug",
          category: "rug",
          dimensions: { width: 2.4, depth: 1.7, height: 0.02 },
          appearance: { color: "#D8C6A5" },
          styleTags: ["warm-modern", "textured"],
        },
      },
      {
        id: "item_living_table",
        pose: { x: 2.4, y: 2.2, rotationDeg: 0 },
        snapshot: {
          name: "Oak Coffee Table",
          category: "table",
          dimensions: { width: 1, depth: 0.55, height: 0.4 },
          appearance: { color: "#9A714B" },
          styleTags: ["warm-modern", "natural"],
        },
      },
      {
        id: "item_living_chair",
        pose: { x: 1.1, y: 2.3, rotationDeg: 90 },
        snapshot: {
          name: "Soft Lounge Chair",
          category: "chair",
          dimensions: { width: 0.75, depth: 0.75, height: 0.85 },
          appearance: { color: "#6F7C72" },
          styleTags: ["warm-modern", "soft"],
        },
      },
      {
        id: "item_living_plant",
        pose: { x: 4.2, y: 0.6, rotationDeg: 0 },
        snapshot: {
          name: "Tall Leaf Plant",
          category: "plant",
          dimensions: { width: 0.45, depth: 0.45, height: 1.3 },
          appearance: { color: "#557A5B" },
          styleTags: ["warm-modern", "natural"],
        },
      },
    ],
  },
};

const TEMPLATE_REGISTRY: Record<TemplateId, WimyFileV1> = {
  "blank-room": structuredClone(BLANK_ROOM_TEMPLATE),
  "compact-bedroom": structuredClone(COMPACT_BEDROOM_TEMPLATE),
  "living-room": structuredClone(LIVING_ROOM_TEMPLATE),
};

export const getTemplate = (templateId: TemplateId): WimyRoomV1 =>
  structuredClone(TEMPLATE_REGISTRY[templateId].room);
