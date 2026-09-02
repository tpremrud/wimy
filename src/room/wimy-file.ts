import {
  MAX_WIMY_FILE_BYTES,
  WIMY_FORMAT,
  WIMY_SCHEMA_VERSION,
  WimyFileV1Schema,
  WimyFileV2Schema,
  toCanonicalWimyFileText,
  type WimyRoomV1,
} from "./document";

export type WimyFileErrorCode =
  | "FILE_TOO_LARGE"
  | "INVALID_JSON"
  | "UNSUPPORTED_FORMAT"
  | "UNSUPPORTED_SCHEMA_VERSION"
  | "INVALID_DOCUMENT";

export type WimyFileResult =
  | { ok: true; room: WimyRoomV1 }
  | { ok: false; code: WimyFileErrorCode; message: string; path?: string };

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
  custom: "Value violates a room constraint",
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
    ? `Invalid Wimy document: ${VALIDATION_ISSUE_MESSAGES[issue.code] ?? "Invalid value"}`
    : "Invalid Wimy document";

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

export const parseWimyFile = async (
  input: File | Uint8Array | string,
): Promise<WimyFileResult> => {
  const byteLength =
    typeof input === "string"
      ? getUtf8ByteLength(input)
      : isUint8Array(input)
        ? input.byteLength
        : input.size;

  if (byteLength > MAX_WIMY_FILE_BYTES) {
    return {
      ok: false,
      code: "FILE_TOO_LARGE",
      message: `Wimy files must be at most ${MAX_WIMY_FILE_BYTES} bytes`,
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
        message: "The Wimy file is not valid UTF-8 JSON",
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
      message: "The Wimy file is not valid JSON",
    };
  }

  if (
    isJsonObject(candidate) &&
    "format" in candidate &&
    candidate.format !== WIMY_FORMAT
  ) {
    return {
      ok: false,
      code: "UNSUPPORTED_FORMAT",
      message: `Expected Wimy format ${WIMY_FORMAT}`,
    };
  }

  if (
    isJsonObject(candidate) &&
    "schemaVersion" in candidate &&
    candidate.schemaVersion !== 1 &&
    candidate.schemaVersion !== WIMY_SCHEMA_VERSION
  ) {
    return {
      ok: false,
      code: "UNSUPPORTED_SCHEMA_VERSION",
      message: `Expected Wimy schema version 1 or ${WIMY_SCHEMA_VERSION}`,
    };
  }

  const parsedEnvelope = isJsonObject(candidate) && candidate.schemaVersion === 1
    ? WimyFileV1Schema.safeParse(candidate)
    : WimyFileV2Schema.safeParse(candidate);
  if (!parsedEnvelope.success) {
    const issue = parsedEnvelope.error.issues[0];
    return {
      ok: false,
      code: "INVALID_DOCUMENT",
      message: formatValidationMessage(issue),
      path: issue ? formatValidationPath(issue.path) : undefined,
    };
  }

  return { ok: true, room: parsedEnvelope.data.room };
};

export const serializeWimyRoom = (room: WimyRoomV1): string => {
  const canonicalEnvelope = WimyFileV2Schema.parse({
    format: WIMY_FORMAT,
    schemaVersion: WIMY_SCHEMA_VERSION,
    room,
  });

  return toCanonicalWimyFileText(canonicalEnvelope.room);
};
