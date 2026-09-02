import { describe, expect, it } from "vitest";
import { MAX_WIMY_CATALOG_FILE_BYTES } from "./package";
import {
  parseWimyCatalogFile,
  serializeWimyCatalog,
} from "./package-file";

const uuid = (value: number) =>
  `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;

const makeVariant = (value = 4) => ({
  variantId: uuid(value),
  snapshot: {
    name: "Ember Nest Chair",
    category: "chair" as const,
    dimensions: { width: 0.6, depth: 0.6, height: 0.85 },
    appearance: { color: "#76543a" },
    styleTags: ["warm-modern"],
  },
  externalIdentifiers: [],
  classifications: [],
});

const makeItem = (itemValue = 3, variantValue = itemValue + 1) => ({
  itemId: uuid(itemValue),
  name: "Ember Nest Chair",
  variants: [makeVariant(variantValue)],
});

const makeCatalog = () => ({
  format: "wimy-catalog" as const,
  schemaVersion: 1 as const,
  publisher: {
    publisherId: uuid(1),
    name: "Wimy Studio",
    website: "https://example.com",
  },
  catalog: {
    catalogId: uuid(2),
    name: "Warm Modern Sample Catalog",
    version: "2026.09",
    license: {
      name: "MIT License",
      spdxId: "MIT",
      url: "https://example.com/license",
    },
    provenance: {
      sourceName: "Example Publisher",
      sourceUrl: "https://example.com/catalog",
      observedAt: "2026-09-02T01:00:00-04:00",
    },
  },
  items: [makeItem()],
});

describe("serializeWimyCatalog", () => {
  it("uses schema key order, two-space indentation, and one trailing newline", () => {
    const catalog = makeCatalog();

    const text = serializeWimyCatalog(catalog);

    expect(text).toBe(`${JSON.stringify(catalog, null, 2)}\n`);
    expect(text.endsWith("\n\n")).toBe(false);
  });

  it("rejects canonical exports over the file byte limit", () => {
    const catalog = makeCatalog();
    catalog.items[0]!.variants[0]!.snapshot.styleTags = Array.from(
      { length: 60_000 },
      () => "x".repeat(80),
    );

    expect(() => serializeWimyCatalog(catalog)).toThrow(
      `Wimy catalog files must be at most ${MAX_WIMY_CATALOG_FILE_BYTES} bytes`,
    );
  });
});

describe("parseWimyCatalogFile", () => {
  it("round-trips app-generated packages byte-for-byte", async () => {
    const exported = serializeWimyCatalog(makeCatalog());
    const parsed = await parseWimyCatalogFile(exported);

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(serializeWimyCatalog(parsed.catalog)).toBe(exported);
    }
  });

  it("accepts browser File and Uint8Array inputs", async () => {
    const exported = serializeWimyCatalog(makeCatalog());
    const file = new File([exported], "sample.wimy-catalog", {
      type: "application/json",
    });

    await expect(parseWimyCatalogFile(file)).resolves.toMatchObject({
      ok: true,
    });
    await expect(
      parseWimyCatalogFile(new TextEncoder().encode(exported)),
    ).resolves.toMatchObject({ ok: true });
  });

  it("rejects oversized bytes before attempting JSON parsing", async () => {
    const oversized = new Uint8Array(MAX_WIMY_CATALOG_FILE_BYTES + 1);

    await expect(parseWimyCatalogFile(oversized)).resolves.toMatchObject({
      ok: false,
      code: "FILE_TOO_LARGE",
    });
  });

  it("fails closed on malformed UTF-8", async () => {
    const bytes = new TextEncoder().encode(serializeWimyCatalog(makeCatalog()));
    const publisherNameStart = bytes.indexOf("W".charCodeAt(0));
    expect(publisherNameStart).toBeGreaterThanOrEqual(0);
    bytes[publisherNameStart] = 0x80;

    await expect(parseWimyCatalogFile(bytes)).resolves.toMatchObject({
      ok: false,
      code: "INVALID_JSON",
    });
  });

  it("distinguishes malformed JSON", async () => {
    await expect(parseWimyCatalogFile("{not-json")).resolves.toMatchObject({
      ok: false,
      code: "INVALID_JSON",
    });
  });

  it("distinguishes an unsupported package format", async () => {
    const candidate = { ...makeCatalog(), format: "other-catalog" };

    await expect(
      parseWimyCatalogFile(JSON.stringify(candidate)),
    ).resolves.toMatchObject({ ok: false, code: "UNSUPPORTED_FORMAT" });
  });

  it("distinguishes an unsupported schema version", async () => {
    const candidate = { ...makeCatalog(), schemaVersion: 2 };

    await expect(
      parseWimyCatalogFile(JSON.stringify(candidate)),
    ).resolves.toMatchObject({
      ok: false,
      code: "UNSUPPORTED_SCHEMA_VERSION",
    });
  });

  it("reports safe validation paths", async () => {
    const candidate = makeCatalog();
    candidate.items.push(makeItem(3, 5));

    await expect(
      parseWimyCatalogFile(JSON.stringify(candidate)),
    ).resolves.toMatchObject({
      ok: false,
      code: "INVALID_DOCUMENT",
      path: "items[1].itemId",
    });
  });

  it("rejects under-limit minified input with oversized canonical output", async () => {
    const candidate = makeCatalog();
    candidate.items[0]!.variants[0]!.snapshot.styleTags = Array.from(
      { length: 60_000 },
      () => "x".repeat(80),
    );
    const minified = JSON.stringify(candidate);
    const canonical = `${JSON.stringify(candidate, null, 2)}\n`;
    const encoder = new TextEncoder();

    expect(encoder.encode(minified).byteLength).toBeLessThanOrEqual(
      MAX_WIMY_CATALOG_FILE_BYTES,
    );
    expect(encoder.encode(canonical).byteLength).toBeGreaterThan(
      MAX_WIMY_CATALOG_FILE_BYTES,
    );
    await expect(parseWimyCatalogFile(minified)).resolves.toMatchObject({
      ok: false,
      code: "INVALID_DOCUMENT",
    });
  });
});
