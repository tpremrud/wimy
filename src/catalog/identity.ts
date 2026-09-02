export const GTIN_LENGTHS = [8, 12, 13, 14] as const;

const PERMITTED_GTIN_SEPARATOR_PATTERN = /[\t\n\v\f\r -]/gu;
const DIGITS_ONLY_PATTERN = /^\d+$/u;

export const normalizeGtinForComparison = (
  value: string,
): string | undefined => {
  const normalized = value.replace(PERMITTED_GTIN_SEPARATOR_PATTERN, "");

  if (
    !DIGITS_ONLY_PATTERN.test(normalized) ||
    !GTIN_LENGTHS.some((length) => length === normalized.length)
  ) {
    return undefined;
  }

  return normalized.padStart(14, "0");
};

export const isValidGtin = (value: string): boolean => {
  const normalized = normalizeGtinForComparison(value);
  if (!normalized) return false;

  const dataDigits = normalized.slice(0, -1);
  let sum = 0;

  for (let index = dataDigits.length - 1; index >= 0; index -= 1) {
    const digit = dataDigits.charCodeAt(index) - 48;
    const distanceFromRight = dataDigits.length - 1 - index;
    sum += digit * (distanceFromRight % 2 === 0 ? 3 : 1);
  }

  const expectedCheckDigit = (10 - (sum % 10)) % 10;
  const actualCheckDigit = normalized.charCodeAt(normalized.length - 1) - 48;

  return expectedCheckDigit === actualCheckDigit;
};
