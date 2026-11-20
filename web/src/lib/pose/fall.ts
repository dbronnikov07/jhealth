// A possible fall, seen by the camera: someone who was standing or sitting upright ends up lying down, or drops fast
// and disappears from the picture. Plain rules on two numbers per frame, unit-tested in scripts/fall.test.ts.
//
//   trunk lean (degrees from vertical, exercises.ts trunkLean): upright about 0 to 20; a squat or sit-to-stand leans
//   forward up to about 50; lying on the floor about 90.
//   hip height on screen (0 = top of the picture, 1 = bottom).
//
// It only asks "Are you okay?". It never calls anyone by itself: the patient answers, or taps a button.

export type FallOptions = {
  uprightDeg: number;     // below this the trunk counts as upright
  lyingDeg: number;       // at or above this it counts as lying
  uprightSeconds: number; // upright this long first, so someone already lying on a mat is not a fall
  lyingSeconds: number;   // lying this long before asking
  dropFraction: number;   // hips moving down this share of the picture height...
  dropSeconds: number;    // ...within this time, just before the person is lost, is a drop
  missingSeconds: number; // lost this long after a drop
};

export const FALL_DEFAULTS: FallOptions = {
  uprightDeg: 35, lyingDeg: 65, uprightSeconds: 1, lyingSeconds: 1, dropFraction: 0.2, dropSeconds: 0.8, missingSeconds: 1.5,
};

export class FallWatch {
  private wasUpright = false;
  private uprightSince = -1;
  private lyingSince = -1;
  private missingSince = -1;
  private droppedBeforeLoss = false;
  private hips: { t: number; y: number }[] = [];
  private o: FallOptions;

  constructor(options: Partial<FallOptions> = {}) {
    this.o = { ...FALL_DEFAULTS, ...options };
  }

  /** A frame with a body. Returns true once, when it looks like a fall. */
  seen(t: number, leanDeg: number, hipY: number | null): boolean {
    this.missingSince = -1;
    this.droppedBeforeLoss = false;
    if (hipY !== null && Number.isFinite(hipY)) {
      this.hips.push({ t, y: hipY });
      while (this.hips.length && t - this.hips[0].t > this.o.dropSeconds) this.hips.shift();
    }
    if (leanDeg < this.o.uprightDeg) {
      if (this.uprightSince < 0) this.uprightSince = t;
      if (t - this.uprightSince >= this.o.uprightSeconds) this.wasUpright = true;
      this.lyingSince = -1;
      return false;
    }
    this.uprightSince = -1;
    if (leanDeg < this.o.lyingDeg) {
      this.lyingSince = -1;
      return false;
    }
    if (this.lyingSince < 0) this.lyingSince = t;
    if (this.wasUpright && t - this.lyingSince >= this.o.lyingSeconds) return this.fell();
    return false;
  }

  /** A frame with nobody in it. Returns true once, when someone dropped fast and then vanished. */
  missing(t: number): boolean {
    if (this.missingSince < 0) {
      this.missingSince = t;
      const first = this.hips[0];
      const last = this.hips[this.hips.length - 1];
      this.droppedBeforeLoss = !!(first && last && last.y - first.y >= this.o.dropFraction);
      this.hips = [];
    }
    if (this.wasUpright && this.droppedBeforeLoss && t - this.missingSince >= this.o.missingSeconds) return this.fell();
    return false;
  }

  private fell(): boolean {
    this.wasUpright = false;
    this.uprightSince = -1;
    this.lyingSince = -1;
    this.droppedBeforeLoss = false;
    return true;
  }
}
