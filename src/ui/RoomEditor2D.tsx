import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";
import { useStore } from "zustand";
import type { EntityId, Opening, Pose, RotationDeg, WimyRoomV1 } from "../room/document";
import {
  moveOpeningAlongWall,
  resizeAnchoredRoom,
} from "../room/direct-manipulation";
import { roomUsableWallLength } from "../room/geometry";
import { findNearestLegalRotationPose } from "../room/placement";
import {
  projectRoomToPlan,
  screenPointToRoom,
  type PlanProjection,
  type PlanViewport,
} from "../room/projection";
import type { RoomStore } from "../room/store";
import type { RoomTransactionResult } from "../room/transaction";

const DEFAULT_ROOM_EDITOR_VIEWPORT: PlanViewport = {
  width: 720,
  height: 520,
  padding: 52,
};

type RoomEditor2DProps = {
  store: RoomStore;
  viewport?: PlanViewport;
};

type RuntimeRoom = ReturnType<RoomStore["getState"]>["room"];

type DragState = {
  owner: RoomStore;
  itemId: EntityId;
  pointerId: number;
  startRevision: number;
  startPose: Pose;
  startRoomPoint: { x: number; y: number };
  startProjection: PlanProjection;
  previewPose: Pose;
};

type ArchitecturalDragState = {
  owner: RoomStore;
  pointerId: number;
  startRevision: number;
  startRoom: RuntimeRoom;
  startRoomPoint: { x: number; y: number };
  startProjection: PlanProjection;
  previewRoom: RuntimeRoom;
  interaction:
    | {
        kind: "opening";
        openingId: EntityId;
        wall: Opening["wall"];
        startCenterOffset: number;
      }
    | {
        kind: "dimension";
        dimension: "width" | "depth";
        startValue: number;
      };
};

type LocalSelection = {
  owner: RoomStore;
  itemId: EntityId;
};

type PoseDraft = {
  owner: RoomStore;
  itemId: EntityId;
  x: string;
  y: string;
  rotationDeg: RotationDeg;
};

type PendingPointerClick = {
  owner: RoomStore;
  itemId: EntityId;
  pointerId: number;
  suppress: boolean;
};

type HumanActionResult = {
  attempt: number;
  owner: RoomStore;
  text: string;
};

const roundMillimeters = (value: number) => {
  const rounded = Math.round(value * 1_000) / 1_000;
  return Object.is(rounded, -0) ? 0 : rounded;
};

export function RoomEditor2D({
  store,
  viewport = DEFAULT_ROOM_EDITOR_VIEWPORT,
}: RoomEditor2DProps) {
  const { room, revision } = useStore(store);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [architecturalDrag, setArchitecturalDrag] =
    useState<ArchitecturalDragState | null>(null);
  const [selection, setSelection] = useState<LocalSelection | null>(null);
  const [poseDraft, setPoseDraft] = useState<PoseDraft | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const architecturalDragRef = useRef<ArchitecturalDragState | null>(null);
  const selectionRef = useRef<LocalSelection | null>(null);
  const pendingPointerClickRef = useRef<PendingPointerClick | null>(null);
  const pendingFocusItemIdRef = useRef<EntityId | null>(null);
  const roomPlanRef = useRef<SVGSVGElement>(null);
  const interactionOwnerRef = useRef(store);
  const [humanActionResult, setHumanActionResult] =
    useState<HumanActionResult | null>(null);
  const selectedItemId = selection?.owner === store ? selection.itemId : null;

  useLayoutEffect(() => {
    if (interactionOwnerRef.current === store) return;

    const pendingPointerClick = pendingPointerClickRef.current;
    if (pendingPointerClick) {
      pendingPointerClickRef.current = {
        ...pendingPointerClick,
        suppress: true,
      };
    }
    interactionOwnerRef.current = store;
    dragRef.current = null;
    architecturalDragRef.current = null;
    selectionRef.current = null;
    setDrag(null);
    setArchitecturalDrag(null);
    setSelection(null);
    setPoseDraft(null);
    setHumanActionResult(null);
  }, [store]);

  useLayoutEffect(
    () =>
      store.subscribe((current, previous) => {
        const receipt = current.receipts[0];
        if (
          !receipt ||
          receipt === previous.receipts[0] ||
          receipt.status !== "accepted"
        ) {
          return;
        }

        const interactionWasInvalidated = (itemId: EntityId) =>
          receipt.changeType === "replace" ||
          receipt.removedItemIds.includes(itemId);
        const activeElement = document.activeElement;
        const focusedItemId =
          activeElement instanceof Element
            ? activeElement
                .closest("[data-item-id]")
                ?.getAttribute("data-item-id")
            : null;
        const focusedActionItemId =
          activeElement instanceof Element &&
          activeElement.closest(".room-item-actions") !== null
            ? selectionRef.current?.itemId
            : undefined;
        const invalidatedFocusItemId = focusedItemId ?? focusedActionItemId;
        if (
          invalidatedFocusItemId &&
          interactionWasInvalidated(invalidatedFocusItemId)
        ) {
          pendingFocusItemIdRef.current = invalidatedFocusItemId;
        }
        const pendingPointerClick = pendingPointerClickRef.current;
        if (
          pendingPointerClick?.owner === store &&
          interactionWasInvalidated(pendingPointerClick.itemId)
        ) {
          pendingPointerClickRef.current = {
            ...pendingPointerClick,
            suppress: true,
          };
        }
        const selectionState = selectionRef.current;
        if (
          selectionState?.owner === store &&
          interactionWasInvalidated(selectionState.itemId)
        ) {
          selectionRef.current = null;
          setPoseDraft(null);
          setSelection((current) =>
            current === selectionState ? null : current,
          );
        }
        const currentSelectionState = selectionRef.current;
        if (
          currentSelectionState?.owner === store &&
          !interactionWasInvalidated(currentSelectionState.itemId)
        ) {
          const selected = current.room.items.find(
            ({ id }) => id === currentSelectionState.itemId,
          );
          if (selected) {
            setPoseDraft({
              owner: store,
              itemId: selected.id,
              x: String(selected.pose.x),
              y: String(selected.pose.y),
              rotationDeg: selected.pose.rotationDeg,
            });
          }
        }
        const dragState = dragRef.current;
        if (
          dragState?.owner === store &&
          interactionWasInvalidated(dragState.itemId)
        ) {
          dragRef.current = null;
          setDrag((current) => (current === dragState ? null : current));
        }
        const architecturalDragState = architecturalDragRef.current;
        if (
          architecturalDragState?.owner === store &&
          architecturalDragState.startRevision !== current.revision
        ) {
          architecturalDragRef.current = null;
          setArchitecturalDrag((candidate) =>
            candidate === architecturalDragState ? null : candidate,
          );
        }
      }),
    [store],
  );

  useLayoutEffect(() => {
    const itemId = pendingFocusItemIdRef.current;
    if (!itemId) return;

    pendingFocusItemIdRef.current = null;
    const item = roomPlanRef.current?.querySelector<SVGGElement>(
      `[data-item-id="${itemId}"]`,
    );
    (item ?? roomPlanRef.current)?.focus();
  }, [room, selectedItemId]);

  const visibleRoom = useMemo(() => {
    if (
      architecturalDrag?.owner === store &&
      architecturalDrag.startRevision === revision
    ) {
      return architecturalDrag.previewRoom;
    }
    if (
      !drag ||
      drag.owner !== store ||
      drag.startRevision !== revision
    ) {
      return room;
    }

    return {
      ...room,
      items: room.items.map((item) =>
        item.id === drag.itemId ? { ...item, pose: drag.previewPose } : item,
      ),
    };
  }, [architecturalDrag, drag, revision, room, store]);
  const projection = useMemo(
    () => projectRoomToPlan(visibleRoom, viewport),
    [visibleRoom, viewport],
  );
  const openingContentById = useMemo(
    () => new Map(room.openings.map((opening) => [opening.id, opening])),
    [room.openings],
  );
  const itemContentById = useMemo(
    () => new Map(room.items.map((item) => [item.id, item])),
    [room.items],
  );
  const selectedItem = room.items.find(({ id }) => id === selectedItemId);
  const selectedPlanItem = projection.items.find(
    ({ id }) => id === selectedItemId,
  );

  const announceResult = (result: RoomTransactionResult) => {
    const status = result.ok ? "accepted" : "rejected";
    const summary = result.ok ? result.receipt.summary : result.message;
    setHumanActionResult((previous) => {
      const attempt = previous?.owner === store ? previous.attempt + 1 : 1;
      return {
        attempt,
        owner: store,
        text: `Human edit attempt ${attempt} ${status}. ${summary}. Revision ${result.revision}.`,
      };
    });
  };

  const selectItem = (itemId: EntityId) => {
    const nextSelection = {
      owner: store,
      itemId,
    };
    selectionRef.current = nextSelection;
    setSelection(nextSelection);
    const item = store.getState().room.items.find(({ id }) => id === itemId);
    if (item) {
      setPoseDraft({
        owner: store,
        itemId,
        x: String(item.pose.x),
        y: String(item.pose.y),
        rotationDeg: item.pose.rotationDeg,
      });
    }
  };

  const selectFromClick = (
    event: MouseEvent<SVGGElement>,
    itemId: EntityId,
  ) => {
    const pendingPointerClick = pendingPointerClickRef.current;
    if (event.detail === 0) {
      pendingPointerClickRef.current = null;
      selectItem(itemId);
      return;
    }
    if (event.detail > 0 && pendingPointerClick) {
      pendingPointerClickRef.current = null;
      if (pendingPointerClick.suppress) return;
    }

    selectItem(itemId);
  };

  const beginDrag = (
    event: PointerEvent<SVGGElement>,
    itemId: EntityId,
  ) => {
    const current = store.getState();
    const item = current.room.items.find(({ id }) => id === itemId);
    const svg = event.currentTarget.ownerSVGElement;
    if (!item || !svg) return;

    pendingPointerClickRef.current = {
      owner: store,
      itemId,
      pointerId: event.pointerId,
      suppress: false,
    };
    selectItem(itemId);
    const startRoomPoint = screenPointToRoom(
      svg,
      { x: event.clientX, y: event.clientY },
      projection,
    );
    if (!startRoomPoint) return;

    const pointerId = event.pointerId;
    event.currentTarget.setPointerCapture?.(pointerId);
    const nextDrag = {
      owner: store,
      itemId,
      pointerId,
      startRevision: current.revision,
      startPose: { ...item.pose },
      startRoomPoint,
      startProjection: projection,
      previewPose: { ...item.pose },
    };
    dragRef.current = nextDrag;
    setDrag(nextDrag);
  };

  const poseAtClientPoint = (
    activeDrag: DragState,
    svg: SVGSVGElement,
    clientPoint: { x: number; y: number },
  ): Pose | null => {
    const roomPoint = screenPointToRoom(
      svg,
      clientPoint,
      activeDrag.startProjection,
    );
    if (!roomPoint) return null;

    return {
      ...activeDrag.startPose,
      x: roundMillimeters(
        activeDrag.startPose.x +
          roomPoint.x -
          activeDrag.startRoomPoint.x,
      ),
      y: roundMillimeters(
        activeDrag.startPose.y +
          roomPoint.y -
          activeDrag.startRoomPoint.y,
      ),
    };
  };

  const moveDrag = (event: PointerEvent<SVGGElement>) => {
    const activeDrag = dragRef.current;
    if (
      !activeDrag ||
      activeDrag.owner !== store ||
      event.pointerId !== activeDrag.pointerId
    ) {
      return;
    }
    const svg = event.currentTarget.ownerSVGElement;
    if (!svg) return;

    const previewPose = poseAtClientPoint(
      activeDrag,
      svg,
      { x: event.clientX, y: event.clientY },
    );
    if (!previewPose) return;

    const nextDrag = { ...activeDrag, previewPose };
    dragRef.current = nextDrag;
    setDrag(nextDrag);
  };

  const releaseCapture = (
    event: PointerEvent<SVGGElement>,
    activeDrag: DragState,
  ) => {
    if (event.currentTarget.hasPointerCapture?.(activeDrag.pointerId)) {
      event.currentTarget.releasePointerCapture(activeDrag.pointerId);
    }
  };

  const finishDrag = (event: PointerEvent<SVGGElement>) => {
    const activeDrag = dragRef.current;
    if (!activeDrag || event.pointerId !== activeDrag.pointerId) return;
    if (activeDrag.owner !== store) {
      dragRef.current = null;
      setDrag(null);
      return;
    }

    releaseCapture(event, activeDrag);
    const svg = event.currentTarget.ownerSVGElement;
    const finalPose = svg
      ? poseAtClientPoint(
          activeDrag,
          svg,
          { x: event.clientX, y: event.clientY },
        )
      : null;
    dragRef.current = null;
    setDrag(null);
    if (
      !finalPose ||
      (finalPose.x === activeDrag.startPose.x &&
        finalPose.y === activeDrag.startPose.y)
    ) {
      return;
    }

    const result = activeDrag.owner.getState().transact({
      expectedRevision: activeDrag.startRevision,
      origin: "human",
      change: {
        type: "edit",
        operations: [
          {
            type: "transform",
            itemId: activeDrag.itemId,
            pose: finalPose,
          },
        ],
      },
    });
    announceResult(result);
  };

  const cancelDrag = (event: PointerEvent<SVGGElement>) => {
    const pendingPointerClick = pendingPointerClickRef.current;
    if (
      pendingPointerClick &&
      event.pointerId === pendingPointerClick.pointerId &&
      (event.type === "pointercancel" ||
        (pendingPointerClick.owner === store &&
          !pendingPointerClick.suppress))
    ) {
      pendingPointerClickRef.current = null;
    }
    const activeDrag = dragRef.current;
    if (
      !activeDrag ||
      activeDrag.owner !== store ||
      event.pointerId !== activeDrag.pointerId
    ) {
      return;
    }
    releaseCapture(event, activeDrag);
    dragRef.current = null;
    setDrag(null);
  };

  const selectWithKeyboard = (
    event: KeyboardEvent<SVGGElement>,
    itemId: EntityId,
  ) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    selectItem(itemId);
  };

  const rotateSelectedItem = () => {
    const activeSelection = selectionRef.current;
    if (!activeSelection || activeSelection.owner !== store) return;
    const current = store.getState();
    const item = current.room.items.find(
      ({ id }) => id === activeSelection.itemId,
    );
    if (!item) return;
    const rotationDeg = ((item.pose.rotationDeg + 90) % 360) as RotationDeg;
    const pose =
      findNearestLegalRotationPose(current.room, item, rotationDeg) ?? {
        ...item.pose,
        rotationDeg,
      };
    const result = current.transact({
      expectedRevision: current.revision,
      origin: "human",
      change: {
        type: "edit",
        operations: [
          {
            type: "transform",
            itemId: item.id,
            pose,
          },
        ],
      },
    });
    announceResult(result);
  };

  const applySelectedPose = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const activeSelection = selectionRef.current;
    if (!activeSelection || activeSelection.owner !== store) return;
    const current = store.getState();
    if (
      !poseDraft ||
      poseDraft.owner !== store ||
      poseDraft.itemId !== activeSelection.itemId
    ) return;
    const x = roundMillimeters(Number(poseDraft.x));
    const y = roundMillimeters(Number(poseDraft.y));
    const rotationDeg = poseDraft.rotationDeg;
    const result = current.transact({
      expectedRevision: current.revision,
      origin: "human",
      change: {
        type: "edit",
        operations: [
          {
            type: "transform",
            itemId: activeSelection.itemId,
            pose: { x, y, rotationDeg },
          },
        ],
      },
    });
    announceResult(result);
  };

  const closeSelectedItemActions = () => {
    selectionRef.current = null;
    setSelection(null);
    setPoseDraft(null);
    roomPlanRef.current?.focus();
  };

  const removeSelectedItem = () => {
    const activeSelection = selectionRef.current;
    if (!activeSelection || activeSelection.owner !== store) return;
    const current = store.getState();
    const result = current.transact({
      expectedRevision: current.revision,
      origin: "human",
      change: {
        type: "edit",
        operations: [
          { type: "remove", itemId: activeSelection.itemId },
        ],
      },
    });
    if (result.ok) {
      selectionRef.current = null;
      setSelection(null);
    }
    announceResult(result);
  };

  const roomAtArchitecturalPointer = (
    activeDrag: ArchitecturalDragState,
    svg: SVGSVGElement,
    clientPoint: { x: number; y: number },
  ) => {
    const roomPoint = screenPointToRoom(
      svg,
      clientPoint,
      activeDrag.startProjection,
    );
    if (!roomPoint) return null;
    const deltaX = roomPoint.x - activeDrag.startRoomPoint.x;
    const deltaY = roomPoint.y - activeDrag.startRoomPoint.y;
    if (activeDrag.interaction.kind === "opening") {
      const alongWall =
        activeDrag.interaction.wall === "north" ||
        activeDrag.interaction.wall === "south"
          ? deltaX
          : deltaY;
      return moveOpeningAlongWall(
        activeDrag.startRoom,
        activeDrag.interaction.openingId,
        activeDrag.interaction.startCenterOffset + alongWall,
      );
    }
    const delta = activeDrag.interaction.dimension === "width" ? deltaX : deltaY;
    return resizeAnchoredRoom(
      activeDrag.startRoom,
      activeDrag.interaction.dimension,
      activeDrag.interaction.startValue + delta,
    );
  };

  const beginArchitecturalDrag = (
    event: PointerEvent<SVGElement>,
    interaction: ArchitecturalDragState["interaction"],
  ) => {
    const svg = event.currentTarget.ownerSVGElement;
    if (!svg) return;
    const current = store.getState();
    const startProjection = projectRoomToPlan(current.room, viewport);
    const startRoomPoint = screenPointToRoom(
      svg,
      { x: event.clientX, y: event.clientY },
      startProjection,
    );
    if (!startRoomPoint) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = null;
    setDrag(null);
    const next: ArchitecturalDragState = {
      owner: store,
      pointerId: event.pointerId,
      startRevision: current.revision,
      startRoom: current.room,
      startRoomPoint,
      startProjection,
      previewRoom: current.room,
      interaction,
    };
    architecturalDragRef.current = next;
    setArchitecturalDrag(next);
  };

  const moveArchitecturalDrag = (event: PointerEvent<SVGElement>) => {
    const activeDrag = architecturalDragRef.current;
    if (
      !activeDrag ||
      activeDrag.owner !== store ||
      event.pointerId !== activeDrag.pointerId
    ) return;
    const svg = event.currentTarget.ownerSVGElement;
    if (!svg) return;
    const previewRoom = roomAtArchitecturalPointer(
      activeDrag,
      svg,
      { x: event.clientX, y: event.clientY },
    );
    if (!previewRoom) return;
    const next = { ...activeDrag, previewRoom };
    architecturalDragRef.current = next;
    setArchitecturalDrag(next);
  };

  const finishArchitecturalDrag = (event: PointerEvent<SVGElement>) => {
    const activeDrag = architecturalDragRef.current;
    if (!activeDrag || event.pointerId !== activeDrag.pointerId) return;
    if (event.currentTarget.hasPointerCapture?.(activeDrag.pointerId)) {
      event.currentTarget.releasePointerCapture(activeDrag.pointerId);
    }
    const svg = event.currentTarget.ownerSVGElement;
    const finalRoom = svg
      ? roomAtArchitecturalPointer(
          activeDrag,
          svg,
          { x: event.clientX, y: event.clientY },
        )
      : null;
    architecturalDragRef.current = null;
    setArchitecturalDrag(null);
    if (
      !finalRoom ||
      activeDrag.owner !== store ||
      JSON.stringify(finalRoom) === JSON.stringify(activeDrag.startRoom)
    ) return;
    const result = activeDrag.owner.getState().transact({
      expectedRevision: activeDrag.startRevision,
      origin: "human",
      change: { type: "replace", room: finalRoom },
    });
    announceResult(result);
  };

  const cancelArchitecturalDrag = (event: PointerEvent<SVGElement>) => {
    const activeDrag = architecturalDragRef.current;
    if (
      !activeDrag ||
      activeDrag.owner !== store ||
      event.pointerId !== activeDrag.pointerId
    ) return;
    if (event.currentTarget.hasPointerCapture?.(activeDrag.pointerId)) {
      event.currentTarget.releasePointerCapture(activeDrag.pointerId);
    }
    architecturalDragRef.current = null;
    setArchitecturalDrag(null);
  };

  const applyArchitecturalRoom = (nextRoom: WimyRoomV1 | null) => {
    if (!nextRoom) return;
    const current = store.getState();
    if (JSON.stringify(nextRoom) === JSON.stringify(current.room)) return;
    announceResult(current.transact({
      expectedRevision: current.revision,
      origin: "human",
      change: { type: "replace", room: nextRoom },
    }));
  };

  const nudgeOpening = (
    event: KeyboardEvent<SVGElement>,
    opening: Opening,
  ) => {
    const horizontal = opening.wall === "north" || opening.wall === "south";
    const decrease = horizontal ? event.key === "ArrowLeft" : event.key === "ArrowUp";
    const increase = horizontal ? event.key === "ArrowRight" : event.key === "ArrowDown";
    if (!decrease && !increase) return;
    event.preventDefault();
    const step = event.shiftKey ? 0.5 : 0.1;
    applyArchitecturalRoom(moveOpeningAlongWall(
      store.getState().room,
      opening.id,
      opening.centerOffset + (increase ? step : -step),
    ));
  };

  const nudgeRoomDimension = (
    event: KeyboardEvent<SVGElement>,
    dimension: "width" | "depth",
  ) => {
    const decrease = dimension === "width" ? event.key === "ArrowLeft" : event.key === "ArrowUp";
    const increase = dimension === "width" ? event.key === "ArrowRight" : event.key === "ArrowDown";
    if (!decrease && !increase) return;
    event.preventDefault();
    const current = store.getState().room;
    const step = event.shiftKey ? 0.5 : 0.1;
    applyArchitecturalRoom(resizeAnchoredRoom(
      current,
      dimension,
      current.dimensions[dimension] + (increase ? step : -step),
    ));
  };

  return (
    <section className="room-editor" aria-labelledby="room-editor-heading">
      <div className="room-editor-heading-row">
        <h3 id="room-editor-heading">2D room editor</h3>
        <p>Drag furniture, openings, or the east and south room bounds.</p>
      </div>
      <div className="room-plan-stage">
        <svg
          ref={roomPlanRef}
          className="room-plan"
          role="group"
          tabIndex={-1}
          aria-label={`${room.name} 2D room editor`}
          viewBox={`0 0 ${viewport.width} ${viewport.height}`}
        >
        <defs>
          <marker
            id="room-item-orientation-arrow"
            markerHeight="6"
            markerUnits="strokeWidth"
            markerWidth="6"
            orient="auto"
            refX="5"
            refY="3"
          >
            <path d="M 0 0 L 6 3 L 0 6 z" />
          </marker>
        </defs>
        <polygon
          className="room-boundary"
          points={projection.roomPolygon.map(({ x, y }) => `${x},${y}`).join(" ")}
        />
        <g className="room-wall-resize-control">
          <line
            aria-hidden="true"
            className="room-wall-resize-rail"
            x1={projection.roomRect.x + projection.roomRect.width}
            y1={projection.roomRect.y}
            x2={projection.roomRect.x + projection.roomRect.width}
            y2={projection.roomRect.y + roomUsableWallLength(visibleRoom, "east") * projection.scale}
          />
          <rect
            aria-label="Resize room width from east wall"
            aria-orientation="horizontal"
            aria-valuemax={30}
            aria-valuemin={1}
            aria-valuenow={visibleRoom.dimensions.width}
            aria-valuetext={`${visibleRoom.dimensions.width} meters wide`}
            className="room-wall-resize-hit-target room-wall-resize-hit-target-width"
            role="slider"
            tabIndex={0}
            x={projection.roomRect.x + projection.roomRect.width - 12}
            y={projection.roomRect.y}
            width={24}
            height={roomUsableWallLength(visibleRoom, "east") * projection.scale}
            onKeyDown={(event) => nudgeRoomDimension(event, "width")}
            onPointerDown={(event) => beginArchitecturalDrag(event, {
              kind: "dimension",
              dimension: "width",
              startValue: store.getState().room.dimensions.width,
            })}
            onPointerMove={moveArchitecturalDrag}
            onPointerUp={finishArchitecturalDrag}
            onPointerCancel={cancelArchitecturalDrag}
            onLostPointerCapture={cancelArchitecturalDrag}
          />
        </g>
        <g className="room-wall-resize-control">
          <line
            aria-hidden="true"
            className="room-wall-resize-rail"
            x1={projection.roomRect.x}
            y1={projection.roomRect.y + projection.roomRect.height}
            x2={projection.roomRect.x + roomUsableWallLength(visibleRoom, "south") * projection.scale}
            y2={projection.roomRect.y + projection.roomRect.height}
          />
          <rect
            aria-label="Resize room depth from south wall"
            aria-orientation="vertical"
            aria-valuemax={30}
            aria-valuemin={1}
            aria-valuenow={visibleRoom.dimensions.depth}
            aria-valuetext={`${visibleRoom.dimensions.depth} meters deep`}
            className="room-wall-resize-hit-target room-wall-resize-hit-target-depth"
            role="slider"
            tabIndex={0}
            x={projection.roomRect.x}
            y={projection.roomRect.y + projection.roomRect.height - 12}
            width={roomUsableWallLength(visibleRoom, "south") * projection.scale}
            height={24}
            onKeyDown={(event) => nudgeRoomDimension(event, "depth")}
            onPointerDown={(event) => beginArchitecturalDrag(event, {
              kind: "dimension",
              dimension: "depth",
              startValue: store.getState().room.dimensions.depth,
            })}
            onPointerMove={moveArchitecturalDrag}
            onPointerUp={finishArchitecturalDrag}
            onPointerCancel={cancelArchitecturalDrag}
            onLostPointerCapture={cancelArchitecturalDrag}
          />
        </g>
        <text
          className="room-name-label"
          x={projection.roomRect.x}
          y={projection.roomRect.y - 14}
        >
          {room.name}
        </text>
        <text
          className="room-plan-north"
          x={projection.roomRect.x + projection.roomRect.width}
          y={projection.roomRect.y - 14}
          textAnchor="end"
        >
          Plan North ↑
        </text>
        <text
          className="room-dimension-label"
          x={projection.dimensions.width.x}
          y={projection.dimensions.width.y}
          textAnchor="middle"
        >
          {`${projection.dimensions.width.value} m wide`}
        </text>
        <text
          className="room-dimension-label room-dimension-label-depth"
          x={projection.dimensions.depth.x}
          y={projection.dimensions.depth.y}
          textAnchor="middle"
        >
          {`${projection.dimensions.depth.value} m deep`}
        </text>
        {projection.openings.map((opening) => {
          const content = openingContentById.get(opening.id);
          return content ? (
            <g
              key={opening.id}
              aria-label={opening.label.toLowerCase()}
              className="room-opening-control"
              data-opening-id={opening.id}
              data-opening-kind={content.kind}
              data-opening-swing={opening.swing}
            >
              <title>{opening.label}</title>
              <line
                aria-hidden="true"
                className={`room-opening room-opening-${content.kind}`}
                x1={opening.start.x}
                y1={opening.start.y}
                x2={opening.end.x}
                y2={opening.end.y}
              />
              <line
                aria-label={`Move ${content.kind} on ${content.wall} wall`}
                aria-orientation={content.wall === "north" || content.wall === "south" ? "horizontal" : "vertical"}
                aria-valuemax={roomUsableWallLength(visibleRoom, content.wall) - content.width / 2}
                aria-valuemin={content.width / 2}
                aria-valuenow={content.centerOffset}
                aria-valuetext={`${content.centerOffset} meters from wall start`}
                className={`room-opening-hit-target room-opening-hit-target-${content.wall}`}
                role="slider"
                tabIndex={0}
                x1={opening.start.x}
                y1={opening.start.y}
                x2={opening.end.x}
                y2={opening.end.y}
                onKeyDown={(event) => nudgeOpening(event, content)}
                onPointerDown={(event) => beginArchitecturalDrag(event, {
                  kind: "opening",
                  openingId: content.id,
                  wall: content.wall,
                  startCenterOffset: store.getState().room.openings.find(({ id }) => id === content.id)?.centerOffset ?? content.centerOffset,
                })}
                onPointerMove={moveArchitecturalDrag}
                onPointerUp={finishArchitecturalDrag}
                onPointerCancel={cancelArchitecturalDrag}
                onLostPointerCapture={cancelArchitecturalDrag}
              />
            </g>
          ) : null;
        })}
        {projection.items.map((item) => {
          const content = itemContentById.get(item.id);
          if (!content) return null;
          const selected = item.id === selectedItemId;
          return (
            <g
              key={item.id}
              className="room-item"
              role="button"
              tabIndex={0}
              aria-label={`Select ${content.snapshot.name}`}
              aria-pressed={selected}
              data-item-id={item.id}
              onClick={(event) => selectFromClick(event, item.id)}
              onKeyDown={(event) => selectWithKeyboard(event, item.id)}
              onPointerDown={(event) => beginDrag(event, item.id)}
              onPointerMove={moveDrag}
              onPointerUp={finishDrag}
              onPointerCancel={cancelDrag}
              onLostPointerCapture={cancelDrag}
            >
              <title>{`${content.snapshot.name}, ${content.snapshot.category}, ${item.orientation.label}, rotation ${item.orientation.rotationDeg}°`}</title>
              <rect
                className="room-item-footprint"
                x={item.rect.x}
                y={item.rect.y}
                width={item.rect.width}
                height={item.rect.height}
                fill={content.snapshot.appearance.color}
              />
              <rect
                className="room-item-focus"
                aria-hidden="true"
                x={item.rect.x - 8}
                y={item.rect.y - 8}
                width={item.rect.width + 16}
                height={item.rect.height + 16}
              />
              {selected ? (
                <rect
                  className="room-item-selection"
                  aria-hidden="true"
                  x={item.rect.x - 4}
                  y={item.rect.y - 4}
                  width={item.rect.width + 8}
                  height={item.rect.height + 8}
                />
              ) : null}
              {selected && item.orientation.direction ? (
                <line
                  className="room-item-orientation-cue"
                  data-direction={item.orientation.direction}
                  data-orientation-cue={item.orientation.cue}
                  aria-hidden="true"
                  markerEnd="url(#room-item-orientation-arrow)"
                  x1={item.center.x}
                  y1={item.center.y}
                  x2={
                    item.center.x +
                    item.orientation.directionVector[0] *
                      Math.max(14, Math.min(item.rect.width, item.rect.height) * 0.35)
                  }
                  y2={
                    item.center.y +
                    item.orientation.directionVector[1] *
                      Math.max(14, Math.min(item.rect.width, item.rect.height) * 0.35)
                  }
                />
              ) : null}
              {selected ? (
                <text
                  className="room-item-orientation-label"
                  aria-hidden="true"
                  x={item.center.x}
                  y={item.rect.y - 12}
                  textAnchor="middle"
                >
                  {item.orientation.label}
                </text>
              ) : null}
              <text
                className="room-item-label"
                x={item.labelAnchor.x}
                y={item.labelAnchor.y}
                textAnchor="middle"
                dominantBaseline="middle"
              >
                {content.snapshot.category}
              </text>
            </g>
          );
        })}
        </svg>
        {selectedItem ? (
          <form
            className="room-item-actions"
            onSubmit={applySelectedPose}
            role="group"
            aria-label="Selected item actions"
          >
            <div className="selected-item-summary">
              <strong>{selectedItem.snapshot.name}</strong>
              <span>
                {`${selectedPlanItem?.orientation.label ?? "No fixed direction"} · ${selectedItem.pose.rotationDeg}° · x ${selectedItem.pose.x} m, y ${selectedItem.pose.y} m`}
              </span>
            </div>
            <div className="selected-item-pose-fields">
              <label>
                X position (m)
                <input
                  onChange={(event) => setPoseDraft((current) => current
                    ? { ...current, x: event.target.value }
                    : current)}
                  name="x"
                  required
                  step="0.01"
                  type="number"
                  value={poseDraft?.owner === store && poseDraft.itemId === selectedItem.id
                    ? poseDraft.x
                    : String(selectedItem.pose.x)}
                />
              </label>
              <label>
                Y position (m)
                <input
                  onChange={(event) => setPoseDraft((current) => current
                    ? { ...current, y: event.target.value }
                    : current)}
                  name="y"
                  required
                  step="0.01"
                  type="number"
                  value={poseDraft?.owner === store && poseDraft.itemId === selectedItem.id
                    ? poseDraft.y
                    : String(selectedItem.pose.y)}
                />
              </label>
              <label>
                Angle
                <select
                  name="rotationDeg"
                  onChange={(event) => setPoseDraft((current) => current
                    ? { ...current, rotationDeg: Number(event.target.value) as RotationDeg }
                    : current)}
                  value={poseDraft?.owner === store && poseDraft.itemId === selectedItem.id
                    ? poseDraft.rotationDeg
                    : selectedItem.pose.rotationDeg}
                >
                  <option value="0">0°</option>
                  <option value="90">90°</option>
                  <option value="180">180°</option>
                  <option value="270">270°</option>
                </select>
              </label>
            </div>
            <button type="submit">Apply pose</button>
            <button
              type="button"
              aria-label="Rotate 90 degrees"
              onClick={rotateSelectedItem}
            >
              Rotate 90°
            </button>
            <button
              type="button"
              className="remove-item-control"
              aria-label={`Remove ${selectedItem.snapshot.name}`}
              onClick={removeSelectedItem}
            >
              Remove
            </button>
            <button
              type="button"
              aria-label="Close item controls"
              onClick={closeSelectedItemActions}
            >
              Close
            </button>
          </form>
        ) : null}
      </div>
      <p
        role={humanActionResult?.owner === store ? "status" : undefined}
        aria-label="Human edit result"
        aria-live="polite"
        aria-atomic="true"
      >
        {humanActionResult?.owner === store ? humanActionResult.text : ""}
      </p>
    </section>
  );
}
