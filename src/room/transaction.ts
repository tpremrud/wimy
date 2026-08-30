import type {
  EntityId,
  FurnitureSnapshot,
  PlacedItem,
  Pose,
  WimyRoomV1,
} from "./document";
import { WimyRoomV1Schema } from "./document";
import {
  findLayoutWarnings,
  validatePlacement,
  type RoomWarning,
} from "./placement";

export type { RoomWarning } from "./placement";

export type RuntimeRoomState = {
  room: WimyRoomV1;
  revision: number;
};

export type TransactionOrigin =
  | "human"
  | "webmcp"
  | "import"
  | "template"
  | "undo";

export type RoomOperation =
  | { type: "add"; productId: string; pose: Pose }
  | { type: "transform"; itemId: EntityId; pose: Partial<Pose> }
  | { type: "remove"; itemId: EntityId };

export type RoomChange =
  | { type: "edit"; operations: RoomOperation[] }
  | { type: "replace"; room: WimyRoomV1 };

export type RoomTransactionRequest = {
  expectedRevision: number;
  origin: TransactionOrigin;
  change: RoomChange;
};

export type TransactionFailureCode =
  | "REVISION_CONFLICT"
  | "INVALID_DOCUMENT"
  | "UNKNOWN_PRODUCT"
  | "UNKNOWN_ITEM"
  | "OUT_OF_BOUNDS"
  | "COLLISION"
  | "DOOR_CLEARANCE"
  | "TOO_MANY_OPERATIONS";

export type ActivityReceipt = {
  origin: TransactionOrigin;
  status: "accepted" | "rejected";
  revision: number;
  changeType: RoomChange["type"];
  summary: string;
  code?: TransactionFailureCode;
  affectedItemIds: EntityId[];
  removedItemIds: EntityId[];
};

export type RoomTransactionResult =
  | {
      ok: true;
      revision: number;
      applied: number;
      affectedItemIds: EntityId[];
      warnings: RoomWarning[];
      receipt: ActivityReceipt;
    }
  | {
      ok: false;
      revision: number;
      code: TransactionFailureCode;
      message: string;
      warnings: RoomWarning[];
      receipt: ActivityReceipt;
    };

export type RoomTransactionOutcome = {
  state: RuntimeRoomState;
  result: RoomTransactionResult;
};

export type ResolvedProduct = {
  catalogRef: { catalogId: string; productId: string };
  snapshot: FurnitureSnapshot;
};

export type ProductResolver = (
  productId: string,
) => ResolvedProduct | undefined;

export type TransactionDependencies = {
  resolveProduct: ProductResolver;
  createItemId: () => EntityId;
};

export const TEST_TRANSACTION_DEPENDENCIES: TransactionDependencies = {
  resolveProduct: () => undefined,
  createItemId: () => "item_generated_1",
};

const isCatalogProductAvailable = (
  dependencies: TransactionDependencies,
  catalogRef: { catalogId: string; productId: string },
) => {
  const resolved = dependencies.resolveProduct(catalogRef.productId);
  return (
    resolved?.catalogRef.catalogId === catalogRef.catalogId &&
    resolved.catalogRef.productId === catalogRef.productId
  );
};

const layoutWarnings = (
  room: WimyRoomV1,
  dependencies: TransactionDependencies,
) =>
  findLayoutWarnings(room, (catalogRef) =>
    isCatalogProductAvailable(dependencies, catalogRef),
  );

const rejectTransaction = (
  state: RuntimeRoomState,
  request: RoomTransactionRequest,
  dependencies: TransactionDependencies,
  code: TransactionFailureCode,
  message: string,
): RoomTransactionOutcome => ({
  state,
  result: {
    ok: false,
    revision: state.revision,
    code,
    message,
    warnings: layoutWarnings(state.room, dependencies),
    receipt: {
      origin: request.origin,
      status: "rejected",
      revision: state.revision,
      changeType: request.change.type,
      summary: message,
      code,
      affectedItemIds: [],
      removedItemIds: [],
    },
  },
});

export function applyRoomTransaction(
  state: RuntimeRoomState,
  request: RoomTransactionRequest,
  dependencies: TransactionDependencies,
): RoomTransactionOutcome {
  if (request.expectedRevision !== state.revision) {
    return rejectTransaction(
      state,
      request,
      dependencies,
      "REVISION_CONFLICT",
      `Expected revision ${request.expectedRevision}, but the room is at revision ${state.revision}`,
    );
  }

  if (
    request.change.type === "edit" &&
    (request.change.operations.length < 1 ||
      request.change.operations.length > 8)
  ) {
    return rejectTransaction(
      state,
      request,
      dependencies,
      "TOO_MANY_OPERATIONS",
      "Edit transactions require 1 to 8 operations",
    );
  }

  if (request.change.type === "replace") {
    const parsedRoom = WimyRoomV1Schema.safeParse(request.change.room);
    if (!parsedRoom.success) {
      const issue = parsedRoom.error.issues[0];
      return rejectTransaction(
        state,
        request,
        dependencies,
        "INVALID_DOCUMENT",
        issue
          ? `Invalid room document: ${issue.message}`
          : "Invalid room document",
      );
    }
    const room = parsedRoom.data;
    const revision = state.revision + 1;
    const affectedItemIds = room.items.map(({ id }) => id);
    const receipt: ActivityReceipt = {
      origin: request.origin,
      status: "accepted",
      revision,
      changeType: request.change.type,
      summary: `Replaced the room with ${room.name}`,
      affectedItemIds,
      removedItemIds: state.room.items
        .filter(
          (existingItem) =>
            !room.items.some(({ id }) => id === existingItem.id),
        )
        .map(({ id }) => id),
    };

    return {
      state: { room, revision },
      result: {
        ok: true,
        revision,
        applied: 1,
        affectedItemIds,
        warnings: layoutWarnings(room, dependencies),
        receipt,
      },
    };
  }

  const nextRoom = structuredClone(state.room);
  const affectedItemIds: EntityId[] = [];

  for (const operation of request.change.operations) {
    if (operation.type === "add") {
      const resolved = dependencies.resolveProduct(operation.productId);
      if (!resolved) {
        return rejectTransaction(
          state,
          request,
          dependencies,
          "UNKNOWN_PRODUCT",
          `Unknown catalog product ${operation.productId}`,
        );
      }

      const itemId = dependencies.createItemId();
      if (
        nextRoom.items.some(({ id }) => id === itemId) ||
        nextRoom.openings.some(({ id }) => id === itemId)
      ) {
        return rejectTransaction(
          state,
          request,
          dependencies,
          "INVALID_DOCUMENT",
          `Generated placed-item identity ${itemId} already exists`,
        );
      }

      const item: PlacedItem = {
        id: itemId,
        catalogRef: structuredClone(resolved.catalogRef),
        snapshot: structuredClone(resolved.snapshot),
        pose: structuredClone(operation.pose),
      };
      const placement = validatePlacement(nextRoom, item, item.pose);
      if (!placement.ok) {
        return rejectTransaction(
          state,
          request,
          dependencies,
          placement.code,
          placement.message,
        );
      }
      nextRoom.items.push(item);
      affectedItemIds.push(item.id);
      continue;
    }

    const itemIndex = nextRoom.items.findIndex(
      ({ id }) => id === operation.itemId,
    );
    if (itemIndex < 0) {
      return rejectTransaction(
        state,
        request,
        dependencies,
        "UNKNOWN_ITEM",
        `Unknown placed item ${operation.itemId}`,
      );
    }

    if (operation.type === "remove") {
      nextRoom.items.splice(itemIndex, 1);
    } else {
      const item = nextRoom.items[itemIndex];
      if (!item) {
        throw new Error(`Unknown placed item ${operation.itemId}`);
      }
      const pose = { ...item.pose, ...operation.pose };
      const placement = validatePlacement(nextRoom, item, pose);
      if (!placement.ok) {
        return rejectTransaction(
          state,
          request,
          dependencies,
          placement.code,
          placement.message,
        );
      }
      item.pose = pose;
    }
    affectedItemIds.push(operation.itemId);
  }

  const parsedRoom = WimyRoomV1Schema.safeParse(nextRoom);
  if (!parsedRoom.success) {
    const issue = parsedRoom.error.issues[0];
    return rejectTransaction(
      state,
      request,
      dependencies,
      "INVALID_DOCUMENT",
      issue ? `Invalid room document: ${issue.message}` : "Invalid room document",
    );
  }

  const revision = state.revision + 1;
  const receipt: ActivityReceipt = {
    origin: request.origin,
    status: "accepted",
    revision,
    changeType: request.change.type,
    summary: `Applied ${request.change.operations.length} room operations`,
    affectedItemIds,
    removedItemIds: request.change.operations.flatMap((operation) =>
      operation.type === "remove" ? [operation.itemId] : [],
    ),
  };
  const warnings = layoutWarnings(parsedRoom.data, dependencies);

  return {
    state: { room: parsedRoom.data, revision },
    result: {
      ok: true,
      revision,
      applied: request.change.operations.length,
      affectedItemIds,
      warnings,
      receipt,
    },
  };
}
