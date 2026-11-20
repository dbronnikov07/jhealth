// A possible fall, seen by the camera. Plain rules on a few numbers per frame, unit-tested in scripts/fall.test.ts.
//
//   trunk lean (degrees from vertical, exercises.ts trunkLean): upright about 0 to 20; a squat or sit-to-stand leans
//   forward up to about 50; lying on the floor about 90.
//   hip height on screen (0 = top of the picture, 1 = bottom), and the torso's length on screen (shoulders to hips).
//
// Three ways a fall shows:
//   lying      the trunk is level and the hips are down near the feet
//   on the floor  the hips are far below where they are when standing (more than a chair or a squat takes them)
//   gone       the hips dropped fast, or the body was low or tilted, and then the person vanished from the picture
// A person on the floor is hard for the pose model: it finds them in one frame and loses them in the next. So the
// evidence is kept as one state, "down": it starts with a frame that looks like the floor (lying, or hips at floor
// height), or when the body is lost just after it was low or tilted, and it lasts through frames with nobody in
// them. Only someone clearly standing again (half a second), a second of anything else, or coming close ends it.
// (Live test, 20 November: lying on the floor in full view asked nothing, because every timer restarted whenever
// the model blinked.)
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
  downSeconds: number;    // "down" (on the floor, seen or not) this long before asking
  lowLeanDeg: number;     // trunk tilted this far (hips not high above the feet)...
  lowDrop: number;        // ...or hips this many torso lengths below standing: "low", remembered for a moment
  lowMemorySeconds: number; // lost within this time of being low = went down, not walked off
  standSeconds: number;   // clearly standing this long ends "down"
  unclearSeconds: number; // seen this long neither on the floor nor standing (kneeling up, sitting up) ends it too
};

/** What else the camera knows about a frame. Both are optional: without them the simpler rules apply. */
export type FallExtra = {
  torso?: number | null;          // shoulder-to-hip length on screen (share of the picture): grows when coming closer
  hipsAboveFeet?: number | null;  // metres the hips are above the ankles (world landmarks)
};

export const FALL_DEFAULTS: FallOptions = {
  uprightDeg: 35, lyingDeg: 65, uprightSeconds: 1, lyingSeconds: 1.5, dropFraction: 0.2, dropSeconds: 0.8, missingSeconds: 2.5,
  hipsDownMetres: 0.45, approachGrowth: 0.25, closeTorso: 0.42, floorDrop: 1.3, floorSeconds: 2,
  downSeconds: 1.8, lowLeanDeg: 55, lowDrop: 1.15, lowMemorySeconds: 1.5, standSeconds: 0.5, unclearSeconds: 1,
};

export class FallWatch {
  private wasUpright = false;
  private uprightSince = -1;
  private downSince = -1;               // on the floor since (through frames with nobody in them)
  private floorSeen = false;            // ...and at least one frame really showed the floor
  private standSince = -1;
  private unclearSince = -1;
  private lastLowAt = -1;               // when the body was last low or tilted
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
      this.clearDown();
      this.lastLowAt = -1;
      this.uprightSince = -1;
      return false;
    }

    const upright = leanDeg < this.o.uprightDeg;
    if (upright) {
      if (this.uprightSince < 0) this.uprightSince = t;
      if (t - this.uprightSince >= this.o.uprightSeconds) this.wasUpright = true;
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

    // How far the hips are below where they are when standing, in torso lengths (a chair: about 0.8; the floor: 1.5+).
    const drop = y !== null && this.baseHip !== null && this.baseTorso !== null ? (y - this.baseHip) / this.baseTorso : null;
    // Bowing forward (to reach the laptop, to pick something up) leans as far as lying does, but the hips stay
    // high above the feet. Lying down, they are at about the same height.
    const hipsUp = extra.hipsAboveFeet != null && Number.isFinite(extra.hipsAboveFeet) && extra.hipsAboveFeet >= this.o.hipsDownMetres;
    const lying = !upright && leanDeg >= this.o.lyingDeg && !hipsUp;
    const onFloor = drop !== null && drop >= this.o.floorDrop;
    if ((leanDeg >= this.o.lowLeanDeg && !hipsUp) || (drop !== null && drop >= this.o.lowDrop)) this.lastLowAt = t;

    if (this.wasUpright && (lying || onFloor)) {
      if (this.downSince < 0) this.downSince = t;
      this.floorSeen = true;
      this.standSince = -1;
      this.unclearSince = -1;
    } else if (upright && (drop === null || drop < 0.5)) {
      // Standing again, at standing height: whatever it was, they are up.
      this.unclearSince = -1;
      if (this.standSince < 0) this.standSince = t;
      if (t - this.standSince >= this.o.standSeconds) this.clearDown();
    } else {
      this.standSince = -1;
      if (this.downSince >= 0) {
        if (this.unclearSince < 0) this.unclearSince = t;
        if (t - this.unclearSince >= this.o.unclearSeconds) this.clearDown();
      }
    }
    return this.downLongEnough(t);
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
      // Lost just after being low or tilted: they went down (walking off happens upright, at standing height).
      const lostLow = !this.near && this.wasUpright && this.lastLowAt >= 0 && t - this.lastLowAt <= this.o.lowMemorySeconds;
      if (this.downSince < 0 && lostLow) this.downSince = t;
    }
    this.standSince = -1;
    this.unclearSince = -1;
    if (this.wasUpright && this.droppedBeforeLoss && t - this.missingSince >= this.o.missingSeconds) return this.fell();
    return this.downLongEnough(t);
  }

  /** Down for long enough to ask? Sooner when the floor was really seen than when the body only vanished. */
  private downLongEnough(t: number): boolean {
    if (this.downSince < 0 || !this.wasUpright) return false;
    return t - this.downSince >= (this.floorSeen ? this.o.downSeconds : this.o.missingSeconds) ? this.fell() : false;
  }

  private clearDown(): void {
    this.downSince = -1;
    this.floorSeen = false;
    this.standSince = -1;
    this.unclearSince = -1;
  }

  /** Forget everything (after a pause, or once the patient said they are okay): the next fall needs fresh evidence. */
  reset(): void {
    this.wasUpright = false;
    this.uprightSince = -1;
    this.clearDown();
    this.lastLowAt = -1;
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
    this.clearDown();
    this.lastLowAt = -1;
    this.droppedBeforeLoss = false;
    return true;
  }
}
