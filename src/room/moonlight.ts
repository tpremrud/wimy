import { deriveSunDirection, type CelestialDirection } from "./sunlight";

const RADIANS_PER_DEGREE = Math.PI / 180;
const DEGREES_PER_RADIAN = 180 / Math.PI;
const DAY_MS = 86_400_000;
const J1970 = 2_440_588;
const J2000 = 2_451_545;
const EARTH_SUN_DISTANCE_KM = 149_598_000;
const MIN_ILLUSTRATIVE_MOONLIGHT_FRACTION = 0.02;
const OBLIQUITY = RADIANS_PER_DEGREE * 23.4397;

export type LunarPosition = {
  azimuthDeg: number;
  geometricAltitudeDeg: number;
  apparentAltitudeDeg: number;
  distanceKm: number;
  utcDate: string;
};

export type LunarPhaseName =
  | "New Moon"
  | "Waxing Crescent"
  | "First Quarter"
  | "Waxing Gibbous"
  | "Full Moon"
  | "Waning Gibbous"
  | "Last Quarter"
  | "Waning Crescent";

export type LunarIllumination = {
  fraction: number;
  phase: number;
  phaseName: LunarPhaseName;
  angleDeg: number;
  utcDate: string;
};

type EquatorialCoordinates = {
  rightAscension: number;
  declination: number;
};

type LunarCoordinates = EquatorialCoordinates & {
  distanceKm: number;
};

const toJulian = (date: Date) => date.valueOf() / DAY_MS - 0.5 + J1970;
const toDays = (date: Date) => toJulian(date) - J2000;
const normalizeDegrees = (degrees: number) => ((degrees % 360) + 360) % 360;

const rightAscension = (longitude: number, latitude: number) =>
  Math.atan2(
    Math.sin(longitude) * Math.cos(OBLIQUITY) -
      Math.tan(latitude) * Math.sin(OBLIQUITY),
    Math.cos(longitude),
  );

const declination = (longitude: number, latitude: number) =>
  Math.asin(
    Math.sin(latitude) * Math.cos(OBLIQUITY) +
      Math.cos(latitude) * Math.sin(OBLIQUITY) * Math.sin(longitude),
  );

const moonCoordinates = (daysSinceJ2000: number): LunarCoordinates => {
  const meanLongitude = RADIANS_PER_DEGREE * (218.316 + 13.176396 * daysSinceJ2000);
  const meanAnomaly = RADIANS_PER_DEGREE * (134.963 + 13.064993 * daysSinceJ2000);
  const meanDistance = RADIANS_PER_DEGREE * (93.272 + 13.22935 * daysSinceJ2000);
  const longitude = meanLongitude + RADIANS_PER_DEGREE * 6.289 * Math.sin(meanAnomaly);
  const latitude = RADIANS_PER_DEGREE * 5.128 * Math.sin(meanDistance);

  return {
    rightAscension: rightAscension(longitude, latitude),
    declination: declination(longitude, latitude),
    distanceKm: 385_001 - 20_905 * Math.cos(meanAnomaly),
  };
};

const sunCoordinates = (daysSinceJ2000: number): EquatorialCoordinates => {
  const meanAnomaly = RADIANS_PER_DEGREE * (357.5291 + 0.98560028 * daysSinceJ2000);
  const center = RADIANS_PER_DEGREE *
    (1.9148 * Math.sin(meanAnomaly) +
      0.02 * Math.sin(2 * meanAnomaly) +
      0.0003 * Math.sin(3 * meanAnomaly));
  const perihelion = RADIANS_PER_DEGREE * 102.9372;
  const longitude = meanAnomaly + center + perihelion + Math.PI;
  return {
    rightAscension: rightAscension(longitude, 0),
    declination: declination(longitude, 0),
  };
};

const siderealTime = (daysSinceJ2000: number, longitudeWest: number) =>
  RADIANS_PER_DEGREE * (280.16 + 360.9856235 * daysSinceJ2000) - longitudeWest;

const atmosphericRefraction = (altitudeRad: number) => {
  const altitude = Math.max(altitudeRad, 0);
  return 0.0002967 / Math.tan(
    altitude + 0.00312536 / (altitude + 0.08901179),
  );
};

const assertInputs = (date: Date, latitude?: number, longitude?: number) => {
  if (!Number.isFinite(date.valueOf())) throw new RangeError("Invalid UTC date");
  if (latitude !== undefined && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)) {
    throw new RangeError("Latitude must be between -90 and 90 degrees");
  }
  if (longitude !== undefined && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180)) {
    throw new RangeError("Longitude must be between -180 and 180 degrees");
  }
};

const phaseName = (phase: number, fraction: number): LunarPhaseName => {
  if (fraction <= 0.02) return "New Moon";
  if (fraction >= 0.98) return "Full Moon";
  if (Math.abs(phase - 0.25) <= 0.025) return "First Quarter";
  if (Math.abs(phase - 0.75) <= 0.025) return "Last Quarter";
  if (phase < 0.25) return "Waxing Crescent";
  if (phase < 0.5) return "Waxing Gibbous";
  if (phase < 0.75) return "Waning Gibbous";
  return "Waning Crescent";
};

export const calculateLunarPositionAtUtc = (
  date: Date,
  latitude: number,
  longitude: number,
): LunarPosition => {
  assertInputs(date, latitude, longitude);
  const daysSinceJ2000 = toDays(date);
  const coordinates = moonCoordinates(daysSinceJ2000);
  const latitudeRad = latitude * RADIANS_PER_DEGREE;
  const longitudeWest = -longitude * RADIANS_PER_DEGREE;
  const hourAngle = siderealTime(daysSinceJ2000, longitudeWest) - coordinates.rightAscension;
  const geometricAltitudeRad = Math.asin(
    Math.sin(latitudeRad) * Math.sin(coordinates.declination) +
      Math.cos(latitudeRad) * Math.cos(coordinates.declination) * Math.cos(hourAngle),
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
    distanceKm: coordinates.distanceKm,
    utcDate: date.toISOString(),
  };
};

export const calculateLunarIlluminationAtUtc = (date: Date): LunarIllumination => {
  assertInputs(date);
  const daysSinceJ2000 = toDays(date);
  const sun = sunCoordinates(daysSinceJ2000);
  const moon = moonCoordinates(daysSinceJ2000);
  const elongation = Math.acos(
    Math.sin(sun.declination) * Math.sin(moon.declination) +
      Math.cos(sun.declination) * Math.cos(moon.declination) *
        Math.cos(sun.rightAscension - moon.rightAscension),
  );
  const incidence = Math.atan2(
    EARTH_SUN_DISTANCE_KM * Math.sin(elongation),
    moon.distanceKm - EARTH_SUN_DISTANCE_KM * Math.cos(elongation),
  );
  const angle = Math.atan2(
    Math.cos(sun.declination) * Math.sin(sun.rightAscension - moon.rightAscension),
    Math.sin(sun.declination) * Math.cos(moon.declination) -
      Math.cos(sun.declination) * Math.sin(moon.declination) *
        Math.cos(sun.rightAscension - moon.rightAscension),
  );
  const fraction = (1 + Math.cos(incidence)) / 2;
  const phase = 0.5 + 0.5 * incidence * (angle < 0 ? -1 : 1) / Math.PI;

  return {
    fraction,
    phase,
    phaseName: phaseName(phase, fraction),
    angleDeg: angle * DEGREES_PER_RADIAN,
    utcDate: date.toISOString(),
  };
};

export const calculateIllustrativeMoonlightStrength = (fraction: number) => {
  if (
    !Number.isFinite(fraction) ||
    fraction <= MIN_ILLUSTRATIVE_MOONLIGHT_FRACTION
  ) {
    return 0;
  }
  const bounded = Math.min(fraction, 1);
  const normalized = (
    (bounded - MIN_ILLUSTRATIVE_MOONLIGHT_FRACTION) /
    (1 - MIN_ILLUSTRATIVE_MOONLIGHT_FRACTION)
  );
  return normalized ** 3;
};

export const deriveMoonDirection = (
  position: Pick<
    LunarPosition,
    "azimuthDeg" | "geometricAltitudeDeg" | "apparentAltitudeDeg" | "utcDate"
  >,
  planNorthAzimuthDeg: number,
): CelestialDirection => deriveSunDirection(position, planNorthAzimuthDeg);
