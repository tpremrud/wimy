import { describe, expect, it, vi } from "vitest";
import { DEMO_CATALOG } from "./catalog-data";
import {
  CATALOG_PRESENTATION_MANIFEST,
  getCatalogPresentation,
  resolveCatalogPresentationKey,
} from "./catalog-presentation";

describe("catalog presentation manifest", () => {
  it("covers every demo product with immutable project-authored provenance", () => {
    const productIds = DEMO_CATALOG.map(
      ({ catalogRef }) => catalogRef.productId,
    );

    expect(Object.keys(CATALOG_PRESENTATION_MANIFEST)).toEqual(productIds);
    expect(
      new Set(
        Object.values(CATALOG_PRESENTATION_MANIFEST).map(
          ({ productId }) => productId,
        ),
      ).size,
    ).toBe(productIds.length);
    expect(Object.isFrozen(CATALOG_PRESENTATION_MANIFEST)).toBe(true);

    for (const productId of productIds) {
      const presentation = getCatalogPresentation(productId);
      expect(presentation).toMatchObject({
        productId,
        variantId: productId,
        presentationType: "procedural",
        origin: "project-authored",
        license: { spdxId: "MIT", attributionRequired: false },
        approvalStatus: "approved",
        runtimeNetworkRequired: false,
      });
      if (!presentation) throw new Error(`Missing presentation for ${productId}`);
      expect(presentation.maxPrimitiveParts).toBeGreaterThan(0);
      expect(Object.isFrozen(presentation)).toBe(true);
    }

    expect(JSON.stringify(CATALOG_PRESENTATION_MANIFEST)).not.toMatch(
      /https?:\/\//iu,
    );
  });

  it("declares richer authored geometry across eight supported room categories", () => {
    const categoryByProductId = new Map(
      DEMO_CATALOG.map(({ catalogRef, snapshot }) => [
        catalogRef.productId,
        snapshot.category,
      ]),
    );
    const richerCategories = new Set(
      Object.values(CATALOG_PRESENTATION_MANIFEST)
        .filter(({ appearanceKey }) => appearanceKey !== "category-default")
        .map(({ productId }) => categoryByProductId.get(productId)),
    );

    expect(richerCategories).toEqual(
      new Set(["chair", "sofa", "table", "dresser", "bed", "plant", "rug", "desk"]),
    );
  });

  it("keeps every authored presentation bounded and free of asset URLs", () => {
    for (const presentation of Object.values(CATALOG_PRESENTATION_MANIFEST)) {
      expect(presentation.presentationKey).toContain(presentation.variantId);
      expect(presentation.maxPrimitiveParts).toBeLessThanOrEqual(16);
      expect(JSON.stringify(presentation)).not.toMatch(/https?:\/\//iu);
    }
  });

  it("keeps the five new variants in the stable demo catalog order", () => {
    expect(DEMO_CATALOG.map(({ catalogRef }) => catalogRef.productId)).toEqual([
      "ember-nest-chair",
      "cedar-arc-chair",
      "lumen-fold-desk",
      "hearthline-sofa",
      "pebble-drum-table",
      "juniper-rise-plant",
      "saffron-loom-rug",
      "harbor-slat-bed",
      "vale-drawer-dresser",
      "orbit-side-table",
      "dune-shell-lounger",
      "tidal-modular-sofa",
      "cove-shell-chair",
      "tideline-corner-sofa",
      "arclet-dining-table",
      "reed-dining-chair",
      "harbor-console",
    ]);
    expect(DEMO_CATALOG.slice(-5).map(({ snapshot }) => snapshot.name)).toEqual([
      "Cove Shell Chair",
      "Tideline Corner Sofa",
      "Arclet Dining Table",
      "Reed Dining Chair",
      "Harbor Console",
    ]);
  });

  it("selects only declared variants and falls back for imported or unknown items", () => {
    expect(resolveCatalogPresentationKey("cove-shell-chair")).toBe(
      "cove-shell-chair",
    );
    expect(resolveCatalogPresentationKey("missing-imported-product")).toBe(
      "category-default",
    );
    expect(resolveCatalogPresentationKey()).toBe("category-default");
  });

  it("keeps the new certified footprints available to deterministic fit search", async () => {
    const { findFurniture } = await import("./catalog");
    const { getTemplate } = await import("./templates");

    expect(
      findFurniture(
        getTemplate("blank-room"),
        { category: "sofa", styleTags: ["corner"], maxWidth: 2.3 },
        DEMO_CATALOG,
      )[0],
    ).toMatchObject({
      catalogRef: { productId: "tideline-corner-sofa" },
      suggestedPose: { x: 1.2, y: 0.8, rotationDeg: 0 },
    });
  });

  it("does not require a runtime network request to resolve a variant", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    resolveCatalogPresentationKey("tideline-corner-sofa");

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
