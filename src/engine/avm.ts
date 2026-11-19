/**
 * Minimal AVM1 (ActionScript 1/2) runtime.
 * The decompiled .as sources are almost JavaScript; we translate the few
 * differences and run them inside a `with(scope)` block whose scope proxy
 * resolves names the way Flash 6 does (timeline variables, then child clips,
 * then movie-clip properties). Calls on missing objects are silently ignored,
 * as in Flash.
 */
import { ButtonObj, Clip, DObj } from './display';
import type { CT } from './types';

export interface TimelineHost {
  root: Clip;
  goto(clip: Clip, frame: number): void;
}

const NOOP = () => undefined;

/** A value standing in for "undefined movie clip": every access/call is a no-op. */
export const NULL_REF: any = new Proxy(function () {}, {
  get: (_t, k) => (k === Symbol.toPrimitive ? () => undefined : NULL_REF),
  set: () => true,
  apply: () => undefined,
  has: () => false,
});

const refs = new WeakMap<DObj, any>();
const unref = new WeakMap<object, DObj>();

/** Flash 6 Number(): undefined -> 0. */
function asNumber(v: unknown): number {
  if (v === undefined || v === null || v === NULL_REF) return 0;
  if (typeof v === 'object' || typeof v === 'function') return NaN;
  return Number(v);
}

const compiled = new Map<string, (scope: object) => void>();

function translate(src: string): string {
  let js = src;
  // on(release){ ... }  ->  body (button handler wrapper)
  js = js.replace(/^\s*on\s*\([^)]*\)\s*\{([\s\S]*)\}\s*$/, '$1');
  // AS1 operators
  js = js.replace(/\bor\b/g, '||').replace(/\band\b/g, '&&').replace(/<>/g, '!=');
  // x.y.gotoAndStop(  ->  __call(x.y, "gotoAndStop")(   (safe on non-clips)
  js = js.replace(
    /((?:[A-Za-z_$][\w$]*\.)*[A-Za-z_$][\w$]*)\.(gotoAndStop|gotoAndPlay|play|stop|nextFrame|prevFrame)\s*\(/g,
    '__call($1,"$2")(',
  );
  return js;
}

export function compile(key: string, src: string) {
  let fn = compiled.get(key);
  if (!fn) {
    const js = translate(src);
    try {
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      fn = new Function('__scope', `with(__scope){\n${js}\n}`) as (scope: object) => void;
    } catch (e) {
      console.error(`[avm] compile error in ${key}`, e, js);
      fn = NOOP;
    }
    compiled.set(key, fn);
  }
  return fn;
}

export class Avm {
  constructor(private host: TimelineHost) {}

  private builtins: Record<string, unknown> = {
    Number: asNumber,
    String,
    Boolean,
    Math,
    parseInt,
    parseFloat,
    isNaN,
    undefined: undefined,
    NaN,
    Infinity,
    trace: (...a: unknown[]) => console.log('[trace]', ...a),
    getURL: (url: string) => console.log('[getURL]', url),
    random: (n: number) => Math.floor(Math.random() * n),
    __call: (target: unknown, name: string) => {
      const obj = unref.get(target as object);
      if (obj instanceof Clip) return this.timelineMethod(obj, name);
      return NOOP;
    },
  };

  run(clip: Clip, key: string, src: string) {
    const fn = compile(key, src);
    try {
      fn(this.scope(clip));
    } catch (e) {
      console.error(`[avm] runtime error in ${key}`, e);
    }
  }

  ref(obj: DObj): any {
    let r = refs.get(obj);
    if (!r) {
      r = new Proxy(Object.create(null), {
        get: (_t, k) => (typeof k === 'string' ? this.getMember(obj, k) : undefined),
        set: (_t, k, v) => { if (typeof k === 'string') this.setMember(obj, k, v); return true; },
      });
      refs.set(obj, r);
      unref.set(r, obj);
    }
    return r;
  }

  private scope(clip: Clip) {
    return new Proxy(Object.create(null), {
      has: (_t, k) => typeof k === 'string',
      get: (_t, k) => {
        if (typeof k !== 'string') return undefined;
        if (k in this.builtins) return this.builtins[k];
        if (k === '_root') return this.ref(this.host.root);
        if (k === 'this') return this.ref(clip);
        const tm = this.timelineMethod(clip, k, true);
        if (tm) return tm;
        return this.getMember(clip, k);
      },
      set: (_t, k, v) => { if (typeof k === 'string') this.setMember(clip, k, v); return true; },
    });
  }

  private resolveFrame(clip: Clip, f: unknown): number {
    if (typeof f === 'string' && isNaN(Number(f))) return clip.labels[f.toLowerCase()] ?? clip.cur;
    return Math.floor(asNumber(f));
  }

  private timelineMethod(clip: Clip, name: string, strict = false): ((...a: unknown[]) => void) | undefined {
    const h = this.host;
    switch (name) {
      case 'stop': return () => { clip.playing = false; };
      case 'play': return () => { clip.playing = true; };
      case 'gotoAndStop': return (f) => { clip.playing = false; h.goto(clip, this.resolveFrame(clip, f)); };
      case 'gotoAndPlay': return (f) => { clip.playing = true; h.goto(clip, this.resolveFrame(clip, f)); };
      case 'nextFrame': return () => { clip.playing = false; h.goto(clip, clip.cur + 1); };
      case 'prevFrame': return () => { clip.playing = false; h.goto(clip, clip.cur - 1); };
    }
    return strict ? undefined : NOOP;
  }

  getMember(obj: DObj, k: string): unknown {
    if (obj instanceof Clip) {
      if (k in obj.vars) return obj.vars[k];
      const child = obj.childByName(k);
      if (child) return this.ref(child);
    }
    switch (k) {
      case '_currentframe': return obj instanceof Clip ? obj.cur : undefined;
      case '_totalframes': case '_framesloaded': return obj instanceof Clip ? obj.total : undefined;
      case '_x': return obj.m[4];
      case '_y': return obj.m[5];
      case '_xscale': return Math.hypot(obj.m[0], obj.m[1]) * 100;
      case '_yscale': return Math.hypot(obj.m[2], obj.m[3]) * 100;
      case '_alpha': return (obj.ct ? obj.ct[3] : 1) * 100;
      case '_visible': return obj.visible;
      case '_name': return obj.name;
      case '_parent': return obj.parent ? this.ref(obj.parent) : undefined;
    }
    if (obj instanceof Clip && this.timelineMethod(obj, k, true)) return this.timelineMethod(obj, k);
    return obj instanceof Clip || obj instanceof ButtonObj ? NULL_REF : undefined;
  }

  setMember(obj: DObj, k: string, v: unknown) {
    const n = asNumber(v);
    switch (k) {
      case '_x': obj.m = [...obj.m]; obj.m[4] = n; obj.scriptMoved = true; return;
      case '_y': obj.m = [...obj.m]; obj.m[5] = n; obj.scriptMoved = true; return;
      case '_xscale': case '_yscale': {
        const m = [...obj.m] as typeof obj.m;
        const i = k === '_xscale' ? 0 : 2;
        const cur = Math.hypot(m[i], m[i + 1]) || 1;
        m[i] *= n / 100 / cur; m[i + 1] *= n / 100 / cur;
        obj.m = m; obj.scriptMoved = true; return;
      }
      case '_alpha': {
        const ct: CT = obj.ct ? [...obj.ct] : [1, 1, 1, 1, 0, 0, 0, 0];
        ct[3] = n / 100; obj.ct = ct; obj.scriptCT = true; return;
      }
      case '_visible': obj.visible = Boolean(v); return;
    }
    if (obj instanceof Clip) obj.vars[k] = v;
  }
}
