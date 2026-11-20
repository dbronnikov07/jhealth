// A possible fall, seen by the camera: someone who was standing or sitting upright ends up lying down, or drops fast
// and disappears from the picture. Plain rules on two numbers per frame, unit-tested in scripts/fall.test.ts.
//
//   trunk lean (degrees from vertical, exercises.ts trunkLean): upright about 0 to 20; a squat or sit-to-stand leans
//   forward up to about 50; lying on the floor about 90.
//   hip height on screen (0 = top of the picture, 1 = bottom).
//
// Two things that looked like falls and were not (a session on 20 November asked "Are you okay?" every time the
// patient walked off): bending forward to reach the laptop, and walking up to the camera. So lying also needs the
// hips to be down near the feet, and "dropped and vanished" does not count when the body was growing in the picture
// (coming closer) just before it was lost.
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
  hipsDownMetres: number; // lying: the hips are less than this far above the ankles (standing or bowing: about 0.8)
  approachGrowth: number; // the torso growing by this share on screen during the drop means walking up to the camera
};

/** What else the camera knows about a frame. Both are optional: without them the older, simpler rules apply. */
export type FallExtra = {
  torso?: number | null;          // shoulder-to-hip length on screen (share of the picture): grows when coming closer
  hipsAboveFeet?: number | null;  // metres the hips are above the ankles (world landmarks)
};

export const FALL_DEFAULTS: FallOptions = {
  uprightDeg: 35, lyingDeg: 65, uprightSeconds: 1, lyingSeconds: 1.5, dropFraction: 0.2, dropSeconds: 0.8, missingSeconds: 2.5,
  hipsDownMetres: 0.45, approachGrowth: 0.18,
};

export class FallWatch {
  private wasUpright = false;
  private uprightSince = -1;
  private lyingSince = -1;
  private missingSince = -1;
  private droppedBeforeLoss = false;
  private hips: { t: number; y: number; torso: number | null }[] = [];
  private o: FallOptions;

  constructor(options: Partial<FallOptions> = {}) {
    this.o = { ...FALL_DEFAULTS, ...options };
  }

  /** A frame with a body. Returns true once, when it looks like a fall. */
  seen(t: number, leanDeg: number, hipY: number | null, extra: FallExtra = {}): boolean {
    this.missingSince = -1;
    this.droppedBeforeLoss = false;
    if (hipY !== null && Number.isFinite(hipY)) {
      this.hips.push({ t, y: hipY, torso: extra.torso ?? null });
      while (this.hips.length && t - this.hips[0].t > this.o.dropSeconds) this.hips.shift();
    }
    if (leanDeg < this.o.uprightDeg) {
      if (this.uprightSince < 0) this.uprightSince = t;
      if (t - this.uprightSince >= this.o.uprightSeconds) this.wasUpright = true;
      this.lyingSince = -1;
      return false;
    }
    this.uprightSince = -1;
    // Bowing forward (to reach the laptop, to pick something up) leans as far as lying does, but the hips stay
    // high above the feet. Lying down, they are at about the same height.
    const hipsUp = extra.hipsAboveFeet != null && Number.isFinite(extra.hipsAboveFeet) && extra.hipsAboveFeet >= this.o.hipsDownMetres;
    if (leanDeg < this.o.lyingDeg || hipsUp) {
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
      // Walking up to the camera also moves the hips down the picture, but the body grows; in a fall it does not.
      const approaching = !!(first?.torso && last?.torso && last.torso / first.torso >= 1 + this.o.approachGrowth);
      this.droppedBeforeLoss = !!(first && last && last.y - first.y >= this.o.dropFraction) && !approaching;
      this.hips = [];
    }
    if (this.wasUpright && this.droppedBeforeLoss && t - this.missingSince >= this.o.missingSeconds) return this.fell();
    return false;
  }

  /** Forget everything (after a pause, or once the patient said they are okay): the next fall needs fresh evidence. */
  reset(): void {
    this.wasUpright = false;
    this.uprightSince = -1;
    this.lyingSince = -1;
    this.missingSince = -1;
    this.droppedBeforeLoss = false;
    this.hips = [];
  }

  private fell(): boolean {
    this.wasUpright = false;
    this.uprightSince = -1;
    this.lyingSince = -1;
    this.droppedBeforeLoss = false;
    return true;
  }
}
