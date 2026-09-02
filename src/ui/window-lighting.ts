import type { SunBeam } from "../room/sunlight";

export const MAX_SHADOW_CASTING_WINDOW_LIGHTS = 4;

export const selectStrongestWindowLightIds = (
  beams: readonly SunBeam[],
  limit = MAX_SHADOW_CASTING_WINDOW_LIGHTS,
) => beams
  .map((beam, index) => ({
    beam,
    index,
    contribution: beam.strength * beam.aperture[0] * beam.aperture[1],
  }))
  .sort((left, right) => right.contribution - left.contribution || left.index - right.index)
  .slice(0, limit)
  .sort((left, right) => left.index - right.index)
  .map(({ beam }) => beam.openingId);

export const selectShadowCastingWindowLightIds = (
  beams: readonly SunBeam[],
  enabled: boolean,
) => enabled
  ? selectStrongestWindowLightIds(beams)
  : [];
