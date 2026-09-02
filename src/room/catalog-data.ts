import type { CatalogItem } from "./catalog";

export const CATALOG_ID = "wimy-demo-v1" as const;
export const DEMO_CATALOG_PROVENANCE = "fictional" as const;

const deepFreeze = <T>(value: T): T => {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach((child) => deepFreeze(child));
    Object.freeze(value);
  }
  return value;
};

export const DEMO_CATALOG: readonly CatalogItem[] = deepFreeze([
  {
    catalogRef: { catalogId: CATALOG_ID, productId: "ember-nest-chair" },
    snapshot: {
      name: "Ember Nest Chair",
      category: "chair",
      dimensions: { width: 0.6, depth: 0.6, height: 0.82 },
      appearance: { color: "#C98F65" },
      material: "molded polymer",
      styleTags: ["warm-modern", "compact"],
      commerce: { price: { amount: 499, currency: "USD" } },
    },
  },
  {
    catalogRef: { catalogId: CATALOG_ID, productId: "cedar-arc-chair" },
    snapshot: {
      name: "Cedar Arc Chair",
      category: "chair",
      dimensions: { width: 0.72, depth: 0.68, height: 0.86 },
      appearance: { color: "#8F765E" },
      material: "oak",
      styleTags: ["warm-modern", "natural"],
      commerce: { price: { amount: 559, currency: "USD" } },
    },
  },
  {
    catalogRef: { catalogId: CATALOG_ID, productId: "lumen-fold-desk" },
    snapshot: {
      name: "Lumen Fold Desk",
      category: "desk",
      dimensions: { width: 1, depth: 0.5, height: 0.75 },
      appearance: { color: "#D3B58D" },
      material: "laminated wood",
      styleTags: ["compact", "minimal"],
      commerce: { price: { amount: 429, currency: "USD" } },
    },
  },
  {
    catalogRef: { catalogId: CATALOG_ID, productId: "hearthline-sofa" },
    snapshot: {
      name: "Hearthline Sofa",
      category: "sofa",
      dimensions: { width: 1.85, depth: 0.82, height: 0.78 },
      appearance: { color: "#BDA88B" },
      material: "woven fabric",
      styleTags: ["warm-modern", "soft"],
      commerce: { price: { amount: 899, currency: "USD" } },
    },
  },
  {
    catalogRef: { catalogId: CATALOG_ID, productId: "pebble-drum-table" },
    snapshot: {
      name: "Pebble Drum Table",
      category: "table",
      dimensions: { width: 0.75, depth: 0.75, height: 0.42 },
      appearance: { color: "#9E7955" },
      material: "stone composite",
      styleTags: ["organic", "compact"],
      commerce: { price: { amount: 349, currency: "USD" } },
    },
  },
  {
    catalogRef: { catalogId: CATALOG_ID, productId: "juniper-rise-plant" },
    snapshot: {
      name: "Juniper Rise Plant",
      category: "plant",
      dimensions: { width: 0.42, depth: 0.42, height: 1.25 },
      appearance: { color: "#58745D" },
      material: "ceramic",
      styleTags: ["natural", "calm"],
      commerce: { price: { amount: 129, currency: "USD" } },
    },
  },
  {
    catalogRef: { catalogId: CATALOG_ID, productId: "saffron-loom-rug" },
    snapshot: {
      name: "Saffron Loom Rug",
      category: "rug",
      dimensions: { width: 2.2, depth: 1.6, height: 0.02 },
      appearance: { color: "#D2A85D" },
      material: "wool",
      styleTags: ["warm-modern", "textured"],
      commerce: { price: { amount: 299, currency: "USD" } },
    },
  },
  {
    catalogRef: { catalogId: CATALOG_ID, productId: "harbor-slat-bed" },
    snapshot: {
      name: "Harbor Slat Bed",
      category: "bed",
      dimensions: { width: 1.5, depth: 2.05, height: 0.5 },
      appearance: { color: "#A88362" },
      material: "oak",
      styleTags: ["calm", "minimal"],
      commerce: { price: { amount: 799, currency: "USD" } },
    },
  },
  {
    catalogRef: { catalogId: CATALOG_ID, productId: "vale-drawer-dresser" },
    snapshot: {
      name: "Vale Drawer Dresser",
      category: "dresser",
      dimensions: { width: 1.1, depth: 0.48, height: 0.9 },
      appearance: { color: "#765B48" },
      material: "wood veneer",
      styleTags: ["warm-modern", "storage"],
      commerce: { price: { amount: 649, currency: "USD" } },
    },
  },
  {
    catalogRef: { catalogId: CATALOG_ID, productId: "orbit-side-table" },
    snapshot: {
      name: "Orbit Side Table",
      category: "table",
      dimensions: { width: 0.45, depth: 0.45, height: 0.52 },
      appearance: { color: "#66717A" },
      material: "powder-coated steel",
      styleTags: ["compact", "minimal"],
      commerce: { price: { amount: 189, currency: "USD" } },
    },
  },
  {
    catalogRef: { catalogId: CATALOG_ID, productId: "dune-shell-lounger" },
    snapshot: {
      name: "Dune Shell Lounger",
      category: "chair",
      dimensions: { width: 0.84, depth: 0.88, height: 0.82 },
      appearance: { color: "#C87852" },
      material: "molded polymer",
      styleTags: ["organic", "molded-shell", "lounge"],
      commerce: { price: { amount: 579, currency: "USD" } },
    },
  },
  {
    catalogRef: { catalogId: CATALOG_ID, productId: "tidal-modular-sofa" },
    snapshot: {
      name: "Tidal Modular Sofa",
      category: "sofa",
      dimensions: { width: 2.1, depth: 0.95, height: 0.72 },
      appearance: { color: "#6E7F8D" },
      material: "woven fabric",
      styleTags: ["soft", "modular", "low-profile"],
      commerce: { price: { amount: 1299, currency: "USD" } },
    },
  },
  {
    catalogRef: { catalogId: CATALOG_ID, productId: "cove-shell-chair" },
    snapshot: {
      name: "Cove Shell Chair",
      category: "chair",
      dimensions: { width: 0.78, depth: 0.8, height: 0.8 },
      appearance: { color: "#7A8F88" },
      material: "molded polymer",
      styleTags: ["organic", "sculptural", "lounge"],
      commerce: { price: { amount: 639, currency: "USD" } },
    },
  },
  {
    catalogRef: { catalogId: CATALOG_ID, productId: "tideline-corner-sofa" },
    snapshot: {
      name: "Tideline Corner Sofa",
      category: "sofa",
      dimensions: { width: 2.3, depth: 1.55, height: 0.74 },
      appearance: { color: "#738A96" },
      material: "woven fabric",
      styleTags: ["soft", "modular", "corner", "low-profile"],
      commerce: { price: { amount: 1499, currency: "USD" } },
    },
  },
  {
    catalogRef: { catalogId: CATALOG_ID, productId: "arclet-dining-table" },
    snapshot: {
      name: "Arclet Dining Table",
      category: "table",
      dimensions: { width: 1.6, depth: 0.9, height: 0.76 },
      appearance: { color: "#B18A61" },
      material: "oak",
      styleTags: ["dining", "sculptural", "natural"],
      commerce: { price: { amount: 899, currency: "USD" } },
    },
  },
  {
    catalogRef: { catalogId: CATALOG_ID, productId: "reed-dining-chair" },
    snapshot: {
      name: "Reed Dining Chair",
      category: "chair",
      dimensions: { width: 0.52, depth: 0.56, height: 0.84 },
      appearance: { color: "#9A7657" },
      material: "woven cane",
      styleTags: ["dining", "natural", "compact"],
      commerce: { price: { amount: 279, currency: "USD" } },
    },
  },
  {
    catalogRef: { catalogId: CATALOG_ID, productId: "harbor-console" },
    snapshot: {
      name: "Harbor Console",
      category: "dresser",
      dimensions: { width: 1.4, depth: 0.42, height: 0.78 },
      appearance: { color: "#5F6C70" },
      material: "wood veneer",
      styleTags: ["storage", "minimal", "natural"],
      commerce: { price: { amount: 749, currency: "USD" } },
    },
  },
]);
