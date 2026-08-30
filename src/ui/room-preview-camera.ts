export type CameraFrame = {
  far: number;
  near: number;
  position: [number, number, number];
  target: [number, number, number];
};

const CAMERA_FOV_DEGREES = 42;
const FIT_MARGIN = 1.18;

export const ROOM_PREVIEW_CAMERA_FOV = CAMERA_FOV_DEGREES;

export const deriveRoomPreviewCamera = (
  dimensions: readonly [number, number, number],
  aspect: number,
): CameraFrame => {
  const [width, height, depth] = dimensions;
  const radius = Math.hypot(width, height, depth) / 2;
  const verticalHalfAngle = (CAMERA_FOV_DEGREES * Math.PI) / 360;
  const horizontalHalfAngle = Math.atan(
    Math.tan(verticalHalfAngle) * Math.max(aspect, 0.01),
  );
  const distance = (radius / Math.sin(Math.min(verticalHalfAngle, horizontalHalfAngle))) * FIT_MARGIN;
  const target: CameraFrame["target"] = [width / 2, height / 2, depth / 2];
  const directionLength = Math.hypot(1, 0.8, 1);
  const direction = [1 / directionLength, 0.8 / directionLength, 1 / directionLength];

  return {
    target,
    position: [
      target[0] + direction[0] * distance,
      target[1] + direction[1] * distance,
      target[2] + direction[2] * distance,
    ],
    near: Math.max(0.01, distance - radius * 2),
    far: distance + radius * 2,
  };
};
