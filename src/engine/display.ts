import type { ButtonDef, CT, FrameDef, GraphicDef, Mat, PlaceState } from './types';

export type ButtonState = 'up' | 'over' | 'down';

export abstract class DObj {
  parent: Clip | ButtonObj | null = null;
  depth = 0;
  charId = 0;
  placedAt = -1;
  name = '';
  m: Mat;
  ct: CT | null = null;
  ratio = 0;
  clipDepth = 0;
  visible = true;
  /** Set when ActionScript changed position/alpha; timeline no longer overrides it. */
  scriptMoved = false;
  scriptCT = false;
  removed = false;

  constructor(s: PlaceState, depth: number) {
    this.charId = s.c;
    this.placedAt = s.at;
    this.depth = depth;
    this.m = s.m;
    this.ct = s.ct;
    this.ratio = s.r;
    this.name = s.n ?? '';
    this.clipDepth = s.cd;
  }
}

export class GraphicObj extends DObj {
  constructor(public def: GraphicDef, s: PlaceState, depth: number) { super(s, depth); }
}

export class Clip extends DObj {
  cur = 0;
  playing = true;
  children = new Map<number, DObj>();
  vars: Record<string, unknown> = Object.create(null);
  bornTick = 0;
  labels: Record<string, number> = {};

  constructor(public key: string, public frames: FrameDef[], public states: Map<number, PlaceState>[], s: PlaceState, depth: number) {
    super(s, depth);
    frames.forEach((f, i) => { if (f.label) this.labels[f.label.toLowerCase()] = i + 1; });
  }

  get total() { return this.frames.length; }

  sortedChildren(): DObj[] {
    return [...this.children.values()].sort((a, b) => a.depth - b.depth);
  }

  childByName(name: string): DObj | undefined {
    for (const c of this.children.values()) if (c.name === name) return c;
    const lower = name.toLowerCase(); // SWF6 and earlier: instance names are case-insensitive
    for (const c of this.children.values()) if (c.name.toLowerCase() === lower) return c;
    return undefined;
  }
}

export class ButtonObj extends DObj {
  state: ButtonState = 'up';
  kids: DObj[] = [];
  constructor(public def: ButtonDef, s: PlaceState, depth: number) { super(s, depth); }
}

/** Precompute the display list (depth -> state) for every frame of a timeline. */
export function buildStates(frames: FrameDef[]): Map<number, PlaceState>[] {
  const out: Map<number, PlaceState>[] = [];
  let cur = new Map<number, PlaceState>();
  frames.forEach((f, i) => {
    cur = new Map(cur);
    for (const op of f.ops) {
      if (op.t === 'r') { cur.delete(op.d); continue; }
      const prev = cur.get(op.d);
      if (op.c !== undefined) {
        cur.set(op.d, {
          c: op.c,
          at: i,
          m: op.m ?? (op.mv && prev ? prev.m : [1, 0, 0, 1, 0, 0]),
          ct: op.ct ?? (op.mv && prev ? prev.ct : null),
          r: op.r ?? (op.mv && prev ? prev.r : 0),
          n: op.n ?? (op.mv && prev ? prev.n : undefined),
          cd: op.cd ?? (op.mv && prev ? prev.cd : 0),
        });
      } else if (prev) {
        cur.set(op.d, {
          ...prev,
          m: op.m ?? prev.m,
          ct: op.ct ?? prev.ct,
          r: op.r ?? prev.r,
          n: op.n ?? prev.n,
          cd: op.cd ?? prev.cd,
        });
      }
    }
    out.push(cur);
  });
  return out;
}
