import type { CatalogItem, CatalogItemMetadata } from "../room/catalog";
import { DEMO_CATALOG } from "../room/catalog-data";
import type { ResolvedProduct } from "../room/transaction";
import {
  WimyCatalogV1Schema,
  type CatalogPackageItem,
  type WimyCatalogV1,
} from "./package";

export type CatalogRegistryPackage = {
  packageKey: string;
  publisherId: string;
  catalogId: string;
  catalogVersion: string;
  name: string;
  provider: WimyCatalogV1["provider"];
  provenance: WimyCatalogV1["catalog"]["provenance"];
  license: WimyCatalogV1["catalog"]["license"];
  origin: "fictional" | "project-authored";
};

export type CatalogRegistryConflictCode =
  | "PACKAGE_CONFLICT"
  | "CATALOG_CONFLICT"
  | "ITEM_CONFLICT"
  | "VARIANT_CONFLICT";

export type CatalogRegistryConflict = {
  code: CatalogRegistryConflictCode;
  packageKey: string;
  message: string;
};

export type CatalogRegistryImportResult =
  | {
      ok: true;
      addedPackages: number;
      addedItems: number;
      duplicatePackages: number;
    }
  | {
      ok: false;
      code:
        | "INVALID_PACKAGE"
        | "PACKAGE_CONFLICT"
        | "CATALOG_CONFLICT"
        | "ITEM_CONFLICT"
        | "VARIANT_CONFLICT";
      message: string;
      conflicts?: readonly CatalogRegistryConflict[];
    };

type StoredPackage = {
  descriptor: CatalogRegistryPackage;
  fingerprint: string;
  items: readonly CatalogItem[];
};

type PackageCandidate = {
  catalogPackage: WimyCatalogV1;
  descriptor: CatalogRegistryPackage;
  fingerprint: string;
  items: readonly CatalogItem[];
};

const DEMO_PROVENANCE = {
  sourceName: "Wimy fictional demo catalog",
  observedAt: "2026-09-02T00:00:00Z",
} as const;

const DEMO_LICENSE = {
  name: "Wimy Project Authored License",
  spdxId: "MIT",
} as const;

const DEMO_PROVIDER = {
  providerId: "00000000-0000-4000-8000-000000000001",
  name: "Wimy Atelier",
  connection: "not_connected",
} as const;

const deepFreeze = <T>(value: T): T => {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach((child) => deepFreeze(child));
    Object.freeze(value);
  }
  return value;
};

const packageKeyFor = (catalogPackage: WimyCatalogV1) =>
  [
    catalogPackage.publisher.publisherId,
    catalogPackage.catalog.catalogId,
    catalogPackage.catalog.version,
  ].join("/");

const stableFingerprint = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(stableFingerprint).join(",")}]`;
  }

  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([first], [second]) => first.localeCompare(second))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableFingerprint(child)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value) ?? "undefined";
};

const packageFingerprint = (catalogPackage: WimyCatalogV1) =>
  stableFingerprint({
    ...catalogPackage,
    items: catalogPackage.items
      .slice()
      .sort((first, second) => first.itemId.localeCompare(second.itemId))
      .map((item) => ({
        ...item,
        variants: item.variants
          .slice()
          .sort((first, second) => first.variantId.localeCompare(second.variantId)),
      })),
  });

const itemIdentityKey = (itemId: string) => `item/${itemId}`;
const variantIdentityKey = (variantId: string) => `variant/${variantId}`;

const metadataForPackageVariant = (
  catalogPackage: WimyCatalogV1,
  item: CatalogPackageItem,
  variantId: string,
): CatalogItemMetadata => ({
  origin: "project-authored",
  publisherId: catalogPackage.publisher.publisherId,
  catalogId: catalogPackage.catalog.catalogId,
  catalogVersion: catalogPackage.catalog.version,
  itemId: item.itemId,
  variantId,
  provider: structuredClone(catalogPackage.provider),
  provenance: structuredClone(catalogPackage.catalog.provenance),
  license: structuredClone(catalogPackage.catalog.license),
});

export const adaptWimyCatalogPackage = (
  catalogPackage: WimyCatalogV1,
): readonly CatalogItem[] =>
  catalogPackage.items
    .slice()
    .sort((first, second) => first.itemId.localeCompare(second.itemId))
    .flatMap((item) =>
      item.variants
        .slice()
        .sort((first, second) => first.variantId.localeCompare(second.variantId))
        .map((variant) =>
          deepFreeze({
            catalogRef: {
              catalogId: catalogPackage.catalog.catalogId,
              productId: variant.variantId,
            },
            snapshot: structuredClone(variant.snapshot),
            metadata: metadataForPackageVariant(
              catalogPackage,
              item,
              variant.variantId,
            ),
          }),
        ),
    );

const adaptDemoCatalog = (seed: readonly CatalogItem[]) =>
  seed.map((item) =>
    deepFreeze({
      ...structuredClone(item),
      metadata: item.metadata ?? {
        origin: "fictional" as const,
        publisherId: "wimy-project-publisher",
        catalogId: item.catalogRef.catalogId,
        catalogVersion: "builtin-v1",
        itemId: item.catalogRef.productId,
        variantId: item.catalogRef.productId,
        provider: structuredClone(DEMO_PROVIDER),
        provenance: structuredClone(DEMO_PROVENANCE),
        license: structuredClone(DEMO_LICENSE),
      },
    }),
  );

const demoDescriptor: CatalogRegistryPackage = {
  packageKey: "wimy-project-publisher/wimy-demo-v1/builtin-v1",
  publisherId: "wimy-project-publisher",
  catalogId: "wimy-demo-v1",
  catalogVersion: "builtin-v1",
  name: "Wimy fictional demo catalog",
  provider: DEMO_PROVIDER,
  provenance: DEMO_PROVENANCE,
  license: DEMO_LICENSE,
  origin: "fictional",
};

export type CatalogRegistry = {
  readonly getItems: () => readonly CatalogItem[];
  readonly getPackages: () => readonly CatalogRegistryPackage[];
  readonly resolveProduct: (productId: string) => ResolvedProduct | undefined;
  readonly importPackages: (
    packages: readonly unknown[],
  ) => CatalogRegistryImportResult;
};

export const createCatalogRegistry = (
  seed: readonly CatalogItem[] = DEMO_CATALOG,
): CatalogRegistry => {
  const demoItems = deepFreeze(adaptDemoCatalog(seed));
  const storedPackages = new Map<string, StoredPackage>();
  storedPackages.set(demoDescriptor.packageKey, {
    descriptor: deepFreeze(structuredClone(demoDescriptor)),
    fingerprint: "wimy-demo-catalog",
    items: demoItems,
  });

  let items: readonly CatalogItem[] = demoItems;
  let descriptors: readonly CatalogRegistryPackage[] = [demoDescriptor];
  let products = new Map(
    items.map((item) => [item.catalogRef.productId, item] as const),
  );

  const refresh = () => {
    const packages = [...storedPackages.values()].sort((first, second) => {
      const firstIsDemo = first.descriptor.packageKey === demoDescriptor.packageKey;
      const secondIsDemo = second.descriptor.packageKey === demoDescriptor.packageKey;
      if (firstIsDemo !== secondIsDemo) return firstIsDemo ? -1 : 1;
      return first.descriptor.packageKey.localeCompare(second.descriptor.packageKey);
    });
    descriptors = deepFreeze(
      packages.map(({ descriptor }) => structuredClone(descriptor)),
    );
    items = deepFreeze(
      packages.flatMap(({ items: packageItems }) => packageItems),
    );
    products = new Map(
      items.map((item) => [item.catalogRef.productId, item] as const),
    );
  };

  const importPackages = (
    packages: readonly unknown[],
  ): CatalogRegistryImportResult => {
    const candidates: PackageCandidate[] = [];
    const stagedPackages = new Map(storedPackages);
    const stagedItemIds = new Set(
      items
        .map(({ metadata }) => metadata?.itemId)
        .filter((itemId): itemId is string => itemId !== undefined)
        .map(itemIdentityKey),
    );
    const stagedVariantIds = new Set(
      items
        .map(({ metadata, catalogRef }) => metadata?.variantId ?? catalogRef.productId)
        .map(variantIdentityKey),
    );
    const stagedCatalogPublishers = new Map(
      descriptors.map(({ catalogId, publisherId }) => [catalogId, publisherId]),
    );
    let duplicatePackages = 0;

    for (const candidate of packages) {
      const parsed = WimyCatalogV1Schema.safeParse(candidate);
      if (!parsed.success) {
        return {
          ok: false,
          code: "INVALID_PACKAGE",
          message: "Catalog import rejected: package validation failed",
        };
      }

      const catalogPackage = parsed.data;
      const packageKey = packageKeyFor(catalogPackage);
      const fingerprint = packageFingerprint(catalogPackage);
      const existing = stagedPackages.get(packageKey);
      if (existing) {
        if (existing.fingerprint === fingerprint) {
          duplicatePackages += 1;
          continue;
        }
        return {
          ok: false,
          code: "PACKAGE_CONFLICT",
          message: `Catalog import rejected: package ${packageKey} conflicts with an existing version`,
          conflicts: [
            {
              code: "PACKAGE_CONFLICT",
              packageKey,
              message: "The same publisher, catalog, and version have different content",
            },
          ],
        };
      }

      const knownPublisher = stagedCatalogPublishers.get(
        catalogPackage.catalog.catalogId,
      );
      if (knownPublisher !== undefined && knownPublisher !== catalogPackage.publisher.publisherId) {
        return {
          ok: false,
          code: "CATALOG_CONFLICT",
          message: `Catalog import rejected: catalog ${catalogPackage.catalog.catalogId} has a different publisher`,
          conflicts: [
            {
              code: "CATALOG_CONFLICT",
              packageKey,
              message: "A catalog identity cannot be claimed by another publisher",
            },
          ],
        };
      }

      const conflictingIdentity = catalogPackage.items
        .flatMap((item) => [
          { kind: "item" as const, key: itemIdentityKey(item.itemId) },
          ...item.variants.map((variant) => ({
            kind: "variant" as const,
            key: variantIdentityKey(variant.variantId),
          })),
        ])
        .find(({ key }) => stagedItemIds.has(key) || stagedVariantIds.has(key));
      if (conflictingIdentity) {
        const isItem = conflictingIdentity.kind === "item";
        const code = isItem ? "ITEM_CONFLICT" : "VARIANT_CONFLICT";
        return {
          ok: false,
          code,
          message: `Catalog import rejected: ${isItem ? "item" : "variant"} identity already exists`,
          conflicts: [
            {
              code,
              packageKey,
              message: `The ${isItem ? "item" : "variant"} identity would be overwritten`,
            },
          ],
        };
      }

      const packageItems = adaptWimyCatalogPackage(catalogPackage);
      for (const item of catalogPackage.items) {
        stagedItemIds.add(itemIdentityKey(item.itemId));
        item.variants.forEach((variant) =>
          stagedVariantIds.add(variantIdentityKey(variant.variantId)),
        );
      }
      stagedCatalogPublishers.set(
        catalogPackage.catalog.catalogId,
        catalogPackage.publisher.publisherId,
      );
      const stored: StoredPackage = {
        descriptor: deepFreeze({
          packageKey,
          publisherId: catalogPackage.publisher.publisherId,
          catalogId: catalogPackage.catalog.catalogId,
          catalogVersion: catalogPackage.catalog.version,
          name: catalogPackage.catalog.name,
          provider: structuredClone(catalogPackage.provider),
          provenance: structuredClone(catalogPackage.catalog.provenance),
          license: structuredClone(catalogPackage.catalog.license),
          origin: "project-authored",
        }),
        fingerprint,
        items: packageItems,
      };
      stagedPackages.set(packageKey, stored);
      candidates.push({
        catalogPackage,
        descriptor: stored.descriptor,
        fingerprint,
        items: packageItems,
      });
    }

    if (candidates.length > 0) {
      candidates.forEach(({ descriptor, fingerprint, items: packageItems }) =>
        storedPackages.set(descriptor.packageKey, {
          descriptor,
          fingerprint,
          items: packageItems,
        }),
      );
      refresh();
    }

    return {
      ok: true,
      addedPackages: candidates.length,
      addedItems: candidates.reduce((count, candidate) => count + candidate.items.length, 0),
      duplicatePackages,
    };
  };

  return {
    getItems: () => items,
    getPackages: () => descriptors,
    resolveProduct: (productId) => {
      const item = products.get(productId);
      return item
        ? {
            catalogRef: structuredClone(item.catalogRef),
            snapshot: structuredClone(item.snapshot),
          }
        : undefined;
    },
    importPackages,
  };
};
