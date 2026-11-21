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
  // In the picture, in torso lengths below the standing place (see FallPicture):
  lyingTop: number;       // head and shoulders this far down: lying, or on hands and knees
  sitTop: number;         // head and shoulders this far down...
  sitHips: number;        // ...with the hips this far down: sitting on the floor
  sitTopAlone: number;    // head and shoulders this far down when the hips cannot be seen
  goingTop: number;       // this far down counts as "low" when the body is lost right after
  fallSpeed: number;      // the head coming down this many torso lengths within fallWindow: falling, not sitting down
  fallWindow: number;
  standTop: number;       // head and shoulders back within this of standing: up again
};

/** What else the camera knows about a frame. All optional: without them the simpler rules apply. */
export type FallExtra = {
  torso?: number | null;          // shoulder-to-hip length on screen (share of the picture): grows when coming closer
  hipsAboveFeet?: number | null;  // metres the hips are above the ankles (world landmarks)
  picture?: FallPicture | null;   // where the body is in the picture itself (fallPicture): the main evidence
};

// ---- The picture itself (live tests on the evening of 20 November: people lay and sat on the floor in front of the
// camera and nothing was asked). Two things were wrong. The body's size "at the exercise spot" was taken from the
// first upright frame, which is usually next to the phone, so "hips at floor height" was measured with the wrong
// ruler and never reached. And with the feet cut off by the picture, the floor is not in it at all: someone lying
// there is simply gone. So now the main evidence is how far the head and shoulders are below where they are when the
// person stands at the spot, measured in torso lengths (a torso is about half a metre):
//   sitting on a chair about 0.9, a squat to a chair about 1.1, sitting on the floor about 1.6, lying about 2.5+
// The standing place is learned only from frames where the person really stands (trunk upright, thighs hanging
// down), and learned again when they settle further away or closer. Going down and then vanishing counts too.
export type FallPicture = {
  head: number | null;      // the nose's height in the picture (0 top, 1 bottom); null when the face is not seen
  shoulders: number;        // middle of the shoulders
  hips: number | null;      // middle of the hips; null when the model is only guessing them
  knee: number | null;      // the lower knee it can see
  ankle: number | null;     // the lower ankle it can see
  torso: number;            // shoulders to hips, in picture heights
  lean: number;             // the trunk's tilt in the picture, degrees from vertical (0 upright, 90 level)
  wide: number;             // width / height of the box around shoulders, hips and knees
  width: number;            // shoulder to shoulder, in picture heights
  x: number;                // where the body is across the picture (0 left edge, 1 right edge)
};

type Mark = { x: number; y: number; visibility?: number };

/** The few numbers the fall rules need from the pose model's picture landmarks. aspect = picture width / height. */
export function fallPicture(points: Mark[] | undefined, aspect: number): FallPicture | null {
  if (!points || points.length < 29) return null;
  const ok = (i: number) => Number.isFinite(points[i]?.x) && Number.isFinite(points[i]?.y);
  if (![11, 12, 23, 24].every(ok)) return null;
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const vis = (i: number, min = 0.3) => ok(i) && (points[i].visibility ?? 1) >= min;
  const sx = (points[11].x + points[12].x) / 2, sy = (points[11].y + points[12].y) / 2;
  const hx = (points[23].x + points[24].x) / 2, hy = (points[23].y + points[24].y) / 2;
  const face = [0, 2, 5, 7, 8].filter((i) => vis(i));
  const head = vis(0) ? points[0].y : face.length ? face.reduce((n, i) => n + points[i].y, 0) / face.length : null;
  const knees = [25, 26].filter((i) => vis(i));
  const box = [11, 12, 23, 24, ...knees].map((i) => points[i]);
  const xs = box.map((q) => q.x * a), ys = box.map((q) => q.y);
  return {
    head,
    shoulders: sy,
    hips: vis(23, 0.2) || vis(24, 0.2) ? hy : null,
    knee: knees.length ? Math.max(...knees.map((i) => points[i].y)) : null,
    ankle: [27, 28].some((i) => vis(i)) ? Math.max(...[27, 28].filter((i) => vis(i)).map((i) => points[i].y)) : null,
    torso: Math.hypot((sx - hx) * a, sy - hy),
    lean: (Math.atan2(Math.abs(sx - hx) * a, hy - sy) * 180) / Math.PI,
    wide: (Math.max(...xs) - Math.min(...xs)) / (Math.max(...ys) - Math.min(...ys) + 1e-6),
    width: Math.hypot((points[11].x - points[12].x) * a, points[11].y - points[12].y),
    x: (sx + hx) / 2,
  };
}

/**
 * Really standing: trunk upright in the picture, thighs hanging down from the hips, head above the shoulders. Someone
 * lying with their feet towards the camera looks like that too, only squashed: the shoulders come out wider than the
 * torso is long, so that is ruled out here (and by the 3D trunk lean, where the caller has it).
 */
function standingTall(p: FallPicture): boolean {
  return p.torso > 0.04 && p.lean < 25 && p.hips !== null && p.knee !== null && p.knee - p.hips >= 0.6 * p.torso
    && (p.head === null || p.head < p.shoulders) && p.width <= 1.15 * p.torso;
}

export const FALL_DEFAULTS: FallOptions = {
  uprightDeg: 35, lyingDeg: 65, uprightSeconds: 1, lyingSeconds: 1.5, dropFraction: 0.2, dropSeconds: 0.8, missingSeconds: 2,
  hipsDownMetres: 0.45, approachGrowth: 0.25, closeTorso: 0.42, floorDrop: 1.3, floorSeconds: 2,
  downSeconds: 1.2, lowLeanDeg: 55, lowDrop: 1.15, lowMemorySeconds: 1.5, standSeconds: 0.5, unclearSeconds: 1,
  lyingTop: 1.9, sitTop: 1.3, sitHips: 1.35, sitTopAlone: 1.55, goingTop: 1.25, fallSpeed: 0.8, fallWindow: 0.4, standTop: 0.5,
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
  private asked = false;                // already asked about this time on the floor: not again until they stand
  private baseHip: number | null = null;    // where the hips are on screen when standing at the exercise spot
  private baseTorso: number | null = null;  // how long the torso is on screen there
  private hips: { t: number; y: number }[] = [];
  // From the picture: where head, shoulders and hips are, and how long the torso is, when standing at the spot.
  private base: { head: number | null; shoulders: number; hips: number; torso: number; thigh: number | null } | null = null;
  private sizes: number[] = [];
  private farFrames = 0;
  private closeFrames = 0;
  private tops: { t: number; top: number }[] = [];
  private last: { top: number | null; hips: number | null; low: boolean } = { top: null, hips: null, low: false };
  private o: FallOptions;

  constructor(options: Partial<FallOptions> = {}) {
    this.o = { ...FALL_DEFAULTS, ...options };
  }

  /** Is the person closer to the camera than where they exercise? (Then nothing counts as a fall.) */
  get isNear(): boolean {
    return this.near;
  }

  /** What the rules see right now (shown on the test page; not used for anything else). */
  get debug() {
    return { ...this.last, near: this.near, standingPlace: this.base !== null, downSince: this.downSince, floorSeen: this.floorSeen };
  }

  /** A frame with a body. Returns true once, when it looks like a fall. */
  seen(t: number, leanDeg: number, hipY: number | null, extra: FallExtra = {}): boolean {
    this.missingSince = -1;
    this.droppedBeforeLoss = false;
    if (extra.picture) return this.seenPicture(t, leanDeg, extra.picture, extra);
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
      if (t - this.standSince >= this.o.standSeconds) { this.clearDown(); this.asked = false; }
    } else {
      this.standSince = -1;
      if (this.downSince >= 0) {
        if (this.unclearSince < 0) this.unclearSince = t;
        if (t - this.unclearSince >= this.o.unclearSeconds) this.clearDown();
      }
    }
    // Asked only while still down: someone who went down and is already getting up is not asked on the way.
    return this.wasUpright && (lying || onFloor) ? this.downLongEnough(t) : false;
  }

  /** A frame with a body, judged by where it is in the picture (see FallPicture). */
  private seenPicture(t: number, leanDeg: number, p: FallPicture, extra: FallExtra): boolean {
    const o = this.o;
    // The standing place: learned from frames where the person really stands, followed slowly while they stay,
    // learned again once they stand further back (at once) or closer (after standing there a few seconds).
    // Only someone standing still: the last ten such frames the same size (walking to or from the camera, or going
    // down backwards, changes the size from frame to frame).
    const tall = standingTall(p) && leanDeg < o.uprightDeg;
    if (tall) {
      this.sizes.push(p.torso);
      if (this.sizes.length > 10) this.sizes.shift();
    } else {
      this.sizes = [];
    }
    const settled = this.sizes.length >= 10 && Math.max(...this.sizes) <= 1.12 * Math.min(...this.sizes);
    if (tall) {
      if (!this.base) {
        if (settled && p.torso < o.closeTorso) this.setBase(p);
      } else {
        const b = this.base;
        const scale = p.torso / b.torso;
        if (scale < 0.85) {
          this.closeFrames = 0;
          // Further back. A standing person further away is the same figure shrunk towards the horizon, and the
          // horizon cannot be below the floor they stood on; a body on the floor, feet first, would put it there.
          const horizon = (p.hips! - scale * b.hips) / (1 - scale);
          const thigh = (p.knee! - p.hips!) / p.torso;
          const sameBuild = b.thigh === null || Math.abs(thigh / b.thigh - 1) < 0.3;
          if (settled && sameBuild && horizon <= b.hips + 2 * b.torso) { if (++this.farFrames >= 8) this.setBase(p); }
          else this.farFrames = 0;
        } else if (scale <= 1.18) {
          this.farFrames = 0;
          this.closeFrames = 0;
          b.torso += (p.torso - b.torso) * 0.02;
          b.shoulders += (p.shoulders - b.shoulders) * (p.shoulders < b.shoulders ? 0.3 : 0.05);
          if (p.head !== null) b.head = b.head === null ? p.head : b.head + (p.head - b.head) * (p.head < b.head ? 0.3 : 0.05);
          if (p.hips !== null) b.hips += (p.hips - b.hips) * 0.05;
        } else {
          this.farFrames = 0;
          if (++this.closeFrames >= 75 && settled && p.torso < o.closeTorso) this.setBase(p);
        }
      }
    } else {
      this.farFrames = 0;
      this.closeFrames = 0;
    }

    // Closer than the standing place: an upright body clearly bigger than it is there, or one that fills the picture.
    const scale = this.base ? p.torso / this.base.torso : 1;
    if ((scale >= 1.05 + o.approachGrowth && p.lean < 40) || p.torso >= o.closeTorso) this.near = true;
    else if (scale < 1 + o.approachGrowth * 0.6) this.near = false;
    if (this.near) {
      this.clearDown();
      this.lastLowAt = -1;
      this.uprightSince = -1;
      this.tops = [];
      this.last = { top: null, hips: null, low: false };
      return false;
    }

    if (leanDeg < o.uprightDeg) {
      if (this.uprightSince < 0) this.uprightSince = t;
      if (t - this.uprightSince >= o.uprightSeconds) this.wasUpright = true;
    } else {
      this.uprightSince = -1;
    }

    const hipsUp = extra.hipsAboveFeet != null && Number.isFinite(extra.hipsAboveFeet) && extra.hipsAboveFeet >= o.hipsDownMetres;
    const inside = p.x > 0.06 && p.x < 0.94;      // half out of the picture at the side: walking off, numbers are guesses
    const flat = (p.lean >= 65 && p.wide >= 1.2) || leanDeg >= o.lyingDeg;
    // Stretched out across the picture: trunk level, and knees and ankles at about the height of the hips (sitting
    // and bending forward to tie a shoe also levels the trunk, but the shins hang down). Needs no standing place.
    const stretched = p.lean >= 65 && p.wide >= 1.2 && p.hips !== null && p.knee !== null && p.ankle !== null
      && Math.abs(p.knee - p.hips) < 0.45 * p.torso && Math.abs(p.ankle - p.knee) < 0.45 * p.torso;
    const b = this.base;
    let low = false, standing = false, going = false;
    let top: number | null = null, hipDrop: number | null = null;
    if (b) {
      // How far head and shoulders are below standing, in torso lengths (the higher of the two decides: a bow takes
      // the head down but not the shoulders as far). The same for the hips, when the model can see them.
      const sh = (p.shoulders - b.shoulders) / b.torso;
      const hd = p.head !== null && b.head !== null ? (p.head - b.head) / b.torso : null;
      top = hd === null ? sh : Math.min(hd, sh);
      hipDrop = p.hips !== null ? (p.hips - b.hips) / b.torso : null;
      const lying = top >= o.lyingTop && (hipDrop === null || hipDrop >= 0.35);
      const sitting = top >= o.sitTop && (hipDrop === null ? top >= o.sitTopAlone : hipDrop >= o.sitHips);
      const slumped = top >= o.sitTopAlone && hipDrop !== null && hipDrop >= 0.95;
      const level = flat && !hipsUp && top >= 0.9 && (hipDrop === null ? top >= o.sitTopAlone : hipDrop >= 1.1);
      low = inside && (lying || sitting || slumped || level || stretched);
      standing = top < o.standTop && p.lean < 35;
      this.tops.push({ t, top });
      while (this.tops.length && t - this.tops[0].t > o.fallWindow) this.tops.shift();
      const falling = top >= 0.6 && top - this.tops[0].top >= o.fallSpeed;
      going = inside && (low || top >= o.goingTop || falling);
    } else {
      // Nobody has stood in view yet (a session started sitting down): only a level trunk counts.
      low = inside && this.wasUpright && ((flat && !hipsUp) || stretched);
      standing = leanDeg < o.uprightDeg && p.lean < 35;
      going = low;
    }
    this.last = { top, hips: hipDrop, low };
    if (going) this.lastLowAt = t;

    if ((b !== null || this.wasUpright) && low) {
      if (this.downSince < 0) this.downSince = t;
      this.floorSeen = true;
      this.standSince = -1;
      this.unclearSince = -1;
    } else if (standing) {
      this.unclearSince = -1;
      if (this.standSince < 0) this.standSince = t;
      if (t - this.standSince >= o.standSeconds) { this.clearDown(); this.asked = false; }
    } else {
      this.standSince = -1;
      if (this.downSince >= 0) {
        if (this.unclearSince < 0) this.unclearSince = t;
        if (t - this.unclearSince >= o.unclearSeconds) this.clearDown();
      }
    }
    return low ? this.downLongEnough(t) : false;
  }

  private setBase(p: FallPicture): void {
    const hips = p.hips ?? p.shoulders + p.torso;
    this.base = { head: p.head, shoulders: p.shoulders, hips, torso: p.torso, thigh: p.knee !== null ? (p.knee - hips) / p.torso : null };
    this.farFrames = 0;
    this.closeFrames = 0;
    this.tops = [];
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
      const lostLow = !this.near && this.armed && this.lastLowAt >= 0 && t - this.lastLowAt <= this.o.lowMemorySeconds;
      if (this.downSince < 0 && lostLow) this.downSince = t;
    }
    this.standSince = -1;
    this.unclearSince = -1;
    if (this.wasUpright && this.droppedBeforeLoss && t - this.missingSince >= this.o.missingSeconds) return this.fell();
    return this.downLongEnough(t);
  }

  /** Down for long enough to ask? Sooner when the floor was really seen than when the body only vanished. */
  private downLongEnough(t: number): boolean {
    if (this.downSince < 0 || !this.armed || this.asked) return false;
    return t - this.downSince >= (this.floorSeen ? this.o.downSeconds : this.o.missingSeconds) ? this.fell() : false;
  }

  /** Has this person been seen up (standing at the spot, or at least upright) since the last question? */
  private get armed(): boolean {
    return this.wasUpright || this.base !== null;
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
    this.asked = false;
    this.baseHip = null;
    this.baseTorso = null;
    this.hips = [];
    this.base = null;
    this.sizes = [];
    this.farFrames = 0;
    this.closeFrames = 0;
    this.tops = [];
    this.last = { top: null, hips: null, low: false };
  }

  private fell(): boolean {
    this.asked = true;
    this.wasUpright = false;
    this.uprightSince = -1;
    this.clearDown();
    this.lastLowAt = -1;
    this.droppedBeforeLoss = false;
    return true;
  }
}
