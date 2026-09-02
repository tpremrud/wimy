---
status: accepted
---

# Keep location-aware sunlight as an experimental sun study

## Decision

Wimy may pursue a later, opt-in **Sun study (experimental)** that shows an
illustrative direct-sun direction and shadow result under a clear-sky,
unobstructed-room assumption. This is a post-deployment roadmap item and is
not part of the September 3 release path.

The current 3D preview must not be changed to claim that a real room receives
sunlight, daylight, lux, energy performance, or glare. Those claims are
**NO-GO** without a closed aperture model, exterior context, glazing and
surface optical properties, weather or sky data, and a validated daylight
simulation workflow.

## Why

The current Room Document already has useful opening facts: wall, center
offset, width, bottom, and height. It defines room-local Plan North, but it
does not define the bearing of Plan North relative to true north. The current
3D projection renders each wall as a complete box and renders openings as
separate visual hints. The read-only preview also has fixed ambient and
directional lights without a shadow-map caster/receiver chain. Moving that
light would therefore change cosmetic shading, not model sunlight passing
through a window.

The future feature must keep these concepts separate:

- **True north** is the geographic reference used by solar position.
- **Plan North** is the top edge of the 2D plan and its room-local north axis.
- **Furniture orientation** is the item's functional cue derived from its
  existing quarter-turn pose; it is not a second geographic bearing.
- **Window aperture** is a physical rectangular hole in a wall, with sill at
  `bottom` and head at `bottom + height`. A colored opening hint is not an
  aperture.
- **Exterior obstruction** is optional geometry such as a neighboring wall,
  tree mass, balcony, or overhang. With none supplied, the result must say
  that exterior obstructions are not modeled.

## Solar-position evaluation

SunCalc v2 is a suitable small browser adapter if it is deliberately pinned
and reviewed before adding it. Its v2 reference documents apparent altitude in
degrees, azimuth clockwise from true north, and `Date` inputs as absolute UTC
instants. Its release notes state that the rewrite uses Meeus models and was
validated against JPL Horizons and the U.S. Naval Observatory.

The v2 source computes geometric altitude first and then applies an
atmospheric-refraction correction for its public apparent-altitude result.
Those conventions must not be mixed. Two one-off local calculations using the
v2 `getPosition` equations were compared with the official USNO `celnav`
response. The table compares like-for-like geometric altitude: USNO Sun `zn`
azimuth and `hc` geometric altitude against SunCalc's pre-refraction altitude.
The final column records SunCalc's apparent altitude for the future UI; it is
not part of the geometric difference.

| UTC instant; latitude, longitude | USNO `zn` / `hc` (azimuth / geometric altitude) | SunCalc v2 geometric azimuth / altitude | absolute difference | SunCalc v2 apparent altitude |
| --- | ---: | ---: | ---: | ---: |
| 2017-08-21 18:25; 36.8656, -87.4886 | 198.10581° / 63.980867° | 198.10356° / 63.979931° | 0.00225° / 0.00094° | 63.988175° |
| 2026-09-01 16:00; 40.7128, -74.0060 | 155.265528° / 55.096072° | 155.26084° / 55.094602° | 0.00469° / 0.00147° | 55.106389° |

The future UI should label the displayed value **Apparent solar altitude**
and use SunCalc's refraction-corrected value for the illustrative sky/sun
direction. Any diagnostic or test that uses geometric altitude must label it
**Geometric solar altitude** and compare it only with a geometric reference.
Neither value establishes transmitted indoor light.

For Wimy's scene axes (`+x` Plan East, `+y` up, `+z` Plan South), the future
pure conversion seam is:

```text
a = radians(trueAzimuthDeg - planNorthAzimuthDeg)
h = radians(apparentAltitudeDeg)
sunToward = [sin(a) * cos(h), sin(h), -cos(a) * cos(h)]
```

The direct light is disabled at or below the horizon. A Three.js
`DirectionalLight` must use a scene target; its position-to-target direction
models parallel solar rays. Shadows require renderer shadow maps, one or more
shadow-casting lights, explicit caster/receiver flags, and a bounded
orthographic shadow camera.

## Required future input and privacy boundary

The first implementation should accept manual coarse latitude/longitude and
an explicit Plan-North true bearing. It must require a date, local clock time,
and IANA time zone, convert that input to one UTC instant, and display all of
those choices. It must not persist an address, exact GPS position, or a
time-zone-derived location in the v1 Wimy File. It must not call a paid
geocoder or silently send a postal code to a public service. A static,
source-vintaged postal-area lookup can be considered separately after a
privacy and data-provenance review.

The persistent v1 schema, WebMCP contracts, and current read-only 3D scene
remain unchanged by this decision. This decision narrows ADR 0001 only for
view-only analytical inputs: the canonical Room Document remains the sole
authoritative room graph, and all room geometry, openings, and item edits
remain document-backed and transaction-owned. A future opt-in
`SunStudyScenario` may carry bearing, coarse location, time, timezone, and
assumption inputs as ephemeral analytical view state, but it must never be an
alternate room graph or an edit path. It can be discarded on close. If study
state is ever persisted or shared, it requires explicit consent and a
versioned portable extension or envelope; it must not become hidden renderer
state or silent v1 fields. Any export must warn about the generalized location
and included scenario data.

## Geometry, performance, and fallback gates

Before enabling the feature, the renderer needs real wall apertures (wall
segments or an equivalent mesh), explicit sill/head handling, and declared
defaults for glazing, weather, blinds, terrain, horizon, and exterior
obstructions. Optional obstruction boxes may be added later, but their absence
must be visible in the result.

The baseline remains shadows off. Three.js documents that shadow maps render
shadow-casting scene geometry from each shadow light and that larger shadow
frusta reduce effective resolution; a single bounded directional shadow light
should therefore be measured against the no-shadow baseline in a supported
browser before release. Wimy's demand-driven frame loop is compatible with
recomputing a static shadow map only after a room, time, or bearing change, but
this is a design expectation rather than a completed benchmark.

If WebGL, shadow allocation, or a performance budget fails, the safe fallback
is the existing read-only room summary and item list with the experimental
study disabled. A failed or incomplete solar input must never fall back to a
plausible-looking fixed sun and must never produce a positive real-world claim.

## Go/no-go boundary

- **GO later:** an illustrative direct-sun/shadow study, explicitly labeled
  clear-sky and approximate, after the geometry, input, privacy, and measured
  performance gates above are met. Use a pure, tested solar-vector seam and
  RED-to-GREEN tests for cardinal bearings, zenith, below-horizon behavior,
  and Plan-North offsets.
- **NO-GO now:** changing the existing preview light, adding SunCalc to this
  release branch, adding geocoding or location persistence, or presenting a
  shadow patch through the current solid-wall geometry.
- **NO-GO as a browser-preview claim:** illuminance/lux, luminance, glare,
  heat gain, energy performance, annual sun exposure, or an unconditional
  answer that sunlight reaches a real bed or room.

## Primary sources

- [SunCalc v2 README](https://github.com/mourner/suncalc/tree/v2.0.0#sun-position)
  and [v2 release notes](https://github.com/mourner/suncalc/releases), for
  units, conventions, UTC behavior, accuracy statement, and license.
- [SunCalc v2 position source](https://raw.githubusercontent.com/mourner/suncalc/v2.0.0/index.js),
  for the evaluated `getPosition` equations.
- [USNO API documentation](https://aa.usno.navy.mil/data/api.html),
  [USNO altitude/azimuth notes](https://aa.usno.navy.mil/data/AltAz), and the
  [USNO 2017 comparison response](https://aa.usno.navy.mil/api/celnav?date=2017-8-21&time=18:25&coords=36.8656,-87.4886) and
  [USNO 2026 comparison response](https://aa.usno.navy.mil/api/celnav?date=2026-9-1&time=16:00&coords=40.7128,-74.006)
  for true-north azimuth, altitude conventions, and the reference cases.
- [Three.js DirectionalLight](https://threejs.org/docs/pages/DirectionalLight.html)
  and [Three.js shadows guide](https://threejs.org/manual/en/shadows.html),
  for target-based direction and shadow configuration/performance behavior.
- [NOAA solar calculation details](https://gml.noaa.gov/grad/solcalc/calcdetails.html),
  for Meeus-based calculation limits and atmospheric-condition caveats.
