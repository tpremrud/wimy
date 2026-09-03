import { describe, expect, it, vi } from "vitest";
import { DEMO_CATALOG } from "../room/catalog-data";
import { findFurniture } from "../room/catalog";
import { getTemplate } from "../room/templates";
import {
  adaptWimyCatalogPackage,
  createCatalogRegistry,
} from "./registry";
import type { WimyCatalogV1 } from "./package";

const uuid = (value: number) =>
  `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;

const makePackage = ({
  catalogId = uuid(20),
  itemId = uuid(21),
  publisherId = uuid(22),
  variantId = uuid(23),
  version = "2026.09.02",
  name = "Solstice Project Chair",
}: Partial<{
  catalogId: string;
  itemId: string;
  publisherId: string;
  variantId: string;
  version: string;
  name: string;
}> = {}): WimyCatalogV1 => ({
  format: "wimy-catalog",
  schemaVersion: 1,
  provider: {
    providerId: uuid(24),
    name: "Northstar Home",
    connection: "not_connected",
  },
  publisher: {
    publisherId,
    name: "Wimy Project Studio",
    website: "https://wimy.example.invalid/publisher",
  },
  catalog: {
    catalogId,
    name: "Project Authored Demo Package",
    version,
    license: {
      name: "Wimy Project Authored License",
      spdxId: "MIT",
      url: "https://wimy.example.invalid/license",
    },
    provenance: {
      sourceName: "Wimy Project Studio",
      sourceUrl: "https://wimy.example.invalid/catalog",
      observedAt: "2026-09-02T01:00:00-04:00",
    },
  },
  items: [
    {
      itemId,
      name,
      variants: [
        {
          variantId,
          snapshot: {
            name,
            category: "chair",
            dimensions: { width: 0.6, depth: 0.6, height: 0.84 },
            appearance: { color: "#76543A" },
            styleTags: ["project-authored", "compact"],
          },
          externalIdentifiers: [],
          classifications: [],
        },
      ],
    },
  ],
});

describe("catalog registry", () => {
  it("adapts package variants with complete identity and provenance", () => {
    const catalogPackage = makePackage();

    const [item] = adaptWimyCatalogPackage(catalogPackage);

    expect(item).toMatchObject({
      catalogRef: {
        catalogId: catalogPackage.catalog.catalogId,
        productId: catalogPackage.items[0]?.variants[0]?.variantId,
      },
      snapshot: { name: "Solstice Project Chair" },
      metadata: {
        origin: "project-authored",
        publisherId: catalogPackage.publisher.publisherId,
        catalogId: catalogPackage.catalog.catalogId,
        catalogVersion: catalogPackage.catalog.version,
        provider: catalogPackage.provider,
        itemId: catalogPackage.items[0]?.itemId,
        variantId: catalogPackage.items[0]?.variants[0]?.variantId,
        provenance: catalogPackage.catalog.provenance,
        license: catalogPackage.catalog.license,
      },
    });
  });

  it("keeps the fictional demo catalog available through the registry adapter", () => {
    const registry = createCatalogRegistry();

    expect(registry.getItems().map(({ catalogRef }) => catalogRef)).toEqual(
      DEMO_CATALOG.map(({ catalogRef }) => catalogRef),
    );
    expect(registry.getItems()[0]?.metadata).toMatchObject({
      origin: "fictional",
      catalogId: "wimy-demo-v1",
      provider: {
        name: "Wimy Atelier",
        connection: "not_connected",
      },
    });
  });

  it("merges multiple packages in stable package and identity order", () => {
    const first = makePackage({
      catalogId: uuid(31),
      itemId: uuid(32),
      publisherId: uuid(33),
      variantId: uuid(34),
    });
    const second = makePackage({
      catalogId: uuid(41),
      itemId: uuid(42),
      publisherId: uuid(43),
      variantId: uuid(44),
    });

    const forward = createCatalogRegistry();
    const reverse = createCatalogRegistry();
    expect(forward.importPackages([second, first])).toMatchObject({
      ok: true,
      addedPackages: 2,
      addedItems: 2,
    });
    expect(reverse.importPackages([first, second])).toMatchObject({
      ok: true,
      addedPackages: 2,
      addedItems: 2,
    });

    expect(forward.getItems()).toEqual(reverse.getItems());
    expect(forward.getItems().slice(-2).map(({ metadata }) => metadata?.catalogId)).toEqual([
      first.catalog.catalogId,
      second.catalog.catalogId,
    ]);
  });

  it("treats exact package re-import as an explicit idempotent duplicate", () => {
    const registry = createCatalogRegistry();
    const catalogPackage = makePackage();

    expect(registry.importPackages([catalogPackage])).toMatchObject({
      ok: true,
      addedPackages: 1,
      addedItems: 1,
    });
    const before = registry.getItems();

    expect(registry.importPackages([catalogPackage])).toMatchObject({
      ok: true,
      addedPackages: 0,
      addedItems: 0,
      duplicatePackages: 1,
    });
    expect(registry.getItems()).toBe(before);
  });

  it("treats equivalent package ordering as an idempotent duplicate", () => {
    const catalogPackage = makePackage();
    const secondItem = {
      ...catalogPackage.items[0]!,
      itemId: uuid(29),
      name: "Solstice Project Side Chair",
      variants: [
        {
          ...catalogPackage.items[0]!.variants[0]!,
          variantId: uuid(30),
          snapshot: {
            ...catalogPackage.items[0]!.variants[0]!.snapshot,
            name: "Solstice Project Side Chair",
          },
        },
      ],
    };
    const reordered = {
      ...catalogPackage,
      items: [secondItem, catalogPackage.items[0]!],
    };
    const registry = createCatalogRegistry();

    expect(registry.importPackages([{ ...catalogPackage, items: [catalogPackage.items[0]!, secondItem] }])).toMatchObject({
      ok: true,
      addedPackages: 1,
      addedItems: 2,
    });
    expect(registry.importPackages([reordered])).toMatchObject({
      ok: true,
      addedPackages: 0,
      addedItems: 0,
      duplicatePackages: 1,
    });
  });

  it.each([
    ["same package key with different content", () => makePackage({ name: "Changed Chair" })],
    ["duplicate variant identity", () => makePackage({ catalogId: uuid(24), itemId: uuid(25) })],
    ["duplicate item identity", () => makePackage({ catalogId: uuid(26), itemId: uuid(21), variantId: uuid(27) })],
    ["catalog claimed by another publisher", () => makePackage({ publisherId: uuid(99) })],
  ])("reports %s without overwriting registry state", (_name, makeConflict) => {
    const registry = createCatalogRegistry();
    const original = makePackage();
    registry.importPackages([original]);
    const before = registry.getItems();

    const conflict = makeConflict();
    const result = registry.importPackages([conflict]);

    expect(result).toMatchObject({ ok: false });
    expect(registry.getItems()).toBe(before);
    expect(registry.resolveProduct(original.items[0]!.variants[0]!.variantId)).toMatchObject({
      snapshot: { name: original.items[0]!.variants[0]!.snapshot.name },
    });
  });

  it("validates every package before committing a multi-package import", () => {
    const registry = createCatalogRegistry();
    const valid = makePackage({ catalogId: uuid(51), itemId: uuid(52), variantId: uuid(53) });
    const invalid = { ...makePackage({ catalogId: uuid(61) }), format: "not-wimy" };

    const result = registry.importPackages([valid, invalid]);

    expect(result).toMatchObject({ ok: false, code: "INVALID_PACKAGE" });
    expect(registry.getItems()).toHaveLength(DEMO_CATALOG.length);
  });

  it("does not fetch package URLs and keeps registry search bounded", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const registry = createCatalogRegistry();
    registry.importPackages([
      makePackage({ catalogId: uuid(71), itemId: uuid(72), variantId: uuid(73) }),
      makePackage({ catalogId: uuid(81), itemId: uuid(82), variantId: uuid(83) }),
    ]);

    const matches = findFurniture(
      getTemplate("blank-room"),
      { category: "chair", styleTags: ["project-authored"], limit: 5 },
      registry.getItems(),
    );

    expect(matches).toHaveLength(2);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
