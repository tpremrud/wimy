import { createStore, type StoreApi } from "zustand/vanilla";
import { resolveCatalogProduct } from "./catalog";
import type { EntityId, WimyRoomV1 } from "./document";
import { getTemplate } from "./templates";
import type {
  ActivityReceipt,
  RoomTransactionRequest,
  RoomTransactionResult,
  TransactionDependencies,
} from "./transaction";
import { applyRoomTransaction } from "./transaction";

const MAX_RECEIPTS = 20;

type DeepReadonly<T> = T extends (...args: infer Arguments) => infer Result
  ? (...args: Arguments) => Result
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

export type ReadonlyActivityReceipt = DeepReadonly<ActivityReceipt>;

const deepFreeze = <T>(value: T): DeepReadonly<T> => {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach((child) => deepFreeze(child));
    Object.freeze(value);
  }

  return value as DeepReadonly<T>;
};

const prependReceipts = (
  receipts: readonly ReadonlyActivityReceipt[],
  newReceipts: readonly ActivityReceipt[],
) => [...newReceipts, ...receipts].slice(0, MAX_RECEIPTS);

const cloneResult = (result: RoomTransactionResult): RoomTransactionResult => {
  const cloned = structuredClone(result);
  cloned.receipt = structuredClone(result.receipt);
  return cloned;
};

export type RoomStoreState = {
  readonly room: DeepReadonly<WimyRoomV1>;
  readonly revision: number;
  readonly receipts: readonly ReadonlyActivityReceipt[];
  readonly previousRoom: DeepReadonly<WimyRoomV1> | null;
  readonly selectedItemId: EntityId | null;
  readonly transact: (
    request: RoomTransactionRequest,
  ) => RoomTransactionResult;
  readonly createUndoRequest: () => RoomTransactionRequest | null;
  readonly selectItem: (itemId: EntityId | null) => void;
};

export type RoomStore = Pick<
  StoreApi<RoomStoreState>,
  "getInitialState" | "getState" | "subscribe"
>;

export type RoomStoreOptions = {
  reportSubscriberError?: (error: unknown) => void;
};

const reportSubscriberErrorToConsole = (error: unknown) => {
  console.error("Room store subscriber failed", error);
};

export const createRoomStore = (
  initialRoom: WimyRoomV1,
  dependencies: TransactionDependencies,
  options: RoomStoreOptions = {},
): RoomStore => {
  const store = createStore<RoomStoreState>((set, get) => {
    let activeTransaction:
      | { reentrantReceipts: ActivityReceipt[] }
      | undefined;
    const replaceState = (nextState: RoomStoreState) => {
      set(deepFreeze(nextState), true);
    };
    const transact = (request: RoomTransactionRequest) => {
      if (activeTransaction) {
        const revision = get().revision;
        const message =
          "A room transaction is in progress; retry after it completes";
        const result: RoomTransactionResult = {
          ok: false,
          revision,
          code: "REVISION_CONFLICT",
          message,
          warnings: [],
          receipt: {
            origin: request.origin,
            status: "rejected",
            revision,
            changeType: request.change.type,
            summary: message,
            code: "REVISION_CONFLICT",
            affectedItemIds: [],
            removedItemIds: [],
          },
        };
        activeTransaction.reentrantReceipts.push(
          structuredClone(result.receipt),
        );
        return cloneResult(result);
      }

      const transactionContext = {
        reentrantReceipts: [] as ActivityReceipt[],
      };
      activeTransaction = transactionContext;
      const current = get();
      let outcome: ReturnType<typeof applyRoomTransaction>;
      try {
        outcome = applyRoomTransaction(
          {
            room: current.room as WimyRoomV1,
            revision: current.revision,
          },
          request,
          dependencies,
        );
      } catch (error) {
        activeTransaction = undefined;
        if (transactionContext.reentrantReceipts.length > 0) {
          const latest = get();
          replaceState({
            ...latest,
            receipts: prependReceipts(latest.receipts, [
              ...transactionContext.reentrantReceipts,
            ].reverse()),
          });
        }
        throw error;
      }

      activeTransaction = undefined;
      const latest = get();
      const storedReceipt = structuredClone(outcome.result.receipt);
      const returnedResult = cloneResult(outcome.result);
      const receipts = prependReceipts(latest.receipts, [
        storedReceipt,
        ...[...transactionContext.reentrantReceipts].reverse(),
      ]);
      if (!outcome.result.ok) {
        replaceState({
          ...latest,
          receipts,
        });
        return returnedResult;
      }

      replaceState({
        ...latest,
        room: outcome.state.room,
        revision: outcome.state.revision,
        receipts,
        previousRoom:
          request.origin === "undo" ? null : structuredClone(current.room),
        selectedItemId:
          request.change.type === "replace" ||
          !latest.selectedItemId ||
          !outcome.state.room.items.some(
            ({ id }) => id === latest.selectedItemId,
          )
            ? null
            : latest.selectedItemId,
      });
      return returnedResult;
    };
    const createUndoRequest = (): RoomTransactionRequest | null => {
      const current = get();
      if (!current.previousRoom) {
        return null;
      }

      return {
        expectedRevision: current.revision,
        origin: "undo",
        change: {
          type: "replace",
          room: structuredClone(current.previousRoom) as WimyRoomV1,
        },
      };
    };
    const selectItem = (itemId: EntityId | null) => {
      replaceState({ ...get(), selectedItemId: itemId });
    };

    return deepFreeze({
      room: structuredClone(initialRoom),
      revision: 1,
      receipts: [],
      previousRoom: null,
      selectedItemId: null,
      transact,
      createUndoRequest,
      selectItem,
    });
  });

  const reportSubscriberError =
    options.reportSubscriberError ?? reportSubscriberErrorToConsole;
  type RoomStoreListener = Parameters<RoomStore["subscribe"]>[0];
  const listenerBoundaries = new WeakMap<
    RoomStoreListener,
    RoomStoreListener
  >();
  const subscribe: RoomStore["subscribe"] = (listener) => {
    let listenerBoundary = listenerBoundaries.get(listener);
    if (!listenerBoundary) {
      listenerBoundary = (state, previousState) => {
        try {
          listener(state, previousState);
        } catch (error) {
          try {
            reportSubscriberError(error);
          } catch {
            // Reporting must never replace a transaction or dependency outcome.
          }
        }
      };
      listenerBoundaries.set(listener, listenerBoundary);
    }

    return store.subscribe(listenerBoundary);
  };

  return {
    getInitialState: store.getInitialState,
    getState: store.getState,
    subscribe,
  };
};

const APPLICATION_TRANSACTION_DEPENDENCIES: TransactionDependencies = {
  resolveProduct: resolveCatalogProduct,
  createItemId: () => `item_${globalThis.crypto.randomUUID()}`,
};

export const roomStore = createRoomStore(
  getTemplate("living-room"),
  APPLICATION_TRANSACTION_DEPENDENCIES,
);
