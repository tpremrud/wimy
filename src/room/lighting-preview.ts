import { createStore, type StoreApi } from "zustand/vanilla";
import {
  calculateIllustrativeMoonlightStrength,
  calculateLunarIlluminationAtUtc,
  calculateLunarPositionAtUtc,
  deriveMoonDirection,
} from "./moonlight";
import {
  calculateSolarPositionAtUtc,
  deriveSunDirection,
  validateSunStudyScenario,
  type CelestialDirection,
  type SolarPosition,
  type SunStudyScenario,
  type SunStudyValidation,
} from "./sunlight";

export type LightingPreviewDraft = {
  latitude: string;
  longitude: string;
  date: string;
  localTime: string;
  timeZone: string;
  planNorthAzimuthDeg: string;
};

export const DEFAULT_LIGHTING_PREVIEW_DRAFT: LightingPreviewDraft = {
  latitude: "40.71",
  longitude: "-74.01",
  date: "2026-09-01",
  localTime: "12:00",
  timeZone: "America/New_York",
  planNorthAzimuthDeg: "0",
};

export const minutesFromLocalTime = (localTime: string) => {
  const [hour = "0", minute = "0"] = localTime.split(":");
  return Number(hour) * 60 + Number(minute);
};

export const localTimeFromMinutes = (minutes: number) => {
  const normalized = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
};

const parseNumberInput = (value: string) =>
  value.trim() === "" ? Number.NaN : Number(value);

export const toSunStudyScenario = (
  draft: LightingPreviewDraft,
): SunStudyScenario => ({
  latitude: parseNumberInput(draft.latitude),
  longitude: parseNumberInput(draft.longitude),
  date: draft.date,
  localTime: draft.localTime,
  timeZone: draft.timeZone,
  planNorthAzimuthDeg: parseNumberInput(draft.planNorthAzimuthDeg),
});

const draftValue = (value: string | number) => String(value);

export type LightingPreviewUpdateResult =
  | {
      ok: true;
      revision: number;
      draft: LightingPreviewDraft;
    }
  | {
      ok: false;
      revision: number;
      code: "LIGHTING_REVISION_CONFLICT" | "INVALID_LIGHTING_SCENARIO";
      message: string;
    };

export type LightingPreviewState = {
  readonly draft: LightingPreviewDraft;
  readonly revision: number;
  readonly setHumanDraft: (
    patch: Partial<LightingPreviewDraft>,
  ) => void;
  readonly setScenario: (
    expectedRevision: number,
    patch: Partial<SunStudyScenario>,
  ) => LightingPreviewUpdateResult;
};

export type LightingPreviewStore = Pick<
  StoreApi<LightingPreviewState>,
  "getInitialState" | "getState" | "subscribe"
>;

const sameDraft = (left: LightingPreviewDraft, right: LightingPreviewDraft) =>
  left.latitude === right.latitude &&
  left.longitude === right.longitude &&
  left.date === right.date &&
  left.localTime === right.localTime &&
  left.timeZone === right.timeZone &&
  left.planNorthAzimuthDeg === right.planNorthAzimuthDeg;

export const createLightingPreviewStore = (
  initialDraft: LightingPreviewDraft = DEFAULT_LIGHTING_PREVIEW_DRAFT,
): LightingPreviewStore => {
  const store = createStore<LightingPreviewState>((set, get) => ({
    draft: { ...initialDraft },
    revision: 1,
    setHumanDraft: (patch) => {
      const current = get();
      const draft = { ...current.draft, ...patch };
      if (sameDraft(current.draft, draft)) return;
      if (current.revision === Number.MAX_SAFE_INTEGER) return;
      set({ draft, revision: current.revision + 1 });
    },
    setScenario: (expectedRevision, patch) => {
      const current = get();
      if (expectedRevision !== current.revision) {
        return {
          ok: false,
          revision: current.revision,
          code: "LIGHTING_REVISION_CONFLICT",
          message: `Expected lighting revision ${expectedRevision}, but the preview is at revision ${current.revision}`,
        };
      }
      const draft: LightingPreviewDraft = {
        ...current.draft,
        ...(patch.latitude === undefined ? {} : { latitude: draftValue(patch.latitude) }),
        ...(patch.longitude === undefined ? {} : { longitude: draftValue(patch.longitude) }),
        ...(patch.date === undefined ? {} : { date: patch.date }),
        ...(patch.localTime === undefined ? {} : { localTime: patch.localTime }),
        ...(patch.timeZone === undefined ? {} : { timeZone: patch.timeZone }),
        ...(patch.planNorthAzimuthDeg === undefined
          ? {}
          : { planNorthAzimuthDeg: draftValue(patch.planNorthAzimuthDeg) }),
      };
      const validation = validateSunStudyScenario(toSunStudyScenario(draft));
      if (!validation.valid) {
        return {
          ok: false,
          revision: current.revision,
          code: "INVALID_LIGHTING_SCENARIO",
          message: "Lighting preview scenario is invalid",
        };
      }
      if (current.revision === Number.MAX_SAFE_INTEGER) {
        return {
          ok: false,
          revision: current.revision,
          code: "INVALID_LIGHTING_SCENARIO",
          message: "Lighting preview revision cannot advance further",
        };
      }
      const revision = current.revision + 1;
      set({ draft, revision });
      return { ok: true, revision, draft: { ...draft } };
    },
  }));

  return store;
};

export type LightingPreviewDerived = {
  sun: {
    position: Pick<SolarPosition, "azimuthDeg" | "geometricAltitudeDeg" | "apparentAltitudeDeg">;
    direction: Pick<CelestialDirection, "isAboveHorizon">;
  } | null;
  moon: {
    position: Pick<SolarPosition, "azimuthDeg" | "geometricAltitudeDeg" | "apparentAltitudeDeg">;
    direction: Pick<CelestialDirection, "isAboveHorizon">;
    illuminationFraction: number;
    illuminationPhaseName: string;
    illustrativeStrength: number;
  } | null;
};

export const deriveLightingPreview = (
  draft: LightingPreviewDraft,
): { scenario: SunStudyScenario; validation: SunStudyValidation; derived: LightingPreviewDerived } => {
  const scenario = toSunStudyScenario(draft);
  const validation = validateSunStudyScenario(scenario);
  if (!validation.valid) {
    return { scenario, validation, derived: { sun: null, moon: null } };
  }
  const instant = new Date(validation.value.utcDate);
  const sunPosition = calculateSolarPositionAtUtc(
    instant,
    validation.value.latitude,
    validation.value.longitude,
  );
  const sunDirection = deriveSunDirection(
    sunPosition,
    validation.value.planNorthAzimuthDeg,
  );
  const moonPosition = calculateLunarPositionAtUtc(
    instant,
    validation.value.latitude,
    validation.value.longitude,
  );
  const moonDirection = deriveMoonDirection(
    moonPosition,
    validation.value.planNorthAzimuthDeg,
  );
  const illumination = calculateLunarIlluminationAtUtc(instant);
  return {
    scenario,
    validation,
    derived: {
      sun: {
        position: {
          azimuthDeg: sunPosition.azimuthDeg,
          geometricAltitudeDeg: sunPosition.geometricAltitudeDeg,
          apparentAltitudeDeg: sunPosition.apparentAltitudeDeg,
        },
        direction: { isAboveHorizon: sunDirection.isAboveHorizon },
      },
      moon: {
        position: {
          azimuthDeg: moonPosition.azimuthDeg,
          geometricAltitudeDeg: moonPosition.geometricAltitudeDeg,
          apparentAltitudeDeg: moonPosition.apparentAltitudeDeg,
        },
        direction: { isAboveHorizon: moonDirection.isAboveHorizon },
        illuminationFraction: illumination.fraction,
        illuminationPhaseName: illumination.phaseName,
        illustrativeStrength: calculateIllustrativeMoonlightStrength(
          illumination.fraction,
        ),
      },
    },
  };
};
