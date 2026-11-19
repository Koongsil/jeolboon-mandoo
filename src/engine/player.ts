import { Assets } from './assets';
import { Avm } from './avm';
import { ButtonObj, Clip, DObj, GraphicObj, buildStates, type ButtonState } from './display';
import { Sound } from './sound';
import { IDENTITY, invert, mul, mulCT, type CT, type FrameDef, type Mat, type PlaceState, type SwfData } from './types';

export interface PlayerOptions {
  data: SwfData;
  canvas: HTMLCanvasElement;
  assets: Assets;
  sound: Sound;
  /** ActionScript sources keyed like "root/frame_92", "sprite_332/frame_7", "buttons/button_161". */
  actions: Record<string, string>;
}

type Action = { clip: Clip; key: string };

export class Player {
  readonly data: SwfData;
  root: Clip;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private assets: Assets;
  private sound: Sound;
  private actions: Record<string, string>;
  private avm: Avm;
  private states = new Map<string, Map<number, PlaceState>[]>();
  private queue: Action[] = [];
  private tickCount = 0;
  private scale = 1;
  private hovered: ButtonObj | null = null;
  private pressed: ButtonObj | null = null;
  private running = false;
  private layer?: HTMLCanvasElement;
  private maskLayer?: HTMLCanvasElement;
  private dirty = true;

  constructor(o: PlayerOptions) {
    this.data = o.data;
    this.canvas = o.canvas;
    this.ctx = o.canvas.getContext('2d')!;
    this.assets = o.assets;
    this.sound = o.sound;
    this.actions = o.actions;
    this.avm = new Avm(this);
    const rootState: PlaceState = { c: 0, at: 0, m: IDENTITY, ct: null, r: 0, cd: 0 };
    this.root = new Clip('root', o.data.root, this.timelineStates('root', o.data.root), rootState, 0);
    this.bindInput();
  }

  // ---------------------------------------------------------------- timeline

  private timelineStates(key: string, frames: FrameDef[]) {
    let s = this.states.get(key);
    if (!s) { s = buildStates(frames); this.states.set(key, s); }
    return s;
  }

  private create(s: PlaceState, depth: number, parent: Clip | ButtonObj): DObj | null {
    const def = this.data.chars[s.c];
    if (!def) return null;
    let o: DObj;
    switch (def.type) {
      case 'shape': case 'text': case 'morph':
        o = new GraphicObj(def, s, depth);
        break;
      case 'sprite': {
        const clip = new Clip(`sprite_${s.c}`, def.frames, this.timelineStates(`sprite_${s.c}`, def.frames), s, depth);
        clip.parent = parent;
        clip.bornTick = this.tickCount;
        this.goto(clip, 1);
        return clip;
      }
      case 'button': {
        const b = new ButtonObj(def, s, depth);
        b.parent = parent;
        this.setButtonState(b, 'up');
        return b;
      }
      default:
        return null;
    }
    o.parent = parent;
    return o;
  }

  private remove(o: DObj) {
    o.removed = true;
    if (o === this.hovered) this.hovered = null;
    if (o === this.pressed) this.pressed = null;
    if (o instanceof Clip) for (const c of o.children.values()) this.remove(c);
    if (o instanceof ButtonObj) for (const c of o.kids) this.remove(c);
  }

  /** Move a clip to a frame (1-based): rebuild display list, queue frame actions and sounds. */
  goto(clip: Clip, frame: number) {
    const f = Math.max(1, Math.min(clip.total, Math.floor(frame) || 1));
    if (clip.cur === f) return;
    const target = clip.states[f - 1];
    for (const [d, o] of clip.children) {
      const s = target.get(d);
      if (!s || s.c !== o.charId || s.at !== o.placedAt) {
        this.remove(o);
        clip.children.delete(d);
      }
    }
    clip.cur = f;
    const fd = clip.frames[f - 1];
    if (fd.act) this.queue.push({ clip, key: `${clip.key}/frame_${f}` });
    for (const [d, s] of target) {
      const o = clip.children.get(d);
      if (o) {
        if (!o.scriptMoved) o.m = s.m;
        if (!o.scriptCT) o.ct = s.ct;
        o.ratio = s.r;
        o.clipDepth = s.cd;
        if (s.n) o.name = s.n;
      } else {
        const n = this.create(s, d, clip);
        if (n) clip.children.set(d, n);
      }
    }
    if (fd.snd) for (const sc of fd.snd) this.sound.play(sc);
    this.dirty = true;
  }

  private advance(clip: Clip) {
    if (clip.playing && clip.bornTick !== this.tickCount && clip.total > 1) {
      this.goto(clip, clip.cur >= clip.total ? 1 : clip.cur + 1);
    }
    for (const c of clip.sortedChildren()) {
      if (c.removed) continue;
      if (c instanceof Clip) this.advance(c);
      else if (c instanceof ButtonObj) for (const k of c.kids) if (k instanceof Clip && !k.removed) this.advance(k);
    }
  }

  private runQueue() {
    let guard = 0;
    while (this.queue.length && guard++ < 10000) {
      const a = this.queue.shift()!;
      if (a.clip.removed) continue;
      const src = this.actions[a.key];
      if (src) this.avm.run(a.clip, a.key, src);
    }
  }

  tick() {
    this.tickCount++;
    this.advance(this.root);
    this.runQueue();
    this.dirty = true;
  }

  start() {
    this.goto(this.root, 1);
    this.runQueue();
    this.running = true;
    const interval = 1000 / this.data.fps;
    let last = performance.now();
    let acc = 0;
    const loop = (now: number) => {
      if (!this.running) return;
      acc += now - last;
      last = now;
      if (acc > 1000) acc = interval; // tab was hidden; don't fast-forward
      while (acc >= interval) { this.tick(); acc -= interval; }
      if (this.dirty) { this.render(); this.dirty = false; }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  // ---------------------------------------------------------------- buttons

  private setButtonState(b: ButtonObj, st: ButtonState) {
    b.state = st;
    for (const k of b.kids) this.remove(k);
    b.kids = [];
    const bit = st === 'up' ? 1 : st === 'over' ? 2 : 4;
    for (const r of [...b.def.recs].sort((x, y) => x.d - y.d)) {
      if (!(r.s & bit)) continue;
      const k = this.create({ c: r.c, at: 0, m: r.m, ct: r.ct ?? null, r: 0, cd: 0 }, r.d, b);
      if (k) b.kids.push(k);
    }
    this.dirty = true;
  }

  private buttonSound(b: ButtonObj, i: number) {
    const s = b.def.snd?.[i];
    if (s) this.sound.play(s);
  }

  private hitChar(charId: number, ratio: number, x: number, y: number, m: Mat, depth = 0): boolean {
    const def = this.data.chars[charId];
    if (!def || depth > 20) return false;
    if (def.type === 'shape' || def.type === 'text' || def.type === 'morph') {
      const inv = invert(m);
      if (!inv) return false;
      const lx = inv[0] * x + inv[2] * y + inv[4];
      const ly = inv[1] * x + inv[3] * y + inv[5];
      return this.assets.hit(charId, def, ratio, lx, ly);
    }
    if (def.type === 'sprite') {
      const st = this.timelineStates(`sprite_${charId}`, def.frames)[0];
      for (const s of st.values()) if (!s.cd && this.hitChar(s.c, s.r, x, y, mul(m, s.m), depth + 1)) return true;
    }
    return false;
  }

  private hitButton(b: ButtonObj, x: number, y: number, m: Mat) {
    for (const r of b.def.recs) {
      if (r.s & 8 && this.hitChar(r.c, 0, x, y, mul(m, r.m))) return true;
    }
    return false;
  }

  private findButton(clip: Clip, x: number, y: number, m: Mat): ButtonObj | null {
    const kids = clip.sortedChildren();
    for (let i = kids.length - 1; i >= 0; i--) {
      const c = kids[i];
      if (!c.visible || c.clipDepth) continue;
      const cm = mul(m, c.m);
      if (c instanceof ButtonObj) { if (this.hitButton(c, x, y, cm)) return c; }
      else if (c instanceof Clip) { const r = this.findButton(c, x, y, cm); if (r) return r; }
    }
    return null;
  }

  private toStage(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * this.data.width, y: ((e.clientY - r.top) / r.height) * this.data.height };
  }

  private updateHover(e: PointerEvent) {
    const p = this.toStage(e);
    const b = this.findButton(this.root, p.x, p.y, IDENTITY);
    if (b !== this.hovered) {
      if (this.hovered && !this.hovered.removed) {
        this.setButtonState(this.hovered, 'up');
        this.buttonSound(this.hovered, 0);
      }
      this.hovered = b;
      if (b) {
        this.setButtonState(b, this.pressed === b ? 'down' : 'over');
        this.buttonSound(b, 1);
      }
      this.canvas.style.cursor = b ? 'pointer' : 'default';
    }
  }

  private bindInput() {
    this.canvas.addEventListener('pointermove', (e) => this.updateHover(e));
    this.canvas.addEventListener('pointerdown', (e) => {
      this.updateHover(e);
      if (!this.hovered) return;
      this.pressed = this.hovered;
      this.setButtonState(this.pressed, 'down');
      this.buttonSound(this.pressed, 2);
    });
    this.canvas.addEventListener('pointerup', (e) => {
      this.updateHover(e);
      const b = this.pressed;
      this.pressed = null;
      if (!b || b.removed || b !== this.hovered) return;
      this.setButtonState(b, 'over');
      this.buttonSound(b, 3);
      const parent = b.parent;
      if (parent instanceof Clip) {
        this.queue.push({ clip: parent, key: `buttons/button_${b.charId}` });
        this.runQueue();
      }
      // the release may have changed the scene; recompute hover
      this.hovered = null;
      this.updateHover(e);
    });
    this.canvas.addEventListener('pointerleave', () => {
      if (this.hovered && !this.hovered.removed) this.setButtonState(this.hovered, 'up');
      this.hovered = null;
      this.pressed = null;
    });
  }

  // ---------------------------------------------------------------- render

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.scale = this.canvas.width / this.data.width;
    this.assets.setRes(Math.min(4, Math.max(1, Math.ceil(this.scale * 2) / 2)));
    this.layer = undefined;
    this.maskLayer = undefined;
    this.dirty = true;
  }

  private offscreen(which: 'layer' | 'maskLayer') {
    let c = this[which];
    if (!c) { c = document.createElement('canvas'); this[which] = c; }
    c.width = this.canvas.width;
    c.height = this.canvas.height;
    return c;
  }

  render() {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = this.data.bg;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const s = this.scale;
    this.drawClip(ctx, this.root, [s, 0, 0, s, 0, 0], null);
  }

  private drawList(ctx: CanvasRenderingContext2D, kids: DObj[], m: Mat, ct: CT | null) {
    for (let i = 0; i < kids.length; i++) {
      const c = kids[i];
      if (c.clipDepth) {
        // mask: draw children up to clipDepth into a layer, then keep only the masked area
        const masked: DObj[] = [];
        while (i + 1 < kids.length && kids[i + 1].depth <= c.clipDepth) masked.push(kids[++i]);
        const layer = this.offscreen('layer');
        const lctx = layer.getContext('2d')!;
        this.drawList(lctx, masked, m, ct);
        const mask = this.offscreen('maskLayer');
        const mctx = mask.getContext('2d')!;
        this.drawObj(mctx, c, m, null, true);
        lctx.setTransform(1, 0, 0, 1, 0, 0);
        lctx.globalAlpha = 1;
        lctx.globalCompositeOperation = 'destination-in';
        lctx.drawImage(mask, 0, 0);
        lctx.globalCompositeOperation = 'source-over';
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
        ctx.drawImage(layer, 0, 0);
        this.layer = undefined; // nested masks get fresh layers
        this.maskLayer = undefined;
        continue;
      }
      this.drawObj(ctx, c, m, ct);
    }
  }

  private drawObj(ctx: CanvasRenderingContext2D, c: DObj, pm: Mat, pct: CT | null, asMask = false) {
    if (!c.visible) return;
    const m = mul(pm, c.m);
    const ct = asMask ? null : mulCT(pct, c.ct);
    if (c instanceof Clip) this.drawClip(ctx, c, m, ct);
    else if (c instanceof ButtonObj) this.drawList(ctx, c.kids, m, ct);
    else if (c instanceof GraphicObj) this.drawGraphic(ctx, c, m, ct);
  }

  private drawClip(ctx: CanvasRenderingContext2D, clip: Clip, m: Mat, ct: CT | null) {
    this.drawList(ctx, clip.sortedChildren(), m, ct);
  }

  private drawGraphic(ctx: CanvasRenderingContext2D, g: GraphicObj, m: Mat, ct: CT | null) {
    const def = g.def;
    let alpha = 1;
    let rct: CT | null = null;
    if (ct) {
      const alphaOnly = ct[0] === 1 && ct[1] === 1 && ct[2] === 1 && !ct[4] && !ct[5] && !ct[6] && !ct[7];
      if (alphaOnly) alpha = ct[3];
      else rct = ct;
    }
    if (alpha <= 0) return;
    const img = this.assets.raster(g.charId, def, g.ratio, rct);
    if (!img) return;
    ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.imageSmoothingEnabled = !def.pixelated;
    ctx.drawImage(img, def.ox, def.oy, def.w, def.h);
    ctx.imageSmoothingEnabled = true;
  }
}
