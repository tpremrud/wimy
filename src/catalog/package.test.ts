import { describe, expect, it } from "vitest";
import {
  MAX_WIMY_CATALOG_ITEMS,
  MAX_WIMY_CATALOG_VARIANTS_PER_ITEM,
  WimyCatalogV1Schema,
} from "./package";

const uuid = (value: number) =>
  `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;

const license = {
  name: "MIT License",
  spdxId: "MIT",
  url: "https://example.com/license",
};

const provenance = {
  sourceName: "Example Publisher",
  sourceUrl: "https://example.com/catalog",
  observedAt: "2026-09-02T01:00:00-04:00",
};

const makeVariant = (value = 4) => ({
  variantId: uuid(value),
  snapshot: {
    name: "Ember Nest Chair",
    category: "chair",
    dimensions: { width: 0.6, depth: 0.6, height: 0.85 },
    appearance: { color: "#76543a" },
    styleTags: ["warm-modern"],
  },
  externalIdentifiers: [
    {
      scheme: "gtin",
      value: "1234-5670",
      assertion: "publisher-asserted",
    },
    {
      scheme: "mpn",
      brand: "Wimy Studio",
      value: "EMBER-CHAIR-WALNUT",
      assertion: "registry-verified",
    },
    {
      scheme: "gmn",
      value: "WIMY-EMBER-CHAIR",
      assertion: "retailer-asserted",
    },
    {
      scheme: "other",
      namespace: "https://example.com/identifiers",
      value: "EMBER-CHAIR-2026",
      assertion: "publisher-asserted",
    },
  ],
  classifications: [
    {
      scheme: "GPC",
      version: "2025.1",
      code: "10002192",
      label: "Chairs",
      uri: "https://example.com/gpc/10002192",
      provenance,
      license,
    },
  ],
});

const makeItem = (itemValue = 3, variantValue = itemValue + 1) => ({
  itemId: uuid(itemValue),
  name: "Ember Nest Chair",
  variants: [makeVariant(variantValue)],
});

const makeCatalog = () => ({
  format: "wimy-catalog",
  schemaVersion: 1,
  publisher: {
    publisherId: uuid(1),
    name: "Wimy Studio",
    website: "https://example.com",
  },
  catalog: {
    catalogId: uuid(2),
    name: "Warm Modern Sample Catalog",
    version: "2026.09",
    license,
    provenance,
  },
  items: [makeItem()],
});

describe("WimyCatalogV1Schema", () => {
  it("parses a strict catalog package and normalizes exact identifiers", () => {
    const parsed = WimyCatalogV1Schema.parse(makeCatalog());

    expect(parsed).toMatchObject({
      format: "wimy-catalog",
      schemaVersion: 1,
      publisher: { publisherId: uuid(1) },
      catalog: { catalogId: uuid(2) },
      items: [
        {
          itemId: uuid(3),
          variants: [
            {
              variantId: uuid(4),
              snapshot: { category: "chair" },
              externalIdentifiers: [
                { scheme: "gtin", value: "00000012345670" },
                {
                  scheme: "mpn",
                  brand: "Wimy Studio",
                  value: "EMBER-CHAIR-WALNUT",
                },
                { scheme: "gmn", value: "WIMY-EMBER-CHAIR" },
                {
                  scheme: "other",
                  namespace: "https://example.com/identifiers",
                  value: "EMBER-CHAIR-2026",
                },
              ],
              classifications: [
                {
                  scheme: "GPC",
                  version: "2025.1",
                  code: "10002192",
                  provenance,
                  license,
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it.each([
    ["publisher.publisherId", { publisherId: "publisher-1" }],
    ["catalog.catalogId", { catalogId: "catalog-1" }],
  ])("rejects a non-UUID %s", (_path, override) => {
    const candidate = makeCatalog();
    if ("publisherId" in override) {
      candidate.publisher.publisherId = override.publisherId;
    } else {
      candidate.catalog.catalogId = override.catalogId;
    }

    expect(WimyCatalogV1Schema.safeParse(candidate).success).toBe(false);
  });

  it("rejects invalid GTIN check digits", () => {
    const candidate = makeCatalog();
    candidate.items[0]!.variants[0]!.externalIdentifiers[0]!.value =
      "12345671";

    expect(WimyCatalogV1Schema.safeParse(candidate).success).toBe(false);
  });

  it("requires both brand and value for an MPN assertion", () => {
    const candidate = makeCatalog();
    const identifier = candidate.items[0]!.variants[0]!
      .externalIdentifiers[1]!;
    Reflect.deleteProperty(identifier, "brand");

    expect(WimyCatalogV1Schema.safeParse(candidate).success).toBe(false);
  });

  it("rejects unsupported assertion states", () => {
    const candidate = makeCatalog();
    candidate.items[0]!.variants[0]!.externalIdentifiers[0]!.assertion =
      "unverified";

    expect(WimyCatalogV1Schema.safeParse(candidate).success).toBe(false);
  });

  it("requires provenance on each classification reference", () => {
    const candidate = makeCatalog();
    Reflect.deleteProperty(
      candidate.items[0]!.variants[0]!.classifications[0]!,
      "provenance",
    );

    expect(WimyCatalogV1Schema.safeParse(candidate).success).toBe(false);
  });

  it("rejects non-HTTPS external references", () => {
    const candidate = makeCatalog();
    candidate.publisher.website = "http://example.com";

    expect(WimyCatalogV1Schema.safeParse(candidate).success).toBe(false);
  });

  it("accepts multiple distinct variants for one item family", () => {
    const candidate = makeCatalog();
    candidate.items[0]!.variants.push(makeVariant(5));

    const result = WimyCatalogV1Schema.safeParse(candidate);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items[0]?.variants).toHaveLength(2);
    }
  });

  it("rejects unknown fields at nested object boundaries", () => {
    const candidate = makeCatalog();
    Object.assign(candidate.items[0]!.variants[0]!, { retailerPrice: 499 });

    const result = WimyCatalogV1Schema.safeParse(candidate);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["items", 0, "variants", 0]);
    }
  });

  it("reports the later duplicate item UUID at its identity path", () => {
    const candidate = makeCatalog();
    candidate.items.push(makeItem(3, 5));

    const result = WimyCatalogV1Schema.safeParse(candidate);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({ path: ["items", 1, "itemId"] }),
      );
    }
  });

  it("reports a globally duplicate variant UUID at the later variant path", () => {
    const candidate = makeCatalog();
    candidate.items.push(makeItem(5, 4));

    const result = WimyCatalogV1Schema.safeParse(candidate);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({
          path: ["items", 1, "variants", 0, "variantId"],
        }),
      );
    }
  });

  it("bounds item families", () => {
    const candidate = makeCatalog();
    candidate.items = Array.from(
      { length: MAX_WIMY_CATALOG_ITEMS + 1 },
      (_, index) => makeItem(10 + index * 2, 11 + index * 2),
    );

    expect(WimyCatalogV1Schema.safeParse(candidate).success).toBe(false);
  });

  it("bounds variants per item", () => {
    const candidate = makeCatalog();
    candidate.items[0]!.variants = Array.from(
      { length: MAX_WIMY_CATALOG_VARIANTS_PER_ITEM + 1 },
      (_, index) => makeVariant(100 + index),
    );

    expect(WimyCatalogV1Schema.safeParse(candidate).success).toBe(false);
  });

  it.each([
    ["license", (candidate: ReturnType<typeof makeCatalog>) => {
      Reflect.deleteProperty(candidate.catalog, "license");
    }],
    ["provenance", (candidate: ReturnType<typeof makeCatalog>) => {
      Reflect.deleteProperty(candidate.catalog, "provenance");
    }],
  ])("requires package %s metadata", (_field, mutate) => {
    const candidate = makeCatalog();
    mutate(candidate);

    expect(WimyCatalogV1Schema.safeParse(candidate).success).toBe(false);
  });
});
