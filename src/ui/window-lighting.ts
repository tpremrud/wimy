import type { SunBeam } from "../room/sunlight";

export const MAX_SHADOW_CASTING_WINDOW_LIGHTS = 4;

export const selectShadowCastingWindowLightIds = (
  beams: readonly SunBeam[],
  enabled: boolean,
) => enabled
  ? beams
      .slice(0, MAX_SHADOW_CASTING_WINDOW_LIGHTS)
      .map(({ openingId }) => openingId)
  : [];
