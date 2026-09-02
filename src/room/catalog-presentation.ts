export type ProceduralAppearanceKey =
  | "category-default"
  | "molded-shell-lounge"
  | "modular-sofa"
  | "cove-shell-chair"
  | "corner-sofa"
  | "pedestal-dining-table"
  | "reed-dining-chair"
  | "console-storage"
  | "slatted-bed"
  | "layered-plant"
  | "woven-rug"
  | "folding-desk";

export type CatalogPresentation = {
  readonly productId: string;
  readonly variantId: string;
  readonly presentationKey: string;
  readonly presentationType: "procedural";
  readonly appearanceKey: ProceduralAppearanceKey;
  readonly origin: "project-authored";
  readonly license: {
    readonly spdxId: "MIT";
    readonly attributionRequired: false;
  };
  readonly approvalStatus: "approved";
  readonly runtimeNetworkRequired: false;
  readonly maxPrimitiveParts: number;
  readonly notes: string;
};

type CatalogPresentationRef = {
  catalogId: string;
  productId: string;
};

const deepFreeze = <T>(value: T): T => {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach((child) => deepFreeze(child));
    Object.freeze(value);
  }

  return value;
};

const presentation = (
  productId: string,
  appearanceKey: ProceduralAppearanceKey = "category-default",
  maxPrimitiveParts = 8,
): CatalogPresentation => ({
  productId,
  variantId: productId,
  presentationKey: `wimy-procedural/${productId}`,
  presentationType: "procedural",
  appearanceKey,
  origin: "project-authored",
  license: { spdxId: "MIT", attributionRequired: false },
  approvalStatus: "approved",
  runtimeNetworkRequired: false,
  maxPrimitiveParts,
  notes:
    "Fictional Wimy demo presentation authored as bounded procedural geometry; no external model or runtime URL.",
});

const PRESENTATION_RECORDS = [
  presentation("ember-nest-chair"),
  presentation("cedar-arc-chair"),
  presentation("lumen-fold-desk", "folding-desk", 5),
  presentation("hearthline-sofa"),
  presentation("pebble-drum-table"),
  presentation("juniper-rise-plant", "layered-plant", 6),
  presentation("saffron-loom-rug", "woven-rug", 5),
  presentation("harbor-slat-bed", "slatted-bed", 6),
  presentation("vale-drawer-dresser"),
  presentation("orbit-side-table"),
  presentation("dune-shell-lounger", "molded-shell-lounge"),
  presentation("tidal-modular-sofa", "modular-sofa"),
  presentation("cove-shell-chair", "cove-shell-chair"),
  presentation("tideline-corner-sofa", "corner-sofa"),
  presentation("arclet-dining-table", "pedestal-dining-table"),
  presentation("reed-dining-chair", "reed-dining-chair"),
  presentation("harbor-console", "console-storage"),
] as const;

export const CATALOG_PRESENTATION_MANIFEST: Readonly<
  Record<string, CatalogPresentation>
> = deepFreeze(
  Object.fromEntries(
    PRESENTATION_RECORDS.map((record) => [record.productId, record]),
  ) as Record<string, CatalogPresentation>,
);

export const getCatalogPresentation = (
  productId?: string,
): CatalogPresentation | undefined =>
  productId === undefined
    ? undefined
    : CATALOG_PRESENTATION_MANIFEST[productId];

export const resolveCatalogPresentation = (
  refOrProductId?: string | CatalogPresentationRef,
): CatalogPresentation | undefined =>
  getCatalogPresentation(
    typeof refOrProductId === "string" ||
      refOrProductId?.catalogId === "wimy-demo-v1"
      ? typeof refOrProductId === "string"
        ? refOrProductId
        : refOrProductId.productId
      : undefined,
  );

export const resolveCatalogPresentationKey = (
  refOrProductId?: string | CatalogPresentationRef,
): ProceduralAppearanceKey =>
  resolveCatalogPresentation(refOrProductId)?.appearanceKey ??
  "category-default";
