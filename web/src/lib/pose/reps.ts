// Counts squat-like repetitions live, from the knee angle, one frame at a time.
//
// The same rules as the offline cutter (ml/extract_clips.py, find_reps), checked against a physiotherapist's
// hand-marked repetitions in scripts/reps.test.ts:
//   - a repetition is a dip of the knee angle at least `minDepth` degrees deep;
//   - it starts and ends where the knee is back within 5% of the way up (`edge`), plus 0.4 s of standing
//     before and 0.5 s after, so live repetitions look like the ones the model was trained on;
//   - it is reported `settleSeconds` after the person is back up (or as soon as the next dip begins).

export type RepCounterOptions = {
  minDepth: number;       // degrees
  edge: number;           // 0..1
  returnFraction: number; // how far back up counts as "up again"
  padStart: number;       // seconds
  padEnd: number;         // seconds
  smoothSeconds: number;
  settleSeconds: number;
};

export const DEFAULT_REP_OPTIONS: RepCounterOptions = {
  minDepth: 15,
  edge: 0.95,
  returnFraction: 0.85,
  padStart: 0.4,
  padEnd: 0.5,
  smoothSeconds: 0.2,
  settleSeconds: 0.5,
};

export type CompletedRep = {
  startIndex: number;   // indexes into the frames given to push(), padding included
  endIndex: number;
  startTime: number;    // seconds
  endTime: number;
  minKnee: number;      // smallest knee angle in the repetition, degrees
  topKnee: number;      // knee angle when standing, degrees
  depth: number;        // topKnee - minKnee
  activeSeconds: number; // the moving part only, without the standing padding
};

export class RepCounter {
  readonly times: number[] = [];
  readonly knee: number[] = []; // smoothed
  private raw: number[] = [];
  private phase: "up" | "down" | "rising" = "up";
  private segmentStart = 0;
  private leftTop = -Infinity;
  private valley = -1;
  private risenAt = -1;
  private rightTop = -Infinity;
  private rightTopIndex = -1;

  private o: RepCounterOptions;

  constructor(options: RepCounterOptions = DEFAULT_REP_OPTIONS) {
    this.o = options;
  }

  /** Lowest smoothed knee angle in the current dip (for live display), or null when standing. */
  get currentDepth(): number | null {
    return this.phase === "up" ? null : this.leftTop - this.knee[this.valley];
  }

  get isDown(): boolean {
    return this.phase === "down";
  }

  /** Add one frame. Returns a repetition when one has just been completed. */
  push(time: number, kneeAngle: number): CompletedRep | null {
    const i = this.times.length;
    this.times.push(time);
    this.raw.push(kneeAngle);
    let sum = 0;
    let n = 0;
    for (let j = i; j >= 0 && time - this.times[j] <= this.o.smoothSeconds; j--) {
      sum += this.raw[j];
      n++;
    }
    const k = sum / n;
    this.knee.push(k);

    if (this.phase === "up") {
      this.leftTop = Math.max(this.leftTop, k);
      if (k < this.leftTop - this.o.minDepth) {
        this.phase = "down";
        this.valley = i;
      }
      return null;
    }

    if (this.phase === "down") {
      if (k < this.knee[this.valley]) this.valley = i;
      const bottom = this.knee[this.valley];
      if (k >= bottom + this.o.returnFraction * (this.leftTop - bottom)) {
        this.phase = "rising";
        this.risenAt = i;
        this.rightTop = k;
        this.rightTopIndex = i;
      }
      return null;
    }

    // rising: wait until the person has settled at the top, or starts the next dip
    if (k > this.rightTop) {
      this.rightTop = k;
      this.rightTopIndex = i;
    }
    const settled = time - this.times[this.risenAt] >= this.o.settleSeconds;
    const nextDip = k < this.rightTop - 3;
    if (!settled && !nextDip) return null;
    return this.finish(i);
  }

  private finish(now: number): CompletedRep {
    const k = this.knee;
    const v = this.valley;
    const top = Math.min(this.leftTop, this.rightTop);
    const threshold = k[v] + this.o.edge * (top - k[v]);
    let s = v;
    while (s > this.segmentStart && k[s] < threshold) s--;
    let e = v;
    while (e < now && k[e] < threshold) e++;

    let startIndex = s;
    while (startIndex > this.segmentStart && this.times[s] - this.times[startIndex - 1] <= this.o.padStart) startIndex--;
    let endIndex = e;
    const endLimit = Math.max(e, this.rightTopIndex);
    while (endIndex < endLimit && this.times[endIndex + 1] - this.times[e] <= this.o.padEnd) endIndex++;

    const rep: CompletedRep = {
      startIndex,
      endIndex,
      startTime: this.times[startIndex],
      endTime: this.times[endIndex],
      minKnee: k[v],
      topKnee: top,
      depth: top - k[v],
      activeSeconds: this.times[e] - this.times[s],
    };

    // The next repetition can only start after this one's top.
    this.segmentStart = e;
    this.phase = "up";
    this.leftTop = -Infinity;
    for (let j = e; j <= now; j++) this.leftTop = Math.max(this.leftTop, k[j]);
    this.valley = -1;
    return rep;
  }
}
