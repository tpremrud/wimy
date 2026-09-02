# Wimy Room Planning

Wimy describes a room as one portable document that humans and browser agents can inspect and change together.

## Room

**Room Document**:
The complete, portable source of truth for one room layout at a particular revision.
_Avoid_: Project, scene, floor plan

**Room Geometry**:
The single interior volume in which items may be placed. It may be rectangular or use one southeast notch to form an L shape; this does not create a second room.
_Avoid_: Canvas, stage

**Opening**:
A fixed door or window attached to one wall of the room.
_Avoid_: Fixture, obstacle

**Pose**:
An item's center position on the room floor and its quarter-turn orientation.
_Avoid_: Transform, coordinates

## Furniture

**Catalog Item**:
A reusable furniture choice that can be found by category, style, price, and footprint.
_Avoid_: Asset, SKU, product record

**Placed Item**:
One locally identified instance of a catalog item occupying space in a Room Document.
_Avoid_: Object, node, furniture

**Furniture Snapshot**:
The portable geometry and presentation facts copied into a Placed Item so the room remains understandable when its catalog changes.
_Avoid_: Cache, duplicate product

**Fit**:
A deterministic result showing whether a Catalog Item can occupy a Pose without leaving the room or violating a protected clearance.
_Avoid_: Recommendation, aesthetic score

**Retailer Offer**:
A time-bounded, provenance-backed price and availability observation for one Catalog Variant; it is not a purchase or order.
_Avoid_: Retailer Product, listing

**Room Shopping Plan**:
A volatile, retailer-grouped view of current comparable Retailer Offers for the Catalog Variants required by a Room Document.
_Avoid_: Cart, checkout plan

## Change and Sharing

**Room Operation**:
One requested addition, pose change, or removal of a Placed Item.
_Avoid_: Mutation, command

**Room Transaction**:
An ordered group of Room Operations that either all update one expected room revision or make no change.
_Avoid_: Batch, request

**Activity Receipt**:
A human-readable record of who changed the room and what the accepted Room Transaction did.
_Avoid_: Log, notification

**Room Template**:
A named Room Document intended to be copied into a new independent room.
_Avoid_: Preset, shared room

**Wimy File**:
A versioned, human-readable export of a Room Document that can be shared and imported without an account.
_Avoid_: Save file, project file

**Plan North**:
The top edge of the 2D plan and the room-local north direction; it is not a claim about geographic north.

**Orientation Cue**:
The meaningful side of a Placed Item that a person should understand, such as a seating front, bed head, or use side; symmetric items have no fixed direction.

**Door Swing**:
The hinge side and opening direction of a door; a v1 Opening may truthfully report this as unspecified when the Room Document does not carry those facts.
