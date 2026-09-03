import type {
  FurnitureSnapshot,
  PlacedItem,
  Pose,
  RotationDeg,
  WimyRoomV1,
} from "./document";
import {
  preparePlacementContext,
  validatePlacement,
  type PreparedPlacementContext,
  type PreparedPlacementRoom,
} from "./placement";
import type { ResolvedProduct } from "./transaction";
import { DEMO_CATALOG } from "./catalog-data";
import type {
  CatalogLicense,
  CatalogProvenance,
  CatalogProvider,
} from "../catalog/package";

type CatalogSnapshot = FurnitureSnapshot;

export type CatalogItem = {
  catalogRef: {
    catalogId: string;
    productId: string;
  };
  snapshot: CatalogSnapshot;
  metadata?: CatalogItemMetadata;
};

export type CatalogItemMetadata = {
  origin: "fictional" | "project-authored";
  publisherId: string;
  catalogId: string;
  catalogVersion: string;
  itemId: string;
  variantId: string;
  provider: CatalogProvider;
  provenance: CatalogProvenance;
  license: CatalogLicense;
};

export type CatalogQuery = {
  category?: FurnitureSnapshot["category"];
  styleTags?: readonly string[];
  maxPrice?: number;
  maxWidth?: number;
  maxDepth?: number;
  limit?: number;
};

export type CatalogMatch = CatalogItem & {
  suggestedPose: Pose;
};

export type CatalogRelation = "similar" | "goes-well-with";

export const catalogItemKey = (catalogRef: CatalogItem["catalogRef"]) =>
  `${catalogRef.catalogId}:${catalogRef.productId}`;

const ROTATION_ORDER: readonly RotationDeg[] = [0, 90, 180, 270];
const GRID_SCALE = 10;

const resultLimit = (query: CatalogQuery) => {
  const limit = query.limit ?? 5;
  if (!Number.isInteger(limit) || limit < 1 || limit > 5) {
    throw new RangeError("Catalog query limit must be an integer from 1 to 5");
  }
  return limit;
};

const matchingCatalogItems = (
  query: CatalogQuery,
  catalog: readonly CatalogItem[],
) =>
  catalog.filter(
    ({ snapshot }) =>
      (query.category === undefined ||
        snapshot.category === query.category) &&
      (query.styleTags ?? []).every((styleTag) =>
        snapshot.styleTags.includes(styleTag),
      ) &&
      (query.maxPrice === undefined ||
        (snapshot.commerce?.price.amount ?? Number.POSITIVE_INFINITY) <=
          query.maxPrice) &&
      (query.maxWidth === undefined ||
        snapshot.dimensions.width <= query.maxWidth) &&
      (query.maxDepth === undefined ||
        snapshot.dimensions.depth <= query.maxDepth),
  );

const createCandidateIdFactory = (room: PreparedPlacementRoom) => {
  const usedIds = new Set([
    ...room.openings.map(({ id }) => id),
    ...room.items.map(({ id }) => id),
  ]);
  let sequence = 0;

  return () => {
    let candidateId: string;
    do {
      candidateId = `catalog_fit_candidate_${sequence}`;
      sequence += 1;
    } while (usedIds.has(candidateId));
    usedIds.add(candidateId);
    return candidateId;
  };
};

const firstLegalPose = (
  room: PreparedPlacementRoom,
  candidate: PlacedItem,
  placementContext: PreparedPlacementContext,
): Pose | undefined => {
  const maxX = Math.floor(room.dimensions.width * GRID_SCALE + 1e-9);
  const maxY = Math.floor(room.dimensions.depth * GRID_SCALE + 1e-9);

  for (const rotationDeg of ROTATION_ORDER) {
    for (let scaledY = 0; scaledY <= maxY; scaledY += 1) {
      for (let scaledX = 0; scaledX <= maxX; scaledX += 1) {
        const pose: Pose = {
          x: scaledX / GRID_SCALE,
          y: scaledY / GRID_SCALE,
          rotationDeg,
        };

        if (validatePlacement(room, candidate, pose, placementContext).ok) {
          return pose;
        }
      }
    }
  }

  return undefined;
};

export const findFurniture = (
  room: WimyRoomV1,
  query: CatalogQuery,
  catalog: readonly CatalogItem[],
): CatalogMatch[] => {
  const limit = resultLimit(query);
  const placementContext = preparePlacementContext(room);
  const placementRoom = placementContext.room;
  const nextCandidateId = createCandidateIdFactory(placementRoom);
  const matches: CatalogMatch[] = [];

  for (const item of matchingCatalogItems(query, catalog)) {
    const candidate: PlacedItem = {
      id: nextCandidateId(),
      catalogRef: structuredClone(item.catalogRef),
      snapshot: structuredClone(item.snapshot),
      pose: { x: 0, y: 0, rotationDeg: 0 },
    };
    const suggestedPose = firstLegalPose(
      placementRoom,
      candidate,
      placementContext,
    );
    if (!suggestedPose) continue;

    matches.push({
      ...structuredClone(item),
      suggestedPose,
    });
    if (matches.length === limit) break;
  }

  return matches;
};

const sharedStyleCount = (first: CatalogItem, second: CatalogItem) =>
  second.snapshot.styleTags.filter((styleTag) =>
    first.snapshot.styleTags.includes(styleTag),
  ).length;

const complementaryCategories: Partial<
  Record<FurnitureSnapshot["category"], readonly FurnitureSnapshot["category"][]>
> = {
  bed: ["dresser", "plant", "rug"],
  chair: ["desk", "table", "rug"],
  desk: ["chair", "plant", "rug"],
  dresser: ["bed", "plant", "rug"],
  plant: ["table", "dresser", "sofa", "chair"],
  rug: ["sofa", "chair", "table", "bed"],
  sofa: ["table", "rug", "plant"],
  table: ["chair", "sofa", "plant", "rug"],
};

/**
 * Ranks local catalog facts only. Keeping this pure makes the contextual view
 * deterministic and prevents recommendations from becoming room state.
 */
export const rankCatalogRelations = (
  source: CatalogItem,
  catalog: readonly CatalogItem[],
  relation: CatalogRelation,
  limit = 3,
) => {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError("Catalog relation limit must be a positive integer");
  }

  const ranked = catalog
    .filter(
      (candidate) =>
        candidate.catalogRef.productId !== source.catalogRef.productId,
    )
    .map((candidate) => {
      const sharedStyles = sharedStyleCount(source, candidate);
      const sameCategory = candidate.snapshot.category === source.snapshot.category;
      const complementary =
        complementaryCategories[source.snapshot.category]?.includes(
          candidate.snapshot.category,
        ) ?? false;
      const score =
        relation === "similar"
          ? (sameCategory ? 100 : 0) + sharedStyles * 10
          : (complementary ? 100 : 0) + sharedStyles * 10;

      return { candidate, score };
    })
    .filter(({ score }) => score > 0)
    .sort(
      (first, second) =>
        second.score - first.score ||
        first.candidate.catalogRef.productId.localeCompare(
          second.candidate.catalogRef.productId,
        ),
    );

  return ranked.slice(0, limit).map(({ candidate }) => structuredClone(candidate));
};

export const resolveCatalogProduct = (
  productId: string,
): ResolvedProduct | undefined => {
  const item = DEMO_CATALOG.find(
    ({ catalogRef }) => catalogRef.productId === productId,
  );
  if (!item) return undefined;

  return {
    catalogRef: structuredClone(item.catalogRef),
    snapshot: structuredClone(item.snapshot),
  };
};
