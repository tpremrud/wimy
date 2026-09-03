import { describe, expect, it } from "vitest";
import {
  createLightingPreviewStore,
  DEFAULT_LIGHTING_PREVIEW_DRAFT,
  deriveLightingPreview,
} from "./lighting-preview";

describe("lighting preview store", () => {
  it("keeps an ephemeral revision-safe scenario separate from room state", () => {
    const store = createLightingPreviewStore();
    const initial = store.getState();

    expect(initial.revision).toBe(1);
    expect(initial.draft).toEqual(DEFAULT_LIGHTING_PREVIEW_DRAFT);

    const accepted = initial.setScenario(1, {
      date: "2026-09-01",
      localTime: "08:00",
    });

    expect(accepted).toMatchObject({ ok: true, revision: 2 });
    expect(store.getState().draft.localTime).toBe("08:00");
    expect(store.getState().revision).toBe(2);
    expect(store.getState().setScenario(1, { localTime: "09:00" })).toEqual({
      ok: false,
      revision: 2,
      code: "LIGHTING_REVISION_CONFLICT",
      message: "Expected lighting revision 1, but the preview is at revision 2",
    });
  });

  it("rejects invalid tool scenarios without changing the draft or revision", () => {
    const store = createLightingPreviewStore();
    expect(store.getState().setScenario(1, { latitude: 40.711 })).toMatchObject({
      ok: false,
      code: "INVALID_LIGHTING_SCENARIO",
      revision: 1,
    });
    expect(store.getState().draft).toEqual(DEFAULT_LIGHTING_PREVIEW_DRAFT);
    expect(store.getState().revision).toBe(1);
  });

  it("allows human drafts to show validation without inventing derived light", () => {
    const store = createLightingPreviewStore();
    store.getState().setHumanDraft({ latitude: "91" });

    expect(store.getState().revision).toBe(2);
    expect(deriveLightingPreview(store.getState().draft)).toMatchObject({
      validation: { valid: false },
      derived: { sun: null, moon: null },
    });
  });

  it("marks below-horizon positions honestly", () => {
    const result = deriveLightingPreview({
      ...DEFAULT_LIGHTING_PREVIEW_DRAFT,
      date: "2026-09-01",
      localTime: "00:00",
    });

    expect(result.validation.valid).toBe(true);
    expect(result.derived.sun?.direction.isAboveHorizon).toBe(false);
  });
});
