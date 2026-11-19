/** Affine matrix [a, b, c, d, tx, ty] (Flash/Canvas order, pixels). */
export type Mat = [number, number, number, number, number, number];
/** Color transform [rMul, gMul, bMul, aMul, rAdd, gAdd, bAdd, aAdd]; mul is 0..1, add is -255..255. */
export type CT = [number, number, number, number, number, number, number, number];

export interface PlaceOp { t: 'p'; d: number; c?: number; mv?: 1; m?: Mat; ct?: CT; r?: number; n?: string; cd?: number }
export interface RemoveOp { t: 'r'; d: number }
export type Op = PlaceOp | RemoveOp;

export interface SoundCmd { id: number; stop?: 1; noMulti?: 1; loops?: number; inP?: number; outP?: number }

export interface FrameDef { ops: Op[]; snd?: SoundCmd[]; label?: string; act?: 1 }

export interface GraphicDef {
  type: 'shape' | 'text' | 'morph';
  src: string;
  w: number;
  h: number;
  ox: number;
  oy: number;
  ratios?: number[];
  /** Draw without smoothing (pixel art). */
  pixelated?: boolean;
}
export interface SpriteDef { type: 'sprite'; frames: FrameDef[] }
export interface ButtonRec { s: number; c: number; d: number; m: Mat; ct?: CT }
export interface ButtonDef { type: 'button'; recs: ButtonRec[]; snd?: (SoundCmd | null)[] }
export interface SoundDef { type: 'sound'; src: string }
export type CharDef = GraphicDef | SpriteDef | ButtonDef | SoundDef;

export interface SwfData {
  width: number;
  height: number;
  fps: number;
  bg: string;
  root: FrameDef[];
  chars: Record<string, CharDef>;
}

/** Display state of one depth at a given frame (precomputed). */
export interface PlaceState { c: number; at: number; m: Mat; ct: CT | null; r: number; n?: string; cd: number }

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

export function mul(p: Mat, q: Mat): Mat {
  // result = p * q  (apply q first, then p)
  return [
    p[0] * q[0] + p[2] * q[1],
    p[1] * q[0] + p[3] * q[1],
    p[0] * q[2] + p[2] * q[3],
    p[1] * q[2] + p[3] * q[3],
    p[0] * q[4] + p[2] * q[5] + p[4],
    p[1] * q[4] + p[3] * q[5] + p[5],
  ];
}

export function invert(m: Mat): Mat | null {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!det) return null;
  const a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}

/** Concatenate color transforms: apply child first, then parent. */
export function mulCT(parent: CT | null, child: CT | null): CT | null {
  if (!parent) return child;
  if (!child) return parent;
  return [
    child[0] * parent[0], child[1] * parent[1], child[2] * parent[2], child[3] * parent[3],
    child[4] * parent[0] + parent[4], child[5] * parent[1] + parent[5],
    child[6] * parent[2] + parent[6], child[7] * parent[3] + parent[7],
  ];
}
