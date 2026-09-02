import type {
  EntityId,
  CatalogRef,
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
  | { type: "remove"; itemId: EntityId }
  | {
      type: "replace";
      itemId: EntityId;
      productId: string;
      sourceCatalogRef: CatalogRef;
      confirmedByHuman: true;
    };

export type RoomChange =
  | { type: "edit"; operations: RoomOperation[] }
  | { type: "replace"; room: WimyRoomV1 };

export const LOCAL_CATALOG_TRANSACTION = Symbol(
  "wimy.localCatalogTransaction",
);

export type RoomTransactionRequest = {
  expectedRevision: number;
  origin: TransactionOrigin;
  change: RoomChange;
  readonly [LOCAL_CATALOG_TRANSACTION]?: true;
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

export const getRoomLayoutWarnings = (
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
    warnings: getRoomLayoutWarnings(state.room, dependencies),
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
  if (!Number.isSafeInteger(state.revision) || state.revision < 1) {
    throw new RangeError(
      "Runtime room revision must be a positive safe integer",
    );
  }

  if (request.expectedRevision !== state.revision) {
    return rejectTransaction(
      state,
      request,
      dependencies,
      "REVISION_CONFLICT",
      `Expected revision ${request.expectedRevision}, but the room is at revision ${state.revision}`,
    );
  }

  if (state.revision === Number.MAX_SAFE_INTEGER) {
    return rejectTransaction(
      state,
      request,
      dependencies,
      "INVALID_DOCUMENT",
      `Room revision cannot advance beyond ${Number.MAX_SAFE_INTEGER}`,
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

  if (request.origin === "webmcp" && request.change.type === "edit") {
    const removedItems = request.change.operations
      .filter((operation) => operation.type === "remove")
      .map((operation) =>
        state.room.items.find(({ id }) => id === operation.itemId),
      )
      .filter((item): item is PlacedItem => item !== undefined);
    const addedProducts = request.change.operations
      .filter((operation) => operation.type === "add")
      .map((operation) => dependencies.resolveProduct(operation.productId))
      .filter((product): product is ResolvedProduct => product !== undefined);
    if (
      removedItems.some((removedItem) =>
        addedProducts.some(
          (addedProduct) =>
            removedItem.catalogRef &&
            removedItem.snapshot.category === addedProduct.snapshot.category,
        ),
      )
    ) {
      return rejectTransaction(
        state,
        request,
        dependencies,
        "INVALID_DOCUMENT",
        "Substitute replacement requires explicit human confirmation",
      );
    }
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
        warnings: getRoomLayoutWarnings(room, dependencies),
        receipt,
      },
    };
  }

  const nextRoom = structuredClone(state.room);
  const affectedItemIds: EntityId[] = [];
  let singleAddedProductName: string | undefined;
  let singleReplacedProductSummary: string | undefined;

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
      if (request.change.operations.length === 1) {
        singleAddedProductName = resolved.snapshot.name;
      }
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

    if (operation.type === "replace") {
      if (request.origin !== "human" || operation.confirmedByHuman !== true) {
        return rejectTransaction(
          state,
          request,
          dependencies,
          "INVALID_DOCUMENT",
          "Substitute replacement requires explicit human confirmation",
        );
      }

      const item = nextRoom.items[itemIndex];
      if (!item) {
        throw new Error(`Unknown placed item ${operation.itemId}`);
      }
      if (
        !item.catalogRef ||
        item.catalogRef.catalogId !== operation.sourceCatalogRef.catalogId ||
        item.catalogRef.productId !== operation.sourceCatalogRef.productId
      ) {
        return rejectTransaction(
          state,
          request,
          dependencies,
          "INVALID_DOCUMENT",
          "Substitute confirmation does not match the placed catalog identity",
        );
      }

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

      const replacement: PlacedItem = {
        id: item.id,
        catalogRef: structuredClone(resolved.catalogRef),
        snapshot: structuredClone(resolved.snapshot),
        pose: structuredClone(item.pose),
      };
      const placement = validatePlacement(nextRoom, replacement, replacement.pose);
      if (!placement.ok) {
        return rejectTransaction(
          state,
          request,
          dependencies,
          placement.code,
          placement.message,
        );
      }
      nextRoom.items[itemIndex] = replacement;
      affectedItemIds.push(operation.itemId);
      if (request.change.operations.length === 1) {
        singleReplacedProductSummary =
          `Replaced ${item.snapshot.name} with ${resolved.snapshot.name} after human confirmation`;
      }
      continue;
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
    summary:
      singleReplacedProductSummary ??
      (singleAddedProductName === undefined
        ? `Applied ${request.change.operations.length} room operations`
        : `Added ${singleAddedProductName}`),
    affectedItemIds,
    removedItemIds: request.change.operations.flatMap((operation) =>
      operation.type === "remove" ? [operation.itemId] : [],
    ),
  };
  const warnings = getRoomLayoutWarnings(parsedRoom.data, dependencies);

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
