import type { CT, GraphicDef, SwfData } from './types';

/** Loads SVG graphics and rasterizes them (lazily) for fast canvas drawing. */
export class Assets {
  private images = new Map<string, CanvasImageSource>();
  private rasters = new Map<string, HTMLCanvasElement>();
  private alphaData = new Map<string, ImageData>();
  /** Raster resolution multiplier (pixels per stage unit). */
  res = 2;

  constructor(private base: string) {}

  async load(data: SwfData, onProgress: (done: number, total: number) => void) {
    const jobs: (() => Promise<void>)[] = [];
    for (const [id, c] of Object.entries(data.chars)) {
      if (c.type === 'shape' || c.type === 'text') {
        jobs.push(async () => { this.images.set(id, await loadSvg(this.base + c.src)); });
      } else if (c.type === 'morph') {
        jobs.push(async () => {
          const text = await (await fetch(this.base + c.src)).text();
          const ratios = new Set([0, ...(c.ratios ?? [])]);
          for (const r of ratios) {
            const svg = morphAt(text, r / 65535);
            const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
            this.images.set(`${id}@${r}`, await loadImage(url));
          }
        });
      }
    }
    let done = 0;
    const total = jobs.length;
    const queue = [...jobs];
    const worker = async () => {
      while (queue.length) {
        await queue.shift()!();
        onProgress(++done, total);
      }
    };
    await Promise.all(Array.from({ length: 8 }, worker));
  }

  /**
   * Replace a graphic character (shape/text) with a custom image.
   * `def` gives the new local bounds; the image is stretched to fit them.
   */
  replace(data: SwfData, id: number, def: Omit<GraphicDef, 'type' | 'src'>, image: CanvasImageSource) {
    const old = data.chars[id];
    if (!old || (old.type !== 'shape' && old.type !== 'text')) throw new Error(`character ${id} is not a shape/text`);
    data.chars[id] = { type: old.type, src: '', ...def };
    this.images.set(String(id), image);
    this.rasters.clear();
    this.alphaData.clear();
  }

  setRes(res: number) {
    if (res !== this.res) {
      this.res = res;
      this.rasters.clear();
      this.alphaData.clear();
    }
  }

  private imageKey(id: number, def: GraphicDef, ratio: number) {
    if (def.type !== 'morph') return String(id);
    // pick the nearest pre-rendered ratio
    const rs = [0, ...(def.ratios ?? [])];
    let best = rs[0];
    for (const r of rs) if (Math.abs(r - ratio) < Math.abs(best - ratio)) best = r;
    return `${id}@${best}`;
  }

  /** Raster of a graphic with an optional (non alpha-only) color transform applied. */
  raster(id: number, def: GraphicDef, ratio: number, ct: CT | null): HTMLCanvasElement | null {
    const ik = this.imageKey(id, def, ratio);
    const ctKey = ct ? ct.map((v) => Math.round(v * 1000)).join(',') : '';
    const key = ik + '|' + ctKey;
    let c = this.rasters.get(key);
    if (c) return c;
    let base = this.rasters.get(ik + '|');
    if (!base) {
      const img = this.images.get(ik);
      if (!img) return null;
      base = document.createElement('canvas');
      base.width = Math.max(1, Math.ceil(def.w * this.res));
      base.height = Math.max(1, Math.ceil(def.h * this.res));
      const bctx = base.getContext('2d')!;
      bctx.imageSmoothingEnabled = !def.pixelated;
      bctx.drawImage(img, 0, 0, base.width, base.height);
      this.rasters.set(ik + '|', base);
    }
    if (!ct) return base;
    c = document.createElement('canvas');
    c.width = base.width;
    c.height = base.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(base, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height);
    const p = d.data;
    for (let i = 0; i < p.length; i += 4) {
      if (p[i + 3] === 0 && ct[7] <= 0) continue;
      p[i] = p[i] * ct[0] + ct[4];
      p[i + 1] = p[i + 1] * ct[1] + ct[5];
      p[i + 2] = p[i + 2] * ct[2] + ct[6];
      p[i + 3] = p[i + 3] * ct[3] + ct[7];
    }
    ctx.putImageData(d, 0, 0);
    this.rasters.set(key, c);
    return c;
  }

  /** Whether the graphic has a visible pixel at local point (x, y). */
  hit(id: number, def: GraphicDef, ratio: number, x: number, y: number): boolean {
    const px = Math.floor((x - def.ox) * this.res);
    const py = Math.floor((y - def.oy) * this.res);
    const ik = this.imageKey(id, def, ratio);
    let d = this.alphaData.get(ik);
    if (!d) {
      const r = this.raster(id, def, ratio, null);
      if (!r) return false;
      d = r.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, r.width, r.height);
      this.alphaData.set(ik, d);
    }
    if (px < 0 || py < 0 || px >= d.width || py >= d.height) return false;
    return d.data[(py * d.width + px) * 4 + 3] > 0;
  }
}

/**
 * Load an SVG as an image. Safari/WebKit rejects SVGs whose width or height rounds to 0px
 * (e.g. a 0.25px-wide sliver), so on failure retry with a viewBox and at least 1px size.
 * The raster step stretches the image to the graphic's bounds, so the intrinsic size doesn't matter.
 */
async function loadSvg(url: string): Promise<HTMLImageElement> {
  try {
    return await loadImage(url);
  } catch (e) {
    const text = await (await fetch(url)).text();
    const fixed = text.replace(/<svg\b([^>]*)>/, (tag, attrs: string) => {
      const num = (name: string) => Number(attrs.match(new RegExp(`\\s${name}="([\\d.]+)(?:px)?"`))?.[1] ?? 0);
      const w = num('width');
      const h = num('height');
      if (/\sviewBox=/.test(attrs) || !(w > 0 || h > 0)) return tag;
      const rest = attrs.replace(/\s(width|height)="[^"]*"/g, '');
      return `<svg${rest} width="${Math.max(1, w)}px" height="${Math.max(1, h)}px" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">`;
    });
    if (fixed === text) throw e;
    const blob = URL.createObjectURL(new Blob([fixed], { type: 'image/svg+xml' }));
    try {
      return await loadImage(blob);
    } finally {
      URL.revokeObjectURL(blob);
    }
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('failed to load ' + url));
    img.src = url;
  });
}

/** Resolve FFDec's SMIL morph animation (`values="start;end"`) at ratio t. */
function morphAt(svgText: string, t: number): string {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  for (const a of [...doc.querySelectorAll('animate')]) {
    const attr = a.getAttribute('attributeName');
    const values = (a.getAttribute('values') ?? '').split(';');
    const parent = a.parentElement;
    if (attr && parent && values.length >= 2) parent.setAttribute(attr, lerpValue(values[0], values[values.length - 1], t));
    a.remove();
  }
  for (const a of [...doc.querySelectorAll('animateTransform, set')]) a.remove();
  return new XMLSerializer().serializeToString(doc);
}

function lerpValue(a: string, b: string, t: number): string {
  const ca = a.trim().match(/^#([0-9a-f]{6})$/i);
  const cb = b.trim().match(/^#([0-9a-f]{6})$/i);
  if (ca && cb) {
    const x = parseInt(ca[1], 16), y = parseInt(cb[1], 16);
    const ch = (s: number) => Math.round(((x >> s) & 255) * (1 - t) + ((y >> s) & 255) * t);
    return '#' + [16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('');
  }
  const nb = b.match(/-?\d*\.?\d+(?:e-?\d+)?/gi) ?? [];
  let i = 0;
  return a.replace(/-?\d*\.?\d+(?:e-?\d+)?/gi, (m) => {
    const v = nb[i++];
    return v === undefined ? m : String(Number(m) * (1 - t) + Number(v) * t);
  });
}
