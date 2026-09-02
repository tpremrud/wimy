const RADIANS_PER_DEGREE = Math.PI / 180;
const DEGREES_PER_RADIAN = 180 / Math.PI;
const DAY_MS = 86_400_000;
const J1970 = 2_440_588;
const J2000 = 2_451_545;
const MAX_COORDINATE_DECIMAL_PLACES = 2;
const MAX_PLAN_NORTH_DECIMAL_PLACES = 3;
const LIGHT_DISTANCE = 10;

export type SunStudyScenario = {
  latitude: number;
  longitude: number;
  date: string;
  localTime: string;
  timeZone: string;
  planNorthAzimuthDeg: number;
};

export type ValidatedSunStudyScenario = SunStudyScenario & {
  utcDate: string;
};

export type SunStudyValidation =
  | { valid: true; value: ValidatedSunStudyScenario }
  | {
      valid: false;
      errors: Partial<Record<keyof SunStudyScenario, string>>;
    };

export type SolarPosition = {
  azimuthDeg: number;
  geometricAltitudeDeg: number;
  apparentAltitudeDeg: number;
  utcDate: string;
};

export type SunDirection = {
  isAboveHorizon: boolean;
  toward: [number, number, number];
  lightPosition: [number, number, number];
};

type LocalDateTime = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

const toJulian = (date: Date) => date.valueOf() / DAY_MS - 0.5 + J1970;
const toDays = (date: Date) => toJulian(date) - J2000;

const deltaT = (daysSinceJ2000: number) => {
  const year = 2000 + daysSinceJ2000 / 365.2425;
  if (year < 1920) {
    const t = year - 1900;
    return -2.79 + t * (1.494119 + t * (-0.0598939 + t * (0.0061966 - t * 0.000197)));
  }
  if (year < 1941) {
    const t = year - 1920;
    return 21.2 + t * (0.84493 + t * (-0.0761 + t * 0.0020936));
  }
  if (year < 1961) {
    const t = year - 1950;
    return 29.07 + t * (0.407 + t * (-1 / 233 + t / 2547));
  }
  if (year < 1986) {
    const t = year - 1975;
    return 45.45 + t * (1.067 + t * (-1 / 260 - t / 718));
  }
  if (year < 2005) {
    const t = year - 2000;
    return 63.86 + t * (0.3345 + t * (-0.060374 + t * (0.0017275 + t * (0.000651814 + t * 0.00002373599))));
  }
  if (year < 2050) {
    const t = year - 2000;
    return 62.92 + t * (0.32217 + t * 0.005589);
  }
  const t = (year - 1820) / 100;
  return -20 + 32 * t * t - 0.5628 * (2150 - year);
};

const toDaysTerrestrialTime = (daysSinceJ2000: number) =>
  daysSinceJ2000 + deltaT(daysSinceJ2000) / 86_400;

const sunCoordinates = (daysSinceJ2000TerrestrialTime: number) => {
  const t = daysSinceJ2000TerrestrialTime / 36_525;
  const meanLongitude =
    RADIANS_PER_DEGREE *
    (280.46646 + t * (36_000.76983 + t * 0.0003032));
  const meanAnomaly =
    RADIANS_PER_DEGREE *
    (357.52911 + t * (35_999.05029 - t * 0.0001537));
  const sinMeanAnomaly = Math.sin(meanAnomaly);
  const equationOfCenter =
    RADIANS_PER_DEGREE *
    ((1.914602 - t * (0.004817 + t * 0.000014)) * sinMeanAnomaly +
      (0.019993 - 0.000101 * t) * 2 * sinMeanAnomaly * Math.cos(meanAnomaly) +
      0.000289 * sinMeanAnomaly * (3 - 4 * sinMeanAnomaly * sinMeanAnomaly));
  const ascendingNode =
    RADIANS_PER_DEGREE * (125.04 - 1934.136 * t);
  const apparentLongitude =
    meanLongitude +
    equationOfCenter -
    RADIANS_PER_DEGREE *
      (0.00569 + 0.00478 * Math.sin(ascendingNode));
  const obliquity =
    RADIANS_PER_DEGREE *
      (23.439291 -
        t * (0.0130042 + t * (0.00000016 - t * 0.000000504))) +
    RADIANS_PER_DEGREE * 0.00256 * Math.cos(ascendingNode);

  return {
    rightAscension: Math.atan2(
      Math.cos(obliquity) * Math.sin(apparentLongitude),
      Math.cos(apparentLongitude),
    ),
    declination: Math.asin(
      Math.sin(obliquity) * Math.sin(apparentLongitude),
    ),
  };
};

const siderealTime = (daysSinceJ2000: number, longitudeWest: number) =>
  RADIANS_PER_DEGREE *
    (280.46061837 + 360.98564736629 * daysSinceJ2000) -
  longitudeWest;

const atmosphericRefraction = (altitudeRad: number) => {
  const altitude = Math.max(altitudeRad, 0);
  return 0.0002967 / Math.tan(
    altitude + 0.00312536 / (altitude + 0.08901179),
  );
};

const normalizeDegrees = (degrees: number) =>
  ((degrees % 360) + 360) % 360;

export const calculateSolarPositionAtUtc = (
  date: Date,
  latitude: number,
  longitude: number,
): SolarPosition => {
  if (!Number.isFinite(date.valueOf())) throw new RangeError("Invalid UTC date");
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new RangeError("Latitude must be between -90 and 90 degrees");
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new RangeError("Longitude must be between -180 and 180 degrees");
  }

  const daysSinceJ2000 = toDays(date);
  const coordinates = sunCoordinates(toDaysTerrestrialTime(daysSinceJ2000));
  const longitudeWest = RADIANS_PER_DEGREE * -longitude;
  const latitudeRad = RADIANS_PER_DEGREE * latitude;
  const hourAngle =
    siderealTime(daysSinceJ2000, longitudeWest) - coordinates.rightAscension;
  const geometricAltitudeRad = Math.asin(
    Math.sin(latitudeRad) * Math.sin(coordinates.declination) +
      Math.cos(latitudeRad) *
        Math.cos(coordinates.declination) *
        Math.cos(hourAngle),
  );
  const azimuthRad = Math.atan2(
    Math.sin(hourAngle),
    Math.cos(hourAngle) * Math.sin(latitudeRad) -
      Math.tan(coordinates.declination) * Math.cos(latitudeRad),
  );

  return {
    azimuthDeg: normalizeDegrees(azimuthRad * DEGREES_PER_RADIAN + 180),
    geometricAltitudeDeg: geometricAltitudeRad * DEGREES_PER_RADIAN,
    apparentAltitudeDeg:
      (geometricAltitudeRad + atmosphericRefraction(geometricAltitudeRad)) *
      DEGREES_PER_RADIAN,
    utcDate: date.toISOString(),
  };
};

const parseLocalDateTime = (
  date: string,
  localTime: string,
): LocalDateTime | null => {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(date);
  const timeMatch = /^(\d{2}):(\d{2})$/u.exec(localTime);
  if (!dateMatch || !timeMatch) return null;

  const localDateTime = {
    year: Number(dateMatch[1]),
    month: Number(dateMatch[2]),
    day: Number(dateMatch[3]),
    hour: Number(timeMatch[1]),
    minute: Number(timeMatch[2]),
  };
  if (
    localDateTime.hour > 23 ||
    localDateTime.minute > 59 ||
    localDateTime.month < 1 ||
    localDateTime.month > 12
  ) {
    return null;
  }

  const dateCheck = new Date(
    Date.UTC(
      localDateTime.year,
      localDateTime.month - 1,
      localDateTime.day,
    ),
  );
  return dateCheck.getUTCFullYear() === localDateTime.year &&
    dateCheck.getUTCMonth() === localDateTime.month - 1 &&
    dateCheck.getUTCDate() === localDateTime.day
    ? localDateTime
    : null;
};

const formatLocalDateTime = (instant: Date, timeZone: string): LocalDateTime => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const values = Object.fromEntries(
    parts
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, Number(value)]),
  );
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
  };
};

const timeZoneOffsetMinutes = (instant: Date, timeZone: string) => {
  const part = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
  }).formatToParts(instant).find(({ type }) => type === "timeZoneName")?.value;
  if (!part) throw new RangeError("Timezone offset unavailable");
  const match = /^GMT(?:([+-])(\d{2})(?::?(\d{2}))?)?$/u.exec(part);
  if (!match) throw new RangeError("Timezone offset unavailable");
  if (!match[1]) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3] ?? 0);
  return match[1] === "+" ? minutes : -minutes;
};

const resolveLocalDateTime = (
  localDateTime: LocalDateTime,
  timeZone: string,
): Date => {
  const localEpoch = Date.UTC(
    localDateTime.year,
    localDateTime.month - 1,
    localDateTime.day,
    localDateTime.hour,
    localDateTime.minute,
  );
  const candidateInstants = new Set<number>();
  for (const offsetProbe of [localEpoch - DAY_MS, localEpoch, localEpoch + DAY_MS]) {
    const offset = timeZoneOffsetMinutes(new Date(offsetProbe), timeZone);
    const candidate = localEpoch - offset * 60_000;
    if (
      JSON.stringify(formatLocalDateTime(new Date(candidate), timeZone)) ===
      JSON.stringify(localDateTime)
    ) {
      candidateInstants.add(candidate);
    }
  }
  if (candidateInstants.size !== 1) {
    throw new RangeError("Local time is invalid or ambiguous in this timezone");
  }
  return new Date([...candidateInstants][0]);
};

const hasDecimalPlacesAtMost = (value: number, places: number) =>
  Math.abs(value * 10 ** places - Math.round(value * 10 ** places)) <= 1e-9;

export const validateSunStudyScenario = (
  scenario: SunStudyScenario,
): SunStudyValidation => {
  const errors: Partial<Record<keyof SunStudyScenario, string>> = {};
  if (
    !Number.isFinite(scenario.latitude) ||
    scenario.latitude < -90 ||
    scenario.latitude > 90
  ) {
    errors.latitude = "Latitude must be between -90 and 90 degrees";
  } else if (!hasDecimalPlacesAtMost(scenario.latitude, MAX_COORDINATE_DECIMAL_PLACES)) {
    errors.latitude = "Latitude is limited to two decimal places for coarse input";
  }
  if (
    !Number.isFinite(scenario.longitude) ||
    scenario.longitude < -180 ||
    scenario.longitude > 180
  ) {
    errors.longitude = "Longitude must be between -180 and 180 degrees";
  } else if (!hasDecimalPlacesAtMost(scenario.longitude, MAX_COORDINATE_DECIMAL_PLACES)) {
    errors.longitude = "Longitude is limited to two decimal places for coarse input";
  }
  const localDateTime = parseLocalDateTime(scenario.date, scenario.localTime);
  if (!localDateTime) {
    errors.date = "Use a valid local date and HH:MM time";
    errors.localTime = "Use a valid local date and HH:MM time";
  }
  if (
    !Number.isFinite(scenario.planNorthAzimuthDeg) ||
    scenario.planNorthAzimuthDeg < 0 ||
    scenario.planNorthAzimuthDeg >= 360
  ) {
    errors.planNorthAzimuthDeg = "Plan North must be from 0 to less than 360 degrees";
  } else if (!hasDecimalPlacesAtMost(scenario.planNorthAzimuthDeg, MAX_PLAN_NORTH_DECIMAL_PLACES)) {
    errors.planNorthAzimuthDeg = "Plan North is limited to three decimal places";
  }

  let utcDate: Date | undefined;
  if (localDateTime && !errors.timeZone) {
    try {
      utcDate = resolveLocalDateTime(localDateTime, scenario.timeZone);
    } catch {
      errors.timeZone = "Use a supported IANA timezone and unambiguous local time";
    }
  }
  if (Object.keys(errors).length > 0 || !utcDate) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    value: {
      ...scenario,
      utcDate: utcDate.toISOString(),
    },
  };
};

export const deriveSunDirection = (
  position: Pick<SolarPosition, "azimuthDeg" | "geometricAltitudeDeg" | "apparentAltitudeDeg" | "utcDate">,
  planNorthAzimuthDeg: number,
): SunDirection => {
  if (position.geometricAltitudeDeg <= 0) {
    return { isAboveHorizon: false, toward: [0, 0, 0], lightPosition: [0, 0, 0] };
  }
  const azimuth =
    (position.azimuthDeg - planNorthAzimuthDeg) * RADIANS_PER_DEGREE;
  const altitude = position.apparentAltitudeDeg * RADIANS_PER_DEGREE;
  const toward: [number, number, number] = [
    Math.sin(azimuth) * Math.cos(altitude),
    Math.sin(altitude),
    -Math.cos(azimuth) * Math.cos(altitude),
  ];
  return {
    isAboveHorizon: true,
    toward,
    lightPosition: [
      -toward[0] * LIGHT_DISTANCE,
      -toward[1] * LIGHT_DISTANCE,
      -toward[2] * LIGHT_DISTANCE,
    ],
  };
};
