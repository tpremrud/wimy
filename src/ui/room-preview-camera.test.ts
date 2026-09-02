import { PerspectiveCamera, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import {
  deriveRoomPreviewCamera,
  ROOM_PREVIEW_CAMERA_FOV,
} from "./room-preview-camera";

const corners = ([width, height, depth]: readonly [number, number, number]) =>
  [0, width].flatMap((x) =>
    [0, height].flatMap((y) => [0, depth].map((z) => new Vector3(x, y, z))),
  );

describe("deriveRoomPreviewCamera", () => {
  it.each([
    [[1, 2, 1], 0.4],
    [[1, 10, 1], 1],
    [[1, 2, 30], 0.4],
    [[1, 10, 30], 0.4],
    [[4.8, 2.7, 4.2], 16 / 9],
    [[30, 2, 1], 3],
    [[30, 10, 1], 3],
    [[30, 2, 30], 1],
    [[30, 10, 30], 1],
  ] as const)("keeps every room-box corner inside a safe NDC margin for %j at aspect %f", (dimensions, aspect) => {
    const frame = deriveRoomPreviewCamera(dimensions, aspect);
    const camera = new PerspectiveCamera(ROOM_PREVIEW_CAMERA_FOV, aspect, frame.near, frame.far);
    camera.position.set(...frame.position);
    camera.lookAt(...frame.target);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();

    for (const corner of corners(dimensions)) {
      const projected = corner.project(camera);
      expect(Math.abs(projected.x)).toBeLessThanOrEqual(0.9);
      expect(Math.abs(projected.y)).toBeLessThanOrEqual(0.9);
    }
  });
});
