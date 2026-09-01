import type { Opening } from "./document";

export type OpeningSwing = "unspecified" | "not-applicable";

export type OpeningSemantics = {
  kind: Opening["kind"];
  label: string;
  swing: OpeningSwing;
};

export const projectOpeningSemantics = (
  opening: Readonly<Opening>,
): OpeningSemantics => ({
  kind: opening.kind,
  swing: opening.kind === "door" ? "unspecified" : "not-applicable",
  label:
    opening.kind === "door"
      ? `Door on ${opening.wall} wall — swing unspecified`
      : `Window on ${opening.wall} wall`,
});
