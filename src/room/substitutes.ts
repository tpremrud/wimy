import type { CatalogItem } from "./catalog";
import { catalogItemKey } from "./catalog";
import type {
  CatalogRef,
  Dimensions,
  EntityId,
  FurnitureSnapshot,
  Pose,
  WimyRoomV1,
} from "./document";
import { validatePlacement } from "./placement";

export const MAX_SUBSTITUTE_RESULTS = 5;

type SubstituteSnapshot = Omit<CatalogItem["snapshot"], "commerce">;
type SubstituteCatalogItem = Omit<CatalogItem, "snapshot"> & {
  readonly snapshot: SubstituteSnapshot;
};

type DimensionDifference = {
  source: Dimensions;
  substitute: Dimensions;
  delta: Dimensions;
};

export type SubstituteSuggestion = SubstituteCatalogItem & {
  readonly actionable: true;
  readonly fit: { readonly ok: true; readonly pose: Pose };
  readonly identity: {
    readonly source: CatalogRef | null;
    readonly substitute: CatalogItem["catalogRef"];
  };
  readonly differences: {
    readonly category: { readonly source: string; readonly substitute: string; readonly same: boolean };
    readonly dimensions: DimensionDifference;
    readonly style: {
      readonly shared: readonly string[];
      readonly onlyInSource: readonly string[];
      readonly onlyInSubstitute: readonly string[];
    };
    readonly material: {
      readonly source: string | null;
      readonly substitute: string | null;
      readonly same: boolean | null;
    };
    readonly color: {
      readonly source: string;
      readonly substitute: string;
      readonly same: boolean;
    };
  };
  readonly rationale: string;
  readonly tradeoffs: readonly string[];
};

type ComparableSource = {
  readonly catalogRef?: CatalogRef;
  readonly snapshot: FurnitureSnapshot;
};

const colorRgb = (value: string) => {
  const normalized = value.trim().replace(/^#/u, "");
  if (!/^[0-9a-f]{6}$/iu.test(normalized)) return undefined;
  return [0, 2, 4].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16));
};

const colorDistance = (first: string, second: string) => {
  const firstRgb = colorRgb(first);
  const secondRgb = colorRgb(second);
  if (!firstRgb || !secondRgb) return 1;
  return Math.sqrt(
    firstRgb.reduce(
      (sum, channel, index) => sum + (channel - secondRgb[index]!) ** 2,
      0,
    ),
  ) / Math.sqrt(3 * 255 ** 2);
};

const dimensionDifference = (
  source: Dimensions,
  substitute: Dimensions,
): DimensionDifference => ({
  source: structuredClone(source),
  substitute: structuredClone(substitute),
  delta: {
    width: substitute.width - source.width,
    depth: substitute.depth - source.depth,
    height: substitute.height - source.height,
  },
});

const styleDifference = (
  source: readonly string[],
  substitute: readonly string[],
) => ({
  shared: substitute.filter((tag) => source.includes(tag)).sort((a, b) => a.localeCompare(b)),
  onlyInSource: source.filter((tag) => !substitute.includes(tag)).sort((a, b) => a.localeCompare(b)),
  onlyInSubstitute: substitute.filter((tag) => !source.includes(tag)).sort((a, b) => a.localeCompare(b)),
});

const materialDifference = (source?: string, substitute?: string) => ({
  source: source ?? null,
  substitute: substitute ?? null,
  same: source === undefined || substitute === undefined ? null : source === substitute,
});

const snapshotWithoutCommerce = (
  snapshot: CatalogItem["snapshot"],
): SubstituteSnapshot => ({
  name: snapshot.name,
  category: snapshot.category,
  dimensions: structuredClone(snapshot.dimensions),
  appearance: structuredClone(snapshot.appearance),
  ...(snapshot.material === undefined ? {} : { material: snapshot.material }),
  styleTags: [...snapshot.styleTags],
});

const signedMeters = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(3)} m`;

const tradeoffsFor = (
  source: ComparableSource,
  substitute: CatalogItem,
  dimensions: DimensionDifference,
  styles: ReturnType<typeof styleDifference>,
  material: ReturnType<typeof materialDifference>,
  color: { source: string; substitute: string; same: boolean },
) => {
  const tradeoffs = [`Different catalog identity: ${source.snapshot.name} → ${substitute.snapshot.name}.`];
  if (dimensions.delta.width !== 0 || dimensions.delta.depth !== 0 || dimensions.delta.height !== 0) {
    tradeoffs.push(
      `dimensions change by width ${signedMeters(dimensions.delta.width)}, depth ${signedMeters(dimensions.delta.depth)}, height ${signedMeters(dimensions.delta.height)}.`,
    );
  }
  if (styles.onlyInSource.length > 0 || styles.onlyInSubstitute.length > 0) {
    tradeoffs.push(
      `style tags differ: source-only ${styles.onlyInSource.join(", ") || "none"}; substitute-only ${styles.onlyInSubstitute.join(", ") || "none"}.`,
    );
  }
  if (material.same !== true) {
    tradeoffs.push(
      `material differs: ${material.source ?? "not recorded"} → ${material.substitute ?? "not recorded"}.`,
    );
  }
  if (!color.same) {
    tradeoffs.push(`color differs: ${color.source} → ${color.substitute}.`);
  }
  return tradeoffs;
};

const scoreFor = (
  source: ComparableSource,
  substitute: CatalogItem,
  styles: ReturnType<typeof styleDifference>,
  material: ReturnType<typeof materialDifference>,
) => {
  const dimensions = substitute.snapshot.dimensions;
  const sourceDimensions = source.snapshot.dimensions;
  const dimensionPenalty =
    Math.abs(dimensions.width - sourceDimensions.width) / Math.max(dimensions.width, sourceDimensions.width) +
    Math.abs(dimensions.depth - sourceDimensions.depth) / Math.max(dimensions.depth, sourceDimensions.depth) +
    Math.abs(dimensions.height - sourceDimensions.height) / Math.max(dimensions.height, sourceDimensions.height);
  const styleBonus = styles.shared.length * 0.12;
  const materialBonus = material.same === true ? 0.25 : material.same === false ? 0 : 0.05;
  const colorBonus = (1 - colorDistance(source.snapshot.appearance.color, substitute.snapshot.appearance.color)) * 0.12;
  return 1 - dimensionPenalty + styleBonus + materialBonus + colorBonus;
};

const rationaleFor = (
  source: ComparableSource,
  substitute: CatalogItem,
  styles: ReturnType<typeof styleDifference>,
  material: ReturnType<typeof materialDifference>,
  color: { source: string; substitute: string; same: boolean },
) => {
  const materialText = material.same === null
    ? "material is not recorded for both items"
    : material.same
      ? `same ${material.source} material`
      : `material changes from ${material.source} to ${material.substitute}`;
  const colorText = color.same ? "same color" : `color changes from ${color.source} to ${color.substitute}`;
  return `${substitute.snapshot.name} is a comparable substitute for ${source.snapshot.name}: same ${source.snapshot.category} category, ${styles.shared.length > 0 ? `shares ${styles.shared.join(", ")} style tags` : "does not share a style tag"}, ${materialText}, and ${colorText}. Fit was validated at the current item's pose before this suggestion became actionable.`;
};

const rankSubstitutesForPlacedItem = (
  room: WimyRoomV1,
  source: ComparableSource,
  catalog: readonly CatalogItem[],
  sourceInstanceId: EntityId,
  limit = MAX_SUBSTITUTE_RESULTS,
): SubstituteSuggestion[] => {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_SUBSTITUTE_RESULTS) {
    throw new RangeError(`Substitute limit must be an integer from 1 to ${MAX_SUBSTITUTE_RESULTS}`);
  }

  const roomSnapshot = structuredClone(room);
  const sourceInstance = roomSnapshot.items.find(
    (item) => item.id === sourceInstanceId,
  );
  if (!sourceInstance) return [];
  if (
    source.catalogRef &&
    (!sourceInstance.catalogRef ||
      catalogItemKey(sourceInstance.catalogRef) !== catalogItemKey(source.catalogRef))
  ) {
    return [];
  }
  const sourceForComparison = {
    ...source,
    snapshot: structuredClone(sourceInstance.snapshot),
  };

  const ranked = catalog
    .filter(
      (candidate) =>
        (!source.catalogRef ||
          catalogItemKey(candidate.catalogRef) !== catalogItemKey(source.catalogRef)) &&
        candidate.snapshot.category === sourceForComparison.snapshot.category,
    )
    .map((candidate) => {
      const candidateItem = {
        id: sourceInstance.id,
        catalogRef: structuredClone(candidate.catalogRef),
        snapshot: structuredClone(candidate.snapshot),
        pose: structuredClone(sourceInstance.pose),
      };
      const fit = validatePlacement(roomSnapshot, candidateItem, candidateItem.pose);
      if (!fit.ok) return undefined;
      const styles = styleDifference(sourceForComparison.snapshot.styleTags, candidate.snapshot.styleTags);
      const material = materialDifference(sourceForComparison.snapshot.material, candidate.snapshot.material);
      const color = {
        source: sourceForComparison.snapshot.appearance.color,
        substitute: candidate.snapshot.appearance.color,
        same: sourceForComparison.snapshot.appearance.color === candidate.snapshot.appearance.color,
      };
      const dimensions = dimensionDifference(sourceForComparison.snapshot.dimensions, candidate.snapshot.dimensions);
      return {
        candidate,
        score: scoreFor(sourceForComparison, candidate, styles, material),
        suggestion: {
          catalogRef: structuredClone(candidate.catalogRef),
          snapshot: snapshotWithoutCommerce(candidate.snapshot),
          ...(candidate.metadata
            ? { metadata: structuredClone(candidate.metadata) }
            : {}),
          actionable: true as const,
          fit: { ok: true as const, pose: structuredClone(candidateItem.pose) },
          identity: {
            source: source.catalogRef ? structuredClone(source.catalogRef) : null,
            substitute: structuredClone(candidate.catalogRef),
          },
          differences: {
            category: {
              source: sourceForComparison.snapshot.category,
              substitute: candidate.snapshot.category,
              same: sourceForComparison.snapshot.category === candidate.snapshot.category,
            },
            dimensions,
            style: styles,
            material,
            color,
          },
          rationale: rationaleFor(sourceForComparison, candidate, styles, material, color),
          tradeoffs: tradeoffsFor(sourceForComparison, candidate, dimensions, styles, material, color),
        },
      };
    })
    .filter((value): value is NonNullable<typeof value> => value !== undefined)
    .sort(
      (first, second) =>
        second.score - first.score ||
        catalogItemKey(first.candidate.catalogRef).localeCompare(catalogItemKey(second.candidate.catalogRef)),
    );

  return ranked.slice(0, limit).map(({ suggestion }) => suggestion);
};

export const rankComparableSubstitutes = (
  room: WimyRoomV1,
  source: CatalogItem,
  catalog: readonly CatalogItem[],
  sourceInstanceId: EntityId,
  limit = MAX_SUBSTITUTE_RESULTS,
) => rankSubstitutesForPlacedItem(room, source, catalog, sourceInstanceId, limit);

export const rankPlacedItemSubstitutes = (
  room: WimyRoomV1,
  catalog: readonly CatalogItem[],
  sourceInstanceId: EntityId,
  limit = MAX_SUBSTITUTE_RESULTS,
) => {
  const source = room.items.find(({ id }) => id === sourceInstanceId);
  if (!source) return [];
  return rankSubstitutesForPlacedItem(room, source, catalog, sourceInstanceId, limit);
};
