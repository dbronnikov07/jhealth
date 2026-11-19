// Camera setup is part of measurement quality. A pose model can invent landmarks when
// knees, ankles, wrists, or hips are outside the frame; never let those frames create a
// repetition or a quality score. This module deliberately has no MediaPipe dependency so
// it can be tested with ordinary landmark-shaped objects.

export type ScreenLandmark = { x: number; y: number; visibility?: number };

const TORSO = [11, 12, 23, 24];
const LEFT_LEG = [23, 25, 27];
const RIGHT_LEG = [24, 26, 28];
const LEFT_ARM = [11, 13, 15];
const RIGHT_ARM = [12, 14, 16];

/**
 * Returns a plain-language setup instruction, or null when the joints needed for the
 * exercise are clearly inside the camera view. The generous edge leaves room for normal
 * detector jitter without accepting a cropped foot, knee, wrist, or hip.
 */
export function poseSetupIssue(exerciseId: string, points: ScreenLandmark[] | undefined): string | null {
  if (!points || points.length < 29) return "Step into view so the camera can find you.";
  const visible = (needed: number[]) => needed.every((i) => {
    const p = points[i];
    return p && Number.isFinite(p.x) && Number.isFinite(p.y)
      && (p.visibility ?? 1) >= 0.45
      && p.x >= 0.02 && p.x <= 0.98 && p.y >= 0.02 && p.y <= 0.98;
  });
  // Squat/sit-to-stand need both legs: their signal and quality features use both.
  // Extension and arm raise are intentionally one-sided, so side-on phone footage is
  // accepted when the working leg/arm is clear rather than demanding an occluded far side.
  const usable = exerciseId === "seated_knee_extension"
    ? visible(TORSO) && (visible(LEFT_LEG) || visible(RIGHT_LEG))
    : exerciseId === "arm_raise"
      ? visible(TORSO) && (visible(LEFT_ARM) || visible(RIGHT_ARM))
      : visible([...TORSO, ...LEFT_LEG, ...RIGHT_LEG]);
  if (usable) return null;
  return exerciseId === "arm_raise"
    ? "Step back so your upper body, hips, hands and wrists are in view."
    : "Step back so your whole body, knees and feet are in view.";
}

/** Keep expensive Heavy Pose inference predictable on older phones and laptops. */
export const ANALYSIS_INTERVAL_MS = 1000 / 15;

/**
 * iPhones work best in portrait for a standing full-body view; laptops generally have a
 * landscape webcam. These are ideals, not hard requirements, so Safari/Chrome can safely
 * choose the closest supported camera mode.
 */
export function cameraConstraints(isPhone: boolean): MediaTrackConstraints {
  return {
    facingMode: { ideal: "user" },
    width: { ideal: isPhone ? 720 : 1280 },
    height: { ideal: isPhone ? 1280 : 720 },
    frameRate: { ideal: 15, max: 30 },
  };
}

export function isPhoneDevice(userAgent: string): boolean {
  return /iPhone|Android.+Mobile|iPod/i.test(userAgent);
}
