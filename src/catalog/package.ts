import { z } from "zod";
import { FurnitureSnapshotSchema } from "../room/document";
import { isValidGtin, normalizeGtinForComparison } from "./identity";

export const WIMY_CATALOG_FORMAT = "wimy-catalog" as const;
export const WIMY_CATALOG_SCHEMA_VERSION = 1 as const;
export const MAX_WIMY_CATALOG_FILE_BYTES = 5_000_000;
export const MAX_WIMY_CATALOG_ITEMS = 1_000;
export const MAX_WIMY_CATALOG_VARIANTS_PER_ITEM = 100;

const MAX_EXTERNAL_IDENTIFIERS_PER_VARIANT = 20;
const MAX_CLASSIFICATIONS_PER_VARIANT = 20;

const containsControlCharacter = (value: string) =>
  Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return (
      codePoint !== undefined &&
      (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f))
    );
  });

const boundedText = (maxLength: number) =>
  z
    .string()
    .refine((value) => !containsControlCharacter(value), {
      message: "Control characters are not allowed",
    })
    .transform((value) => value.trim())
    .pipe(z.string().min(1).max(maxLength));

const HttpsUrlSchema = boundedText(2_048).refine((value) => {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}, "Expected an HTTPS URL");

const TimestampSchema = z.string().datetime({ offset: true });
const UuidSchema = z.string().uuid();

export const CatalogLicenseSchema = z
  .object({
    name: boundedText(120),
    spdxId: boundedText(64).optional(),
    url: HttpsUrlSchema.optional(),
  })
  .strict();

export const CatalogProvenanceSchema = z
  .object({
    sourceName: boundedText(160),
    sourceUrl: HttpsUrlSchema.optional(),
    observedAt: TimestampSchema,
  })
  .strict();

export const ExternalIdentifierAssertionSchema = z.enum([
  "publisher-asserted",
  "retailer-asserted",
  "registry-verified",
]);

const GtinValueSchema = z.string().transform((value, context) => {
  const normalized = normalizeGtinForComparison(value);
  if (!normalized || !isValidGtin(normalized)) {
    context.addIssue({
      code: "custom",
      message: "Expected a valid GTIN with a GS1 Mod-10 check digit",
    });
    return z.NEVER;
  }

  return normalized;
});

const GtinIdentifierSchema = z
  .object({
    scheme: z.literal("gtin"),
    value: GtinValueSchema,
    assertion: ExternalIdentifierAssertionSchema,
  })
  .strict();

const MpnIdentifierSchema = z
  .object({
    scheme: z.literal("mpn"),
    brand: boundedText(120),
    value: boundedText(160),
    assertion: ExternalIdentifierAssertionSchema,
  })
  .strict();

const GmnIdentifierSchema = z
  .object({
    scheme: z.literal("gmn"),
    value: boundedText(160),
    assertion: ExternalIdentifierAssertionSchema,
  })
  .strict();

const NamespacedIdentifierSchema = z
  .object({
    scheme: z.literal("other"),
    namespace: HttpsUrlSchema,
    value: boundedText(240),
    assertion: ExternalIdentifierAssertionSchema,
  })
  .strict();

export const ExternalIdentifierSchema = z.discriminatedUnion("scheme", [
  GtinIdentifierSchema,
  MpnIdentifierSchema,
  GmnIdentifierSchema,
  NamespacedIdentifierSchema,
]);

export const ClassificationRefSchema = z
  .object({
    scheme: boundedText(64),
    version: boundedText(64),
    code: boundedText(160),
    label: boundedText(240).optional(),
    uri: HttpsUrlSchema.optional(),
    provenance: CatalogProvenanceSchema,
    license: CatalogLicenseSchema.optional(),
  })
  .strict();

export const CatalogVariantSchema = z
  .object({
    variantId: UuidSchema,
    snapshot: FurnitureSnapshotSchema,
    externalIdentifiers: z
      .array(ExternalIdentifierSchema)
      .max(MAX_EXTERNAL_IDENTIFIERS_PER_VARIANT),
    classifications: z
      .array(ClassificationRefSchema)
      .max(MAX_CLASSIFICATIONS_PER_VARIANT),
  })
  .strict();

export const CatalogPackageItemSchema = z
  .object({
    itemId: UuidSchema,
    name: boundedText(160),
    variants: z
      .array(CatalogVariantSchema)
      .min(1)
      .max(MAX_WIMY_CATALOG_VARIANTS_PER_ITEM),
  })
  .strict();

const CatalogPublisherSchema = z
  .object({
    publisherId: UuidSchema,
    name: boundedText(160),
    website: HttpsUrlSchema.optional(),
  })
  .strict();

export const CatalogProviderSchema = z
  .object({
    providerId: UuidSchema,
    name: boundedText(160),
    connection: z.literal("not_connected"),
  })
  .strict();

const CatalogMetadataSchema = z
  .object({
    catalogId: UuidSchema,
    name: boundedText(160),
    version: boundedText(80),
    license: CatalogLicenseSchema,
    provenance: CatalogProvenanceSchema,
  })
  .strict();

export const WimyCatalogV1Schema = z
  .object({
    format: z.literal(WIMY_CATALOG_FORMAT),
    schemaVersion: z.literal(WIMY_CATALOG_SCHEMA_VERSION),
    provider: CatalogProviderSchema,
    publisher: CatalogPublisherSchema,
    catalog: CatalogMetadataSchema,
    items: z
      .array(CatalogPackageItemSchema)
      .min(1)
      .max(MAX_WIMY_CATALOG_ITEMS),
  })
  .strict()
  .superRefine((catalogPackage, context) => {
    const seenItemIds = new Set<string>();
    const seenVariantIds = new Set<string>();

    catalogPackage.items.forEach((item, itemIndex) => {
      if (seenItemIds.has(item.itemId)) {
        context.addIssue({
          code: "custom",
          message: "Duplicate catalog item identity",
          path: ["items", itemIndex, "itemId"],
        });
      } else {
        seenItemIds.add(item.itemId);
      }

      item.variants.forEach((variant, variantIndex) => {
        if (seenVariantIds.has(variant.variantId)) {
          context.addIssue({
            code: "custom",
            message: "Duplicate catalog variant identity",
            path: ["items", itemIndex, "variants", variantIndex, "variantId"],
          });
        } else {
          seenVariantIds.add(variant.variantId);
        }
      });
    });
  });

export type CatalogLicense = z.infer<typeof CatalogLicenseSchema>;
export type CatalogProvenance = z.infer<typeof CatalogProvenanceSchema>;
export type ExternalIdentifier = z.infer<typeof ExternalIdentifierSchema>;
export type ClassificationRef = z.infer<typeof ClassificationRefSchema>;
export type CatalogVariant = z.infer<typeof CatalogVariantSchema>;
export type CatalogPackageItem = z.infer<typeof CatalogPackageItemSchema>;
export type CatalogProvider = z.infer<typeof CatalogProviderSchema>;
export type WimyCatalogV1 = z.infer<typeof WimyCatalogV1Schema>;
