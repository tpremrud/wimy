import {
  MAX_WIMY_CATALOG_FILE_BYTES,
  WIMY_CATALOG_FORMAT,
  WIMY_CATALOG_SCHEMA_VERSION,
  WimyCatalogV1Schema,
  type WimyCatalogV1,
} from "./package";

export type WimyCatalogFileErrorCode =
  | "FILE_TOO_LARGE"
  | "INVALID_JSON"
  | "UNSUPPORTED_FORMAT"
  | "UNSUPPORTED_SCHEMA_VERSION"
  | "INVALID_DOCUMENT";

export type WimyCatalogFileResult =
  | { ok: true; catalog: WimyCatalogV1 }
  | {
      ok: false;
      code: WimyCatalogFileErrorCode;
      message: string;
      path?: string;
    };

const isJsonObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isUint8Array = (value: unknown): value is Uint8Array =>
  ArrayBuffer.isView(value) &&
  "BYTES_PER_ELEMENT" in value &&
  value.BYTES_PER_ELEMENT === 1;

const getUtf8ByteLength = (value: string) =>
  new TextEncoder().encode(value).byteLength;

const SAFE_PATH_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/u;
const VALIDATION_ISSUE_MESSAGES: Readonly<Record<string, string>> = {
  custom: "Value violates a catalog constraint",
  invalid_element: "Invalid collection value",
  invalid_format: "Value has an invalid format",
  invalid_key: "Invalid object key",
  invalid_type: "Invalid value type",
  invalid_union: "Value does not match an allowed shape",
  invalid_value: "Value is not allowed",
  not_multiple_of: "Value has an invalid increment",
  too_big: "Value exceeds an allowed limit",
  too_small: "Value does not meet an allowed limit",
  unrecognized_keys: "Unexpected field",
};

const formatValidationMessage = (issue?: { code: string }) =>
  issue
    ? `Invalid Wimy catalog: ${VALIDATION_ISSUE_MESSAGES[issue.code] ?? "Invalid value"}`
    : "Invalid Wimy catalog";

const formatValidationPath = (
  path: readonly PropertyKey[],
): string | undefined => {
  let formatted = "";

  for (const segment of path) {
    if (typeof segment === "number" && Number.isSafeInteger(segment)) {
      formatted += `[${segment}]`;
      continue;
    }

    if (
      typeof segment !== "string" ||
      !SAFE_PATH_KEY_PATTERN.test(segment)
    ) {
      return undefined;
    }

    formatted += formatted.length === 0 ? segment : `.${segment}`;
  }

  return formatted || undefined;
};

export const toCanonicalWimyCatalogText = (catalog: WimyCatalogV1) =>
  `${JSON.stringify(catalog, null, 2)}\n`;

const isCanonicalCatalogTooLarge = (catalog: WimyCatalogV1) =>
  getUtf8ByteLength(toCanonicalWimyCatalogText(catalog)) >
  MAX_WIMY_CATALOG_FILE_BYTES;

export const parseWimyCatalogFile = async (
  input: File | Uint8Array | string,
): Promise<WimyCatalogFileResult> => {
  const byteLength =
    typeof input === "string"
      ? getUtf8ByteLength(input)
      : isUint8Array(input)
        ? input.byteLength
        : input.size;

  if (byteLength > MAX_WIMY_CATALOG_FILE_BYTES) {
    return {
      ok: false,
      code: "FILE_TOO_LARGE",
      message: `Wimy catalog files must be at most ${MAX_WIMY_CATALOG_FILE_BYTES} bytes`,
    };
  }

  let text: string;
  if (typeof input === "string") {
    text = input;
  } else {
    try {
      const bytes = isUint8Array(input)
        ? input
        : new Uint8Array(await input.arrayBuffer());
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return {
        ok: false,
        code: "INVALID_JSON",
        message: "The Wimy catalog file is not valid UTF-8 JSON",
      };
    }
  }

  let candidate: unknown;
  try {
    candidate = JSON.parse(text);
  } catch {
    return {
      ok: false,
      code: "INVALID_JSON",
      message: "The Wimy catalog file is not valid JSON",
    };
  }

  if (
    isJsonObject(candidate) &&
    "format" in candidate &&
    candidate.format !== WIMY_CATALOG_FORMAT
  ) {
    return {
      ok: false,
      code: "UNSUPPORTED_FORMAT",
      message: `Expected Wimy catalog format ${WIMY_CATALOG_FORMAT}`,
    };
  }

  if (
    isJsonObject(candidate) &&
    "schemaVersion" in candidate &&
    candidate.schemaVersion !== WIMY_CATALOG_SCHEMA_VERSION
  ) {
    return {
      ok: false,
      code: "UNSUPPORTED_SCHEMA_VERSION",
      message: `Expected Wimy catalog schema version ${WIMY_CATALOG_SCHEMA_VERSION}`,
    };
  }

  const parsedCatalog = WimyCatalogV1Schema.safeParse(candidate);
  if (!parsedCatalog.success) {
    const issue = parsedCatalog.error.issues[0];
    return {
      ok: false,
      code: "INVALID_DOCUMENT",
      message: formatValidationMessage(issue),
      path: issue ? formatValidationPath(issue.path) : undefined,
    };
  }

  if (isCanonicalCatalogTooLarge(parsedCatalog.data)) {
    return {
      ok: false,
      code: "INVALID_DOCUMENT",
      message: `The canonical Wimy catalog exceeds ${MAX_WIMY_CATALOG_FILE_BYTES} bytes`,
    };
  }

  return { ok: true, catalog: parsedCatalog.data };
};

export const serializeWimyCatalog = (catalog: WimyCatalogV1): string => {
  const canonicalCatalog = WimyCatalogV1Schema.parse(catalog);
  const text = toCanonicalWimyCatalogText(canonicalCatalog);

  if (getUtf8ByteLength(text) > MAX_WIMY_CATALOG_FILE_BYTES) {
    throw new Error(
      `Wimy catalog files must be at most ${MAX_WIMY_CATALOG_FILE_BYTES} bytes`,
    );
  }

  return text;
};
