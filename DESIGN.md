---
name: Wimy
description: A calm, precise room-planning workspace for people and browser agents.
colors:
  room-teal: "#0f5c63"
  deep-room-teal: "#08444a"
  plan-ink: "#182126"
  muted-instruction: "#526067"
  measured-line: "#d5dcda"
  tool-rail: "#f3f6f4"
  clean-surface: "#ffffff"
  drafting-field: "#e9efec"
  page-wash: "#f8faf9"
  focus-amber: "#b34b1e"
  accepted-green: "#23754d"
  caution-ochre: "#a85a22"
  rejected-rust: "#9f321f"
typography:
  display:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.5rem, 3vw, 2.35rem)"
    fontWeight: 700
    lineHeight: 1.04
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.45rem"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.03em"
  title:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.1rem"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "normal"
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 700
    lineHeight: 1.35
    letterSpacing: "0.04em"
rounded:
  compact: "0.25rem"
  control: "0.3rem"
  surface: "0.75rem"
  pill: "999px"
spacing:
  hairline: "0.1rem"
  compact: "0.35rem"
  control: "0.55rem"
  cluster: "0.75rem"
  surface: "1rem"
  frame: "1.25rem"
components:
  button-primary:
    backgroundColor: "{colors.room-teal}"
    textColor: "{colors.clean-surface}"
    rounded: "{rounded.control}"
    padding: "0.35rem 0.55rem"
    height: "2.15rem"
  button-primary-hover:
    backgroundColor: "{colors.deep-room-teal}"
    textColor: "{colors.clean-surface}"
    rounded: "{rounded.control}"
  button-secondary:
    backgroundColor: "{colors.clean-surface}"
    textColor: "{colors.deep-room-teal}"
    rounded: "{rounded.control}"
    padding: "0.35rem 0.55rem"
    height: "2.15rem"
  field:
    backgroundColor: "{colors.clean-surface}"
    textColor: "{colors.plan-ink}"
    rounded: "{rounded.control}"
    padding: "0.45rem 0.55rem"
    height: "2.35rem"
  floating-surface:
    backgroundColor: "{colors.clean-surface}"
    textColor: "{colors.plan-ink}"
    rounded: "{rounded.surface}"
    padding: "1rem"
---

# Design System: Wimy

## Overview

**Creative North Star: "The Quiet Planning Table"**

Wimy should feel like a well-made drafting table placed in a calm room: the plan occupies the center, measured lines establish trust, and compact instruments wait at the edge until they are needed. The interface is visually restrained but not sterile. Deep teal carries deliberate action, warm amber makes keyboard focus unmistakable, and lightly tinted surfaces separate tools from the room without turning every section into a card.

Density is purposeful. Desktop screens should remain within the viewport, with catalog and activity regions owning their scroll instead of the entire document. Floating panels are compact review surfaces, not miniature pages. The system explicitly rejects cluttered retail portals, unrelated card dashboards, whole-page scrolling for primary tools, opaque navigation, invisible agent actions, and commerce language that blurs planning items with retailer cart lines.

**Key Characteristics:**

- Room-first composition with tools held to the edges.
- Compact controls, short labels, and visible revision or state cues.
- Mostly flat surfaces separated by 1px measured lines and pale tonal shifts.
- Deep teal actions used selectively against white and drafting neutrals.
- Explicit focus, warning, provenance, and human-confirmation states.

## Colors

The palette combines cool drafting neutrals with one restrained architectural teal; semantic colors appear only when state must be understood.

### Primary

- **Room Teal** (#0f5c63): Primary actions, selected states, and the few controls that advance the room workflow.
- **Deep Room Teal** (#08444a): Hover, pressed, active, and brand-title emphasis.

### Secondary

- **Focus Amber** (#b34b1e): The universal 3px visible-focus outline. It is interaction infrastructure, not decoration.
- **Accepted Green** (#23754d): Registered tools and accepted states.
- **Caution Ochre** (#a85a22): Degraded or attention states.
- **Rejected Rust** (#9f321f): Errors and rejected operations.

### Neutral

- **Plan Ink** (#182126): Primary text and the dark selected-item control dock.
- **Muted Instruction** (#526067): Secondary copy, metadata, and explanatory labels.
- **Measured Line** (#d5dcda): Default 1px dividers, borders, and control outlines.
- **Tool Rail** (#f3f6f4): Catalog and supporting-tool surfaces.
- **Drafting Field** (#e9efec): The 2D and 3D room work surface.
- **Page Wash** (#f8faf9): App background behind the workspace.
- **Clean Surface** (#ffffff): Controls, panels, drawers, and the primary room container.

### Named Rules

**The One Deliberate Accent Rule.** Room Teal identifies action or selection; do not spread it across large decorative surfaces.

**The State Is More Than Color Rule.** Every accepted, warning, error, or WebMCP state also needs text, an icon, or a semantic label.

## Typography

**Display Font:** Inter (with ui-sans-serif, system-ui, sans-serif fallback)

**Body Font:** Inter (with ui-sans-serif, system-ui, sans-serif fallback)

**Label/Mono Font:** Inter for labels; the platform monospace stack is reserved for tool identifiers and machine-readable values.

**Character:** A single utilitarian sans-serif keeps room facts, catalog metadata, and actions visually compatible. Hierarchy comes from weight, compact scale shifts, and modest negative tracking rather than display-font theatrics.

### Hierarchy

- **Display** (700, clamp(1.5rem, 3vw, 2.35rem), 1.04): The current room name when the workspace needs a dominant anchor.
- **Headline** (700, 1.45rem, 1.15): Brand lockup and major surface headings.
- **Title** (700, 1.1rem, 1.25): Rail panels, catalog sections, and focused object groups.
- **Body** (400, 0.875rem, 1.45): Instructions and explanations; keep prose near 56ch and prefer shorter operational language.
- **Label** (700, 0.75rem, 0.04em): Compact controls and metadata. Uppercase is reserved for kickers and structural labels, never paragraph copy.

### Named Rules

**The Operational Copy Rule.** Prefer concrete verbs and exact nouns—Inspect, Find substitutes, Replace, Revision—over promotional or ambiguous labels.

## Elevation

Wimy is flat by default. Borders and tonal layering establish most hierarchy. Shadows are structural signals reserved for surfaces that physically sit above the workspace: floating drawers, the WebMCP tool list, and the selected-item control dock.

### Shadow Vocabulary

- **Floating Panel** (`box-shadow: 0 4px 12px rgb(24 33 38 / 10%)`): Share, cart, guidance, activity, and sign-in panels.
- **Compact Popover** (`box-shadow: 0 0.25rem 0.5rem rgb(20 42 38 / 15%)`): The WebMCP tool inventory.
- **Control Dock** (`box-shadow: 0 4px 8px rgb(24 33 38 / 22%)`): The bottom-centered controls attached to a selected room item.

### Named Rules

**The Flat-Until-Floating Rule.** Cards and rails stay flat at rest; only a surface that overlays the room earns a shadow.

## Components

### Buttons

- **Shape:** Compact rectangular controls use a 0.3rem radius; the WebMCP status trigger alone uses a 999px pill.
- **Primary:** Room Teal background, Clean Surface text, 1px teal border, 0.35rem 0.55rem padding, and a minimum 2.15rem height.
- **Hover / Focus:** Hover deepens to Deep Room Teal. Focus uses a 3px Focus Amber outline with a 2px offset; selected controls pair color with `aria-pressed`, `aria-selected`, or `aria-expanded`.
- **Secondary / Ghost:** Clean Surface background with Measured Line border and Deep Room Teal text. Hover uses a pale teal tint rather than a new accent.

### Chips

- **Style:** Small count and filter chips use pale teal fill, Deep Room Teal text, compact padding, and pill geometry.
- **State:** Selection must change text or accessible state in addition to color.

### Cards / Containers

- **Corner Style:** Workspace rails remain square or nearly square; only floating surfaces use the 0.75rem surface radius.
- **Background:** Clean Surface for the primary room and transient panels; Tool Rail for catalog support; Drafting Field for the canvas.
- **Shadow Strategy:** Follow the Flat-Until-Floating Rule.
- **Border:** One 1px Measured Line border is the default separator.
- **Internal Padding:** 0.75rem to 1rem; avoid nesting padded cards inside padded cards.

### Inputs / Fields

- **Style:** Clean Surface fill, 1px Measured Line stroke, 0.3rem radius, and 0.45rem 0.55rem padding.
- **Focus:** The universal 3px Focus Amber outline with 2px offset.
- **Error / Disabled:** Error copy uses Rejected Rust and a semantic alert. Disabled states retain readable text and identify why the action is unavailable whenever that reason is not obvious.

### Navigation

Header controls remain compact and right-aligned on desktop. The left rail uses Add, Placed, and Favorites as the stable workspace tabs. Active states use a pale surface plus Deep Room Teal text and semantic selection state. On narrow screens, controls may wrap or stack, but room viewing remains ahead of supporting lists.

### Room Canvas and Control Dock

The room canvas is the visual anchor and should consume the remaining viewport after the compact header. A selected item exposes one bottom-centered dark Control Dock with concise actions; controls should not require a detour through the Placed tab for ordinary transforms.

### Floating Review Panels

Share, cart, guidance, activity, and sign-in surfaces align inside the viewport with nonzero edge margins, dismiss on outside interaction or Escape where appropriate, and own their internal scroll. They should show only the information needed to review the current action.

## Do's and Don'ts

### Do:

- **Do** preserve the largest clear area for the room and keep supporting tools at the edges.
- **Do** keep desktop primary workflows within the viewport; give catalog and panel contents their own bounded scrolling regions.
- **Do** use 1px Measured Line borders and pale tonal differences before adding a shadow.
- **Do** make human and browser-agent actions legible through revision, receipt, warning, and tool-state text.
- **Do** keep planning items, canonical catalog identity, retailer offers, cart lines, and checkout confirmation visually and verbally distinct.
- **Do** retain the 3px Focus Amber outline and reduced-motion behavior.

### Don't:

- **Don't** make Wimy feel like a cluttered retail portal, a dashboard made of unrelated cards, or a page that requires whole-document scrolling to reach primary tools.
- **Don't** require authentication or a database merely to create, import, export, or share a room.
- **Don't** imply that a planning item is already a retailer cart line or invent a universal checkout across retailers.
- **Don't** hide product provenance or use licensed, copied, scraped, or remotely fetched assets without explicit authorization.
- **Don't** bury core room controls behind opaque navigation or let agent actions become invisible to the person reviewing the room.
- **Don't** add decorative gradients, oversized display typography, glass effects, or accent-heavy surfaces that compete with the room.
