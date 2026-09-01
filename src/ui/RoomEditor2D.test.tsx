import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { WimyRoomV1 } from "../room/document";
import { createRoomStore, type RoomStore } from "../room/store";
import { TEST_TRANSACTION_DEPENDENCIES } from "../room/transaction";
import {
  makeOpening,
  makePlacedItem,
  makeRoom,
} from "../test/room-fixtures";
import { RoomEditor2D } from "./RoomEditor2D";

const TEST_VIEWPORT = { width: 500, height: 400, padding: 40 };
const originalPointerEvent = window.PointerEvent;
const originalDOMPoint = globalThis.DOMPoint;

class TestPointerEvent extends MouseEvent {
  readonly pointerId: number;

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
  }
}

class TestDOMPoint {
  readonly x: number;
  readonly y: number;

  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }

  matrixTransform(matrix: DOMMatrix) {
    return new TestDOMPoint(
      matrix.a * this.x + matrix.c * this.y + matrix.e,
      matrix.b * this.x + matrix.d * this.y + matrix.f,
    );
  }
}

beforeAll(() => {
  window.PointerEvent = TestPointerEvent as unknown as typeof PointerEvent;
  Object.defineProperty(globalThis, "DOMPoint", {
    configurable: true,
    value: TestDOMPoint,
  });
});

afterEach(cleanup);

afterAll(() => {
  window.PointerEvent = originalPointerEvent;
  Object.defineProperty(globalThis, "DOMPoint", {
    configurable: true,
    value: originalDOMPoint,
  });
});

const installIdentityScreenCtm = (svg: HTMLElement) => {
  Object.defineProperty(svg, "getScreenCTM", {
    configurable: true,
    value: () => ({
      inverse: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    }),
  });
};

const renderExistingStore = (store: RoomStore) => {
  const room = store.getState().room;
  render(<RoomEditor2D store={store} viewport={TEST_VIEWPORT} />);
  const svg = screen.getByRole("group", {
    name: `${room.name} 2D room editor`,
  });
  installIdentityScreenCtm(svg);
};

const renderEditor = (room: WimyRoomV1): RoomStore => {
  const store = createRoomStore(room, TEST_TRANSACTION_DEPENDENCIES);
  renderExistingStore(store);
  return store;
};

describe("RoomEditor2D selection", () => {
  it("renders a labelled room, dimensions, wall openings, and item category", () => {
    renderEditor(
      makeRoom({
        openings: [
          makeOpening({ id: "door_west", wall: "west" }),
          makeOpening({
            id: "window_north",
            kind: "window",
            wall: "north",
          }),
        ],
        items: [makePlacedItem()],
      }),
    );

    expect(screen.getByText("Test Room")).toBeVisible();
    expect(screen.getByText("4 m wide")).toBeVisible();
    expect(screen.getByText("3 m deep")).toBeVisible();
    expect(
      screen.getByLabelText("door on west wall — swing unspecified"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("window on north wall")).toBeInTheDocument();
    expect(screen.getByText("chair")).toBeVisible();
  });

  it("shows one readable facing cue only for the selected item", () => {
    const first = makePlacedItem({
      snapshot: { ...makePlacedItem().snapshot, category: "sofa" },
      pose: { x: 1, y: 1, rotationDeg: 180 },
    });
    const second = makePlacedItem({
      id: "item_chair_2",
      pose: { x: 3, y: 2, rotationDeg: 0 },
      snapshot: { ...makePlacedItem().snapshot, name: "Second Chair" },
    });
    renderEditor(makeRoom({ items: [first, second] }));

    fireEvent.click(
      screen.getByRole("button", { name: "Select Test Chair" }),
      { detail: 0 },
    );

    expect(screen.getByText("Facing south")).toBeVisible();
    expect(
      screen.getByText(/x 1 m, y 1 m, rotation 180°, Facing south/u),
    ).toBeVisible();
    expect(document.querySelectorAll(".room-item-orientation-cue")).toHaveLength(1);
    expect(document.querySelector(".room-item-orientation-cue")).toHaveAttribute(
      "data-direction",
      "south",
    );
  });

  it("keeps pointer and keyboard selection local to the current editor", () => {
    const secondItem = makePlacedItem({
      id: "item_chair_2",
      pose: { x: 3, y: 2, rotationDeg: 0 },
      snapshot: {
        ...makePlacedItem().snapshot,
        name: "Second Chair",
      },
    });
    const store = renderEditor(
      makeRoom({ items: [makePlacedItem(), secondItem] }),
    );
    const item = screen.getByRole("button", { name: "Select Test Chair" });
    const second = screen.getByRole("button", { name: "Select Second Chair" });

    fireEvent.pointerDown(item, {
      pointerId: 7,
      clientX: 145,
      clientY: 147.5,
    });

    expect(store.getState().selectedItemId).toBeNull();
    expect(item).toHaveAttribute("aria-pressed", "true");
    expect(item.querySelector(".room-item-selection")).toBeInTheDocument();
    fireEvent.pointerUp(item, {
      pointerId: 7,
      clientX: 145,
      clientY: 147.5,
    });
    expect(store.getState().revision).toBe(1);
    expect(store.getState().receipts).toHaveLength(0);

    second.focus();
    fireEvent.keyDown(second, { key: "Enter" });

    expect(store.getState().selectedItemId).toBeNull();
    expect(item).toHaveAttribute("aria-pressed", "false");
    expect(second).toHaveAttribute("aria-pressed", "true");
    expect(second).toHaveFocus();
  });

  it("supports detail-zero assistive click activation without creating a transaction", () => {
    const store = renderEditor(makeRoom({ items: [makePlacedItem()] }));
    const item = screen.getByRole("button", { name: "Select Test Chair" });

    fireEvent.click(item, { detail: 0 });

    expect(item).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: "Rotate 90 degrees" }),
    ).toBeVisible();
    expect(store.getState()).toMatchObject({
      revision: 1,
      receipts: [],
      selectedItemId: null,
    });
  });

  it("clears stale pointer suppression when a detail-zero click activates the item", () => {
    const secondItem = makePlacedItem({
      id: "item_chair_2",
      pose: { x: 3, y: 2, rotationDeg: 0 },
      snapshot: {
        ...makePlacedItem().snapshot,
        name: "Second Chair",
      },
    });
    const store = renderEditor(
      makeRoom({ items: [makePlacedItem(), secondItem] }),
    );
    const first = screen.getByRole("button", { name: "Select Test Chair" });
    fireEvent.pointerDown(first, {
      pointerId: 15,
      clientX: 145,
      clientY: 147.5,
    });

    act(() => {
      store.getState().transact({
        expectedRevision: 1,
        origin: "template",
        change: {
          type: "replace",
          room: makeRoom({ items: [makePlacedItem(), secondItem] }),
        },
      });
    });

    fireEvent.pointerUp(first, {
      pointerId: 15,
      clientX: 145,
      clientY: 147.5,
    });
    fireEvent.click(first, { detail: 0 });
    const second = screen.getByRole("button", { name: "Select Second Chair" });
    fireEvent.keyDown(second, { key: "Enter" });
    expect(second).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(first, { detail: 1 });

    expect(first).toHaveAttribute("aria-pressed", "true");
    expect(second).toHaveAttribute("aria-pressed", "false");
    expect(store.getState()).toMatchObject({ revision: 2 });
    expect(store.getState().receipts).toHaveLength(1);
  });

  it("does not resurrect a Human result or attempt across A to B to A", () => {
    const room = makeRoom({ items: [makePlacedItem()] });
    const storeA = createRoomStore(room, TEST_TRANSACTION_DEPENDENCIES);
    const storeB = createRoomStore(room, TEST_TRANSACTION_DEPENDENCIES);
    const view = render(
      <RoomEditor2D store={storeA} viewport={TEST_VIEWPORT} />,
    );
    const selectAndRotate = () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Select Test Chair" }),
        { detail: 0 },
      );
      fireEvent.click(
        screen.getByRole("button", { name: "Rotate 90 degrees" }),
      );
    };

    selectAndRotate();
    expect(screen.getByRole("status", { name: "Human edit result" }))
      .toHaveTextContent("Human edit attempt 1 accepted.");

    view.rerender(<RoomEditor2D store={storeB} viewport={TEST_VIEWPORT} />);
    expect(
      screen.queryByRole("status", { name: "Human edit result" }),
    ).not.toBeInTheDocument();

    view.rerender(<RoomEditor2D store={storeA} viewport={TEST_VIEWPORT} />);
    expect(
      screen.queryByRole("status", { name: "Human edit result" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Human edit attempt 1 accepted\./u),
    ).not.toBeInTheDocument();

    selectAndRotate();
    expect(screen.getByRole("status", { name: "Human edit result" }))
      .toHaveTextContent("Human edit attempt 1 accepted.");
  });

  it("does not carry local selection across a same-template store replacement", () => {
    const room = makeRoom({ items: [makePlacedItem()] });
    const storeA = createRoomStore(room, TEST_TRANSACTION_DEPENDENCIES);
    const storeB = createRoomStore(room, TEST_TRANSACTION_DEPENDENCIES);
    const view = render(
      <RoomEditor2D store={storeA} viewport={TEST_VIEWPORT} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Select Test Chair" }));
    expect(
      screen.getByRole("button", { name: "Select Test Chair" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(storeA.getState().selectedItemId).toBeNull();

    view.rerender(<RoomEditor2D store={storeB} viewport={TEST_VIEWPORT} />);

    expect(
      screen.getByRole("button", { name: "Select Test Chair" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.queryByRole("button", { name: "Rotate 90 degrees" }),
    ).not.toBeInTheDocument();
    expect(storeB.getState().selectedItemId).toBeNull();

    view.rerender(<RoomEditor2D store={storeA} viewport={TEST_VIEWPORT} />);

    expect(
      screen.getByRole("button", { name: "Select Test Chair" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.queryByLabelText("Selected item actions"),
    ).not.toBeInTheDocument();
  });

  it("clears local selection after an accepted same-store replace reuses the item id", () => {
    const room = makeRoom({ items: [makePlacedItem()] });
    const store = renderEditor(room);
    fireEvent.click(screen.getByRole("button", { name: "Select Test Chair" }));
    expect(screen.getByRole("button", { name: "Select Test Chair" }))
      .toHaveAttribute("aria-pressed", "true");

    act(() => {
      store.getState().transact({
        expectedRevision: 1,
        origin: "template",
        change: {
          type: "replace",
          room: makeRoom({
            name: "Replacement Room",
            items: [
              makePlacedItem({ pose: { x: 2, y: 1, rotationDeg: 0 } }),
            ],
          }),
        },
      });
    });

    expect(store.getState().receipts[0]).toMatchObject({
      status: "accepted",
      revision: 2,
    });
    expect(screen.getByRole("button", { name: "Select Test Chair" }))
      .toHaveAttribute("aria-pressed", "false");
    expect(
      screen.queryByRole("button", { name: "Rotate 90 degrees" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Selected item actions"),
    ).not.toBeInTheDocument();
  });

  it("keeps local selection after a rejected same-store replace", () => {
    const store = renderEditor(makeRoom({ items: [makePlacedItem()] }));
    const item = screen.getByRole("button", { name: "Select Test Chair" });
    fireEvent.click(item);

    act(() => {
      store.getState().transact({
        expectedRevision: 1,
        origin: "import",
        change: {
          type: "replace",
          room: makeRoom({
            dimensions: { width: 0, depth: 3, height: 2.7 },
          }),
        },
      });
    });

    expect(store.getState().receipts[0]).toMatchObject({
      status: "rejected",
      revision: 1,
    });
    expect(item).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: "Rotate 90 degrees" }),
    ).toBeVisible();
  });

  it("restores editor focus after accepted replacement and preserves it after rejection", () => {
    const store = renderEditor(makeRoom({ items: [makePlacedItem()] }));
    const item = screen.getByRole("button", { name: "Select Test Chair" });
    fireEvent.keyDown(item, { key: "Enter" });
    const rotate = screen.getByRole("button", { name: "Rotate 90 degrees" });
    rotate.focus();

    act(() => {
      store.getState().transact({
        expectedRevision: 1,
        origin: "template",
        change: {
          type: "replace",
          room: makeRoom({
            name: "Replacement Room",
            items: [
              makePlacedItem({ pose: { x: 2, y: 1, rotationDeg: 0 } }),
            ],
          }),
        },
      });
    });

    const replacementItem = screen.getByRole("button", {
      name: "Select Test Chair",
    });
    expect(replacementItem).toHaveFocus();
    fireEvent.keyDown(replacementItem, { key: "Enter" });
    const replacementRotate = screen.getByRole("button", {
      name: "Rotate 90 degrees",
    });
    replacementRotate.focus();

    act(() => {
      store.getState().transact({
        expectedRevision: 0,
        origin: "import",
        change: { type: "replace", room: makeRoom() },
      });
    });

    expect(replacementRotate).toHaveFocus();
    expect(
      screen.getByLabelText("Selected item actions"),
    ).toBeInTheDocument();
  });
});

describe("RoomEditor2D drag", () => {
  it("uses the actual pointer id and ignores unrelated pointer lifecycle events", () => {
    const store = renderEditor(makeRoom({ items: [makePlacedItem()] }));
    const item = screen.getByRole("button", { name: "Select Test Chair" });
    let capturedPointerId: number | null = null;
    const setPointerCapture = vi.fn();
    const releasePointerCapture = vi.fn();
    const hasPointerCapture = vi.fn(
      (pointerId: number) => capturedPointerId === pointerId,
    );
    setPointerCapture.mockImplementation((pointerId: number) => {
      capturedPointerId = pointerId;
    });
    releasePointerCapture.mockImplementation(() => {
      capturedPointerId = null;
    });
    Object.defineProperties(item, {
      setPointerCapture: { configurable: true, value: setPointerCapture },
      hasPointerCapture: { configurable: true, value: hasPointerCapture },
      releasePointerCapture: {
        configurable: true,
        value: releasePointerCapture,
      },
    });

    fireEvent.pointerDown(item, {
      pointerId: 7,
      clientX: 145,
      clientY: 147.5,
    });
    fireEvent.pointerMove(item, {
      pointerId: 8,
      clientX: 197.53,
      clientY: 147.5,
    });

    expect(screen.getByText("chair")).toHaveAttribute("x", "145");

    fireEvent.pointerMove(item, {
      pointerId: 7,
      clientX: 197.53,
      clientY: 147.5,
    });

    expect(setPointerCapture).toHaveBeenCalledWith(7);
    expect(store.getState().revision).toBe(1);
    expect(store.getState().receipts).toHaveLength(0);
    expect(screen.getByText("chair")).toHaveAttribute("x", "197.5");

    fireEvent.pointerUp(item, {
      pointerId: 8,
      clientX: 197.53,
      clientY: 147.5,
    });

    expect(releasePointerCapture).not.toHaveBeenCalled();
    expect(store.getState().revision).toBe(1);

    fireEvent.pointerUp(item, {
      pointerId: 7,
      clientX: 197.53,
      clientY: 147.5,
    });

    expect(hasPointerCapture).toHaveBeenCalledWith(7);
    expect(releasePointerCapture).toHaveBeenCalledWith(7);
    expect(store.getState().revision).toBe(2);
    expect(store.getState().receipts).toHaveLength(1);
    expect(store.getState().receipts[0]).toMatchObject({
      origin: "human",
      status: "accepted",
      revision: 2,
      affectedItemIds: ["item_chair_1"],
    });
    expect(store.getState().room.items[0]?.pose).toEqual({
      x: 1.5,
      y: 1,
      rotationDeg: 0,
    });
    expect(screen.getByLabelText("Human edit result")).toHaveTextContent(
      "Human edit attempt 1 accepted. Applied 1 room operations. Revision 2.",
    );
  });

  it("computes the committed pose from the release coordinates, not the last preview", () => {
    const store = renderEditor(makeRoom({ items: [makePlacedItem()] }));
    const item = screen.getByRole("button", { name: "Select Test Chair" });

    fireEvent.pointerDown(item, {
      pointerId: 9,
      clientX: 145,
      clientY: 147.5,
    });
    fireEvent.pointerMove(item, {
      pointerId: 9,
      clientX: 166,
      clientY: 147.5,
    });
    expect(screen.getByText("chair")).toHaveAttribute("x", "166");

    fireEvent.pointerUp(item, {
      pointerId: 9,
      clientX: 197.5,
      clientY: 147.5,
    });

    expect(store.getState().revision).toBe(2);
    expect(store.getState().room.items[0]?.pose).toEqual({
      x: 1.5,
      y: 1,
      rotationDeg: 0,
    });
  });

  it.each([
    {
      name: "out-of-bounds",
      room: makeRoom({ items: [makePlacedItem()] }),
      start: { x: 145, y: 147.5 },
      end: { x: 29.5, y: 147.5 },
      code: "OUT_OF_BOUNDS",
      message: "The placed item must fit inside the room",
      pose: { x: 1, y: 1, rotationDeg: 0 },
    },
    {
      name: "collision",
      room: makeRoom({
        items: [
          makePlacedItem(),
          makePlacedItem({
            id: "item_chair_2",
            pose: { x: 2, y: 1, rotationDeg: 0 },
          }),
        ],
      }),
      start: { x: 145, y: 147.5 },
      end: { x: 250, y: 147.5 },
      code: "COLLISION",
      message: "The placed item overlaps item_chair_2",
      pose: { x: 1, y: 1, rotationDeg: 0 },
    },
    {
      name: "door-clearance",
      room: makeRoom({
        openings: [makeOpening({ id: "door_north", wall: "north" })],
        items: [
          makePlacedItem({ pose: { x: 1, y: 2, rotationDeg: 0 } }),
        ],
      }),
      start: { x: 145, y: 252.5 },
      end: { x: 250, y: 84.5 },
      code: "DOOR_CLEARANCE",
      message: "The placed item blocks door clearance at door_north",
      pose: { x: 1, y: 2, rotationDeg: 0 },
    },
  ])(
    "snaps a $name rejection to the committed pose with a readable live result",
    ({ room, start, end, code, message, pose }) => {
      const store = renderEditor(room);
      const item = screen.getAllByRole("button", {
        name: "Select Test Chair",
      })[0];
      if (!item) throw new Error("expected the first test chair");

      fireEvent.pointerDown(item, {
        pointerId: 2,
        clientX: start.x,
        clientY: start.y,
      });
      fireEvent.pointerMove(item, {
        pointerId: 2,
        clientX: end.x,
        clientY: end.y,
      });
      fireEvent.pointerUp(item, {
        pointerId: 2,
        clientX: end.x,
        clientY: end.y,
      });

      expect(store.getState().revision).toBe(1);
      expect(store.getState().room.items[0]?.pose).toEqual(pose);
      expect(store.getState().receipts).toHaveLength(1);
      expect(store.getState().receipts[0]).toMatchObject({
        origin: "human",
        status: "rejected",
        revision: 1,
        code,
      });
      expect(
        screen.getByRole("status", { name: "Human edit result" }),
      ).toHaveTextContent(
        `Human edit attempt 1 rejected. ${message}. Revision 1.`,
      );
    },
  );

  it("announces repeated identical failures as distinct human attempts", () => {
    const store = renderEditor(makeRoom({ items: [makePlacedItem()] }));
    const item = screen.getByRole("button", { name: "Select Test Chair" });

    const rejectOutOfBounds = () => {
      fireEvent.pointerDown(item, {
        pointerId: 3,
        clientX: 145,
        clientY: 147.5,
      });
      fireEvent.pointerMove(item, {
        pointerId: 3,
        clientX: 29.5,
        clientY: 147.5,
      });
      fireEvent.pointerUp(item, {
        pointerId: 3,
        clientX: 29.5,
        clientY: 147.5,
      });
    };

    rejectOutOfBounds();
    expect(screen.getByLabelText("Human edit result")).toHaveTextContent(
      "Human edit attempt 1 rejected.",
    );

    rejectOutOfBounds();
    expect(store.getState().receipts).toHaveLength(2);
    expect(screen.getByLabelText("Human edit result")).toHaveTextContent(
      "Human edit attempt 2 rejected.",
    );
  });

  it("discards a pointer-cancel preview without a transaction", () => {
    const store = renderEditor(makeRoom({ items: [makePlacedItem()] }));
    const item = screen.getByRole("button", { name: "Select Test Chair" });

    fireEvent.pointerDown(item, {
      pointerId: 4,
      clientX: 145,
      clientY: 147.5,
    });
    fireEvent.pointerMove(item, {
      pointerId: 4,
      clientX: 197.5,
      clientY: 147.5,
    });
    expect(screen.getByText("chair")).toHaveAttribute("x", "197.5");

    fireEvent.pointerCancel(item, { pointerId: 4 });

    expect(store.getState().revision).toBe(1);
    expect(store.getState().receipts).toHaveLength(0);
    expect(store.getState().room.items[0]?.pose.x).toBe(1);
    expect(screen.getByText("chair")).toHaveAttribute("x", "145");
    expect(screen.getByLabelText("Human edit result")).toBeEmptyDOMElement();
  });

  it("cancels only a matching lost-pointer-capture event without a transaction", () => {
    const store = renderEditor(makeRoom({ items: [makePlacedItem()] }));
    const item = screen.getByRole("button", { name: "Select Test Chair" });

    fireEvent.pointerDown(item, {
      pointerId: 4,
      clientX: 145,
      clientY: 147.5,
    });
    fireEvent.pointerMove(item, {
      pointerId: 4,
      clientX: 197.5,
      clientY: 147.5,
    });

    fireEvent.lostPointerCapture(item, { pointerId: 5 });
    expect(screen.getByText("chair")).toHaveAttribute("x", "197.5");

    fireEvent.lostPointerCapture(item, { pointerId: 4 });

    expect(screen.getByText("chair")).toHaveAttribute("x", "145");
    expect(store.getState().revision).toBe(1);
    expect(store.getState().receipts).toHaveLength(0);
  });

  it("does not preview, commit, or trailing-click select a replacement store with matching ids and revision", () => {
    const room = makeRoom({ items: [makePlacedItem()] });
    const storeA = createRoomStore(room, TEST_TRANSACTION_DEPENDENCIES);
    const storeB = createRoomStore(room, TEST_TRANSACTION_DEPENDENCIES);
    const view = render(
      <RoomEditor2D store={storeA} viewport={TEST_VIEWPORT} />,
    );
    installIdentityScreenCtm(
      screen.getByRole("group", { name: "Test Room 2D room editor" }),
    );
    const item = screen.getByRole("button", { name: "Select Test Chair" });

    fireEvent.pointerDown(item, {
      pointerId: 11,
      clientX: 145,
      clientY: 147.5,
    });
    fireEvent.pointerMove(item, {
      pointerId: 11,
      clientX: 197.5,
      clientY: 147.5,
    });
    expect(screen.getByText("chair")).toHaveAttribute("x", "197.5");

    view.rerender(<RoomEditor2D store={storeB} viewport={TEST_VIEWPORT} />);
    installIdentityScreenCtm(
      screen.getByRole("group", { name: "Test Room 2D room editor" }),
    );

    expect(screen.getByText("chair")).toHaveAttribute("x", "145");
    const storeBItem = screen.getByRole("button", {
      name: "Select Test Chair",
    });
    fireEvent.pointerUp(storeBItem, {
      pointerId: 11,
      clientX: 197.5,
      clientY: 147.5,
    });
    fireEvent.click(storeBItem, { detail: 1 });

    expect(storeA.getState()).toMatchObject({ revision: 1, receipts: [] });
    expect(storeB.getState()).toMatchObject({ revision: 1, receipts: [] });
    expect(storeB.getState().room.items[0]?.pose.x).toBe(1);
    expect(storeBItem).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.queryByLabelText("Selected item actions"),
    ).not.toBeInTheDocument();

    view.rerender(<RoomEditor2D store={storeA} viewport={TEST_VIEWPORT} />);
    expect(screen.getByText("chair")).toHaveAttribute("x", "145");
    expect(
      screen.getByRole("button", { name: "Select Test Chair" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("suppresses a stale pointer click retargeted to a different replacement item", () => {
    const storeA = createRoomStore(
      makeRoom({ items: [makePlacedItem()] }),
      TEST_TRANSACTION_DEPENDENCIES,
    );
    const replacementItem = makePlacedItem({
      id: "item_chair_2",
      snapshot: {
        ...makePlacedItem().snapshot,
        name: "Replacement Chair",
      },
    });
    const storeB = createRoomStore(
      makeRoom({ items: [replacementItem] }),
      TEST_TRANSACTION_DEPENDENCIES,
    );
    const view = render(
      <RoomEditor2D store={storeA} viewport={TEST_VIEWPORT} />,
    );
    installIdentityScreenCtm(
      screen.getByRole("group", { name: "Test Room 2D room editor" }),
    );
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Select Test Chair" }),
      { pointerId: 17, clientX: 145, clientY: 147.5 },
    );

    view.rerender(<RoomEditor2D store={storeB} viewport={TEST_VIEWPORT} />);
    installIdentityScreenCtm(
      screen.getByRole("group", { name: "Test Room 2D room editor" }),
    );
    const storeBItem = screen.getByRole("button", {
      name: "Select Replacement Chair",
    });
    fireEvent.pointerUp(storeBItem, {
      pointerId: 17,
      clientX: 145,
      clientY: 147.5,
    });
    fireEvent.click(storeBItem, { detail: 1 });

    expect(storeBItem).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.queryByLabelText("Selected item actions"),
    ).not.toBeInTheDocument();
    expect(storeA.getState()).toMatchObject({ revision: 1, receipts: [] });
    expect(storeB.getState()).toMatchObject({ revision: 1, receipts: [] });
  });

  it("suppresses the trailing pointer click after an accepted same-store replace reuses the item id", () => {
    const store = renderEditor(makeRoom({ items: [makePlacedItem()] }));
    const item = screen.getByRole("button", { name: "Select Test Chair" });
    fireEvent.pointerDown(item, {
      pointerId: 12,
      clientX: 145,
      clientY: 147.5,
    });
    fireEvent.pointerMove(item, {
      pointerId: 12,
      clientX: 197.5,
      clientY: 147.5,
    });
    expect(screen.getByText("chair")).toHaveAttribute("x", "197.5");

    act(() => {
      store.getState().transact({
        expectedRevision: 1,
        origin: "template",
        change: {
          type: "replace",
          room: makeRoom({
            items: [
              makePlacedItem({ pose: { x: 2, y: 1, rotationDeg: 0 } }),
            ],
          }),
        },
      });
    });

    expect(screen.getByText("chair")).toHaveAttribute("x", "250");
    const replacementItem = screen.getByRole("button", {
      name: "Select Test Chair",
    });
    fireEvent.lostPointerCapture(replacementItem, { pointerId: 12 });
    fireEvent.pointerUp(replacementItem, {
      pointerId: 12,
      clientX: 197.5,
      clientY: 147.5,
    });
    fireEvent.click(replacementItem, { detail: 1 });

    expect(store.getState().revision).toBe(2);
    expect(store.getState().receipts).toHaveLength(1);
    expect(store.getState().receipts[0]).toMatchObject({
      origin: "template",
      status: "accepted",
    });
    expect(store.getState().room.items[0]?.pose.x).toBe(2);
    expect(replacementItem).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.queryByLabelText("Selected item actions"),
    ).not.toBeInTheDocument();

    fireEvent.pointerDown(replacementItem, {
      pointerId: 14,
      clientX: 250,
      clientY: 147.5,
    });
    fireEvent.pointerUp(replacementItem, {
      pointerId: 14,
      clientX: 250,
      clientY: 147.5,
    });
    fireEvent.click(replacementItem, { detail: 1 });

    expect(replacementItem).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByLabelText("Selected item actions"),
    ).toBeInTheDocument();
    expect(store.getState()).toMatchObject({ revision: 2 });
    expect(store.getState().receipts).toHaveLength(1);
  });

  it("discards a suppressing pointer token on pointer cancel", () => {
    const store = renderEditor(makeRoom({ items: [makePlacedItem()] }));
    const item = screen.getByRole("button", { name: "Select Test Chair" });
    fireEvent.pointerDown(item, {
      pointerId: 16,
      clientX: 145,
      clientY: 147.5,
    });

    act(() => {
      store.getState().transact({
        expectedRevision: 1,
        origin: "template",
        change: {
          type: "replace",
          room: makeRoom({ items: [makePlacedItem()] }),
        },
      });
    });

    const replacementItem = screen.getByRole("button", {
      name: "Select Test Chair",
    });
    fireEvent.pointerCancel(replacementItem, { pointerId: 16 });
    fireEvent.click(replacementItem, { detail: 1 });

    expect(replacementItem).toHaveAttribute("aria-pressed", "true");
    expect(store.getState()).toMatchObject({ revision: 2 });
    expect(store.getState().receipts).toHaveLength(1);
  });

  it("discards an old-owner suppressing token on matching pointer cancel", () => {
    const room = makeRoom({ items: [makePlacedItem()] });
    const storeA = createRoomStore(room, TEST_TRANSACTION_DEPENDENCIES);
    const storeB = createRoomStore(room, TEST_TRANSACTION_DEPENDENCIES);
    const view = render(
      <RoomEditor2D store={storeA} viewport={TEST_VIEWPORT} />,
    );
    installIdentityScreenCtm(
      screen.getByRole("group", { name: "Test Room 2D room editor" }),
    );
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Select Test Chair" }),
      { pointerId: 18, clientX: 145, clientY: 147.5 },
    );

    view.rerender(<RoomEditor2D store={storeB} viewport={TEST_VIEWPORT} />);
    const storeBItem = screen.getByRole("button", {
      name: "Select Test Chair",
    });
    fireEvent.pointerCancel(storeBItem, { pointerId: 18 });
    fireEvent.click(storeBItem, { detail: 1 });

    expect(storeBItem).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByLabelText("Selected item actions"),
    ).toBeInTheDocument();
    expect(storeA.getState()).toMatchObject({ revision: 1, receipts: [] });
    expect(storeB.getState()).toMatchObject({ revision: 1, receipts: [] });
  });

  it("preserves an old-owner suppressing token on wrong pointer cancel", () => {
    const room = makeRoom({ items: [makePlacedItem()] });
    const storeA = createRoomStore(room, TEST_TRANSACTION_DEPENDENCIES);
    const storeB = createRoomStore(room, TEST_TRANSACTION_DEPENDENCIES);
    const view = render(
      <RoomEditor2D store={storeA} viewport={TEST_VIEWPORT} />,
    );
    installIdentityScreenCtm(
      screen.getByRole("group", { name: "Test Room 2D room editor" }),
    );
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Select Test Chair" }),
      { pointerId: 19, clientX: 145, clientY: 147.5 },
    );

    view.rerender(<RoomEditor2D store={storeB} viewport={TEST_VIEWPORT} />);
    const storeBItem = screen.getByRole("button", {
      name: "Select Test Chair",
    });
    fireEvent.pointerCancel(storeBItem, { pointerId: 20 });
    fireEvent.click(storeBItem, { detail: 1 });

    expect(storeBItem).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.queryByLabelText("Selected item actions"),
    ).not.toBeInTheDocument();
    expect(storeA.getState()).toMatchObject({ revision: 1, receipts: [] });
    expect(storeB.getState()).toMatchObject({ revision: 1, receipts: [] });
  });

  it("suppresses the trailing pointer click after accepted removal even if the id is re-added", () => {
    const placedItem = makePlacedItem();
    const store = createRoomStore(
      makeRoom({ items: [placedItem] }),
      {
        resolveProduct: (productId) =>
          productId === "chair-product"
            ? {
                catalogRef: { catalogId: "test-catalog", productId },
                snapshot: structuredClone(placedItem.snapshot),
              }
            : undefined,
        createItemId: () => placedItem.id,
      },
    );
    renderExistingStore(store);
    const item = screen.getByRole("button", { name: "Select Test Chair" });
    fireEvent.pointerDown(item, {
      pointerId: 13,
      clientX: 145,
      clientY: 147.5,
    });
    fireEvent.pointerMove(item, {
      pointerId: 13,
      clientX: 197.5,
      clientY: 147.5,
    });

    act(() => {
      store.getState().transact({
        expectedRevision: 1,
        origin: "webmcp",
        change: {
          type: "edit",
          operations: [{ type: "remove", itemId: placedItem.id }],
        },
      });
      store.getState().transact({
        expectedRevision: 2,
        origin: "webmcp",
        change: {
          type: "edit",
          operations: [
            {
              type: "add",
              productId: "chair-product",
              pose: { x: 1, y: 1, rotationDeg: 0 },
            },
          ],
        },
      });
      item.dispatchEvent(
        new TestPointerEvent("pointerup", {
          bubbles: true,
          pointerId: 13,
          clientX: 197.5,
          clientY: 147.5,
        }),
      );
      item.dispatchEvent(
        new MouseEvent("click", { bubbles: true, detail: 1 }),
      );
    });

    const readdedItem = screen.getByRole("button", {
      name: "Select Test Chair",
    });
    expect(readdedItem).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.queryByLabelText("Selected item actions"),
    ).not.toBeInTheDocument();
    expect(store.getState().revision).toBe(3);
    expect(store.getState().receipts).toHaveLength(2);
    expect(store.getState().receipts.every(({ status }) => status === "accepted"))
      .toBe(true);
  });

  it("keeps an external update visible and rejects the stale gesture on release", () => {
    const store = renderEditor(makeRoom({ items: [makePlacedItem()] }));
    const item = screen.getByRole("button", { name: "Select Test Chair" });

    fireEvent.pointerDown(item, {
      pointerId: 5,
      clientX: 145,
      clientY: 147.5,
    });
    fireEvent.pointerMove(item, {
      pointerId: 5,
      clientX: 197.5,
      clientY: 147.5,
    });
    expect(screen.getByText("chair")).toHaveAttribute("x", "197.5");

    act(() => {
      store.getState().transact({
        expectedRevision: 1,
        origin: "webmcp",
        change: {
          type: "edit",
          operations: [
            {
              type: "transform",
              itemId: "item_chair_1",
              pose: { x: 2 },
            },
          ],
        },
      });
    });

    expect(screen.getByText("chair")).toHaveAttribute("x", "250");
    expect(screen.getByText(/x 2 m, y 1 m, rotation 0°/u)).toBeVisible();

    fireEvent.pointerUp(item, {
      pointerId: 5,
      clientX: 197.5,
      clientY: 147.5,
    });

    expect(store.getState().revision).toBe(2);
    expect(store.getState().room.items[0]?.pose).toEqual({
      x: 2,
      y: 1,
      rotationDeg: 0,
    });
    expect(store.getState().receipts).toHaveLength(2);
    expect(store.getState().receipts[0]).toMatchObject({
      origin: "human",
      status: "rejected",
      revision: 2,
      code: "REVISION_CONFLICT",
    });
    expect(screen.getByLabelText("Human edit result")).toHaveTextContent(
      "Human edit attempt 1 rejected. Expected revision 1, but the room is at revision 2. Revision 2.",
    );
  });
});

describe("RoomEditor2D selected-item actions", () => {
  it("rotates and removes through one transaction each outside the SVG", () => {
    const store = renderEditor(
      makeRoom({
        items: [
          makePlacedItem({
            pose: { x: 1, y: 1, rotationDeg: 0 },
            snapshot: {
              ...makePlacedItem().snapshot,
              dimensions: { width: 1.2, depth: 0.6, height: 0.8 },
            },
          }),
        ],
      }),
    );
    const item = screen.getByRole("button", { name: "Select Test Chair" });
    fireEvent.keyDown(item, { key: " " });
    expect(item).toHaveAttribute("aria-pressed", "true");
    expect(store.getState().selectedItemId).toBeNull();
    const rotate = screen.getByRole("button", {
      name: "Rotate 90 degrees",
    });
    const remove = screen.getByRole("button", { name: "Remove Test Chair" });
    const svg = screen.getByRole("group", {
      name: "Test Room 2D room editor",
    });

    expect(svg).not.toContainElement(rotate);
    expect(svg).not.toContainElement(remove);

    fireEvent.click(rotate);

    expect(store.getState().revision).toBe(2);
    expect(store.getState().receipts).toHaveLength(1);
    expect(store.getState().room.items[0]?.pose.rotationDeg).toBe(90);
    expect(store.getState().selectedItemId).toBeNull();
    expect(store.getState().receipts[0]).toMatchObject({
      origin: "human",
      status: "accepted",
      affectedItemIds: ["item_chair_1"],
    });

    remove.focus();
    fireEvent.click(remove);

    expect(store.getState().revision).toBe(3);
    expect(store.getState().receipts).toHaveLength(2);
    expect(store.getState().room.items).toHaveLength(0);
    expect(store.getState().selectedItemId).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Rotate 90 degrees" }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Human edit result")).toHaveTextContent(
      "Human edit attempt 2 accepted. Applied 1 room operations. Revision 3.",
    );
    expect(svg).toHaveFocus();
  });
});
