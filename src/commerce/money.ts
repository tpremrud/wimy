export const formatMinorMoney = (
  amountMinor: number,
  currency: string,
  locale = "en-US",
) => {
  try {
    const formatter = new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
    });
    const minorDigits =
      formatter.resolvedOptions().maximumFractionDigits ?? 2;
    return formatter.format(amountMinor / 10 ** minorDigits);
  } catch {
    return `${(amountMinor / 100).toFixed(2)} ${currency}`;
  }
};
