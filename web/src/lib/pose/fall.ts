// A possible fall, seen by the camera. Plain rules on a few numbers per frame, unit-tested in scripts/fall.test.ts.
//
//   trunk lean (degrees from vertical, exercises.ts trunkLean): upright about 0 to 20; a squat or sit-to-stand leans
//   forward up to about 50; lying on the floor about 90.
//   hip height on screen (0 = top of the picture, 1 = bottom), and the torso's length on screen (shoulders to hips).
//
// Three ways a fall shows:
//   lying      the trunk is level and the hips are down near the feet, for a second and a half
//   on the floor  the hips are far below where they are when standing (more than a chair or a squat takes them), and stay there
//   gone       the hips dropped fast and then the person vanished from the picture
// And one thing that is never a fall: coming closer to the camera. The body grows in the picture; while it is
// clearly bigger than at the exercise spot, nothing here fires (a session on 20 November asked "Are you okay?" every
// time the patient walked up to the laptop, and missed a real drop to the floor).
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
  approachGrowth: number; // the torso this much longer on screen than at the exercise spot = came closer
  closeTorso: number;     // a torso longer than this share of the picture: too close to judge anything
  floorDrop: number;      // hips this many torso lengths below standing height = on the floor (a chair: about 0.8)
  floorSeconds: number;   // ...for this long
};

/** What else the camera knows about a frame. Both are optional: without them the simpler rules apply. */
export type FallExtra = {
  torso?: number | null;          // shoulder-to-hip length on screen (share of the picture): grows when coming closer
  hipsAboveFeet?: number | null;  // metres the hips are above the ankles (world landmarks)
};

export const FALL_DEFAULTS: FallOptions = {
  uprightDeg: 35, lyingDeg: 65, uprightSeconds: 1, lyingSeconds: 1.5, dropFraction: 0.2, dropSeconds: 0.8, missingSeconds: 2.5,
  hipsDownMetres: 0.45, approachGrowth: 0.25, closeTorso: 0.42, floorDrop: 1.3, floorSeconds: 2,
};

export class FallWatch {
  private wasUpright = false;
  private uprightSince = -1;
  private lyingSince = -1;
  private floorSince = -1;
  private missingSince = -1;
  private droppedBeforeLoss = false;
  private near = false;                 // closer to the camera than the exercise spot
  private baseHip: number | null = null;    // where the hips are on screen when standing at the exercise spot
  private baseTorso: number | null = null;  // how long the torso is on screen there
  private hips: { t: number; y: number }[] = [];
  private o: FallOptions;

  constructor(options: Partial<FallOptions> = {}) {
    this.o = { ...FALL_DEFAULTS, ...options };
  }

  /** Is the person closer to the camera than where they exercise? (Then nothing counts as a fall.) */
  get isNear(): boolean {
    return this.near;
  }

  /** A frame with a body. Returns true once, when it looks like a fall. */
  seen(t: number, leanDeg: number, hipY: number | null, extra: FallExtra = {}): boolean {
    this.missingSince = -1;
    this.droppedBeforeLoss = false;
    const torso = extra.torso != null && Number.isFinite(extra.torso) && extra.torso > 0 ? extra.torso : null;
    const y = hipY !== null && Number.isFinite(hipY) ? hipY : null;
    if (y !== null) {
      this.hips.push({ t, y });
      while (this.hips.length && t - this.hips[0].t > this.o.dropSeconds) this.hips.shift();
    }

    // Closer than the exercise spot? The body is clearly bigger than it was there (or simply fills the picture).
    if (torso !== null) {
      const scale = this.baseTorso ? torso / this.baseTorso : 1;
      if (scale >= 1 + this.o.approachGrowth || torso >= this.o.closeTorso) this.near = true;
      else if (scale < 1 + this.o.approachGrowth * 0.5) this.near = false;
    }
    if (this.near) {
      this.lyingSince = -1;
      this.floorSince = -1;
      this.uprightSince = -1;
      return false;
    }

    const upright = leanDeg < this.o.uprightDeg;
    if (upright) {
      if (this.uprightSince < 0) this.uprightSince = t;
      if (t - this.uprightSince >= this.o.uprightSeconds) this.wasUpright = true;
      this.lyingSince = -1;
      // The exercise spot: the highest the hips get while upright (standing), and the torso's length there. Both
      // follow slowly, so moving the laptop a little is forgiven, but walking up to it is not mistaken for standing.
      if (y !== null) this.baseHip = this.baseHip === null ? y : Math.min(this.baseHip + 0.0005, y);
      if (torso !== null && y !== null && this.baseHip !== null && y - this.baseHip < 0.05) {
        if (this.baseTorso === null) this.baseTorso = torso;
        else if (Math.abs(torso / this.baseTorso - 1) < 0.12) this.baseTorso += (torso - this.baseTorso) * 0.02;
      }
    } else {
      this.uprightSince = -1;
    }

    // On the floor: the hips far below standing height, whatever the trunk does (sitting or kneeling after a fall).
    if (this.wasUpright && y !== null && this.baseHip !== null && this.baseTorso !== null
      && y - this.baseHip >= this.o.floorDrop * this.baseTorso) {
      if (this.floorSince < 0) this.floorSince = t;
      if (t - this.floorSince >= this.o.floorSeconds) return this.fell();
    } else {
      this.floorSince = -1;
    }

    if (upright) return false;
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
      // Walking up to the camera also takes the body out of the picture; that is not a drop.
      this.droppedBeforeLoss = !this.near && !!(first && last && last.y - first.y >= this.o.dropFraction);
      this.hips = [];
      this.floorSince = -1;
      this.lyingSince = -1;
    }
    if (this.wasUpright && this.droppedBeforeLoss && t - this.missingSince >= this.o.missingSeconds) return this.fell();
    return false;
  }

  /** Forget everything (after a pause, or once the patient said they are okay): the next fall needs fresh evidence. */
  reset(): void {
    this.wasUpright = false;
    this.uprightSince = -1;
    this.lyingSince = -1;
    this.floorSince = -1;
    this.missingSince = -1;
    this.droppedBeforeLoss = false;
    this.near = false;
    this.baseHip = null;
    this.baseTorso = null;
    this.hips = [];
  }

  private fell(): boolean {
    this.wasUpright = false;
    this.uprightSince = -1;
    this.lyingSince = -1;
    this.floorSince = -1;
    this.droppedBeforeLoss = false;
    return true;
  }
}
