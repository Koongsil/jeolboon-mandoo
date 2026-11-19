// build/ (FFDec output) -> src/data/swf.json, src/actions/*.as, public/assets/*
import fs from 'node:fs';
import path from 'node:path';
import { XMLParser } from 'fast-xml-parser';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const B = (...p) => path.join(ROOT, 'build', ...p);
const OUT_ASSETS = path.join(ROOT, 'public', 'assets');
const OUT_ACTIONS = path.join(ROOT, 'src', 'actions');
const OUT_DATA = path.join(ROOT, 'src', 'data');

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseAttributeValue: false,
  isArray: (name) => name === 'item',
});
const xml = parser.parse(fs.readFileSync(B('mandu.xml'), 'utf8'));
const swf = xml.swf;
const tags = swf.tags.item;

const num = (v, d = 0) => (v === undefined ? d : Number(v));
const bool = (v) => v === 'true';
const round = (v, n = 5) => Math.round(v * 10 ** n) / 10 ** n;

function mat(m) {
  if (!m) return undefined;
  const a = bool(m.hasScale) ? num(m.scaleX) : 1;
  const d = bool(m.hasScale) ? num(m.scaleY) : 1;
  const b = bool(m.hasRotate) ? num(m.rotateSkew0) : 0;
  const c = bool(m.hasRotate) ? num(m.rotateSkew1) : 0;
  return [a, b, c, d, num(m.translateX) / 20, num(m.translateY) / 20].map((v) => round(v));
}

function ct(c) {
  if (!c) return undefined;
  const hm = bool(c.hasMultTerms);
  const ha = bool(c.hasAddTerms);
  if (!hm && !ha) return undefined;
  const m = (k) => (hm ? num(c[k], 256) / 256 : 1);
  const a = (k) => (ha ? num(c[k], 0) : 0);
  const r = [m('redMultTerm'), m('greenMultTerm'), m('blueMultTerm'), m('alphaMultTerm'),
    a('redAddTerm'), a('greenAddTerm'), a('blueAddTerm'), a('alphaAddTerm')].map((v) => round(v));
  if (r.join() === '1,1,1,1,0,0,0,0') return undefined;
  return r;
}

function soundInfo(id, si) {
  const s = { id: Number(id) };
  if (!si) return s;
  if (bool(si.syncStop)) s.stop = 1;
  if (bool(si.syncNoMultiple)) s.noMulti = 1;
  if (bool(si.hasLoops) && num(si.loopCount) > 1) s.loops = num(si.loopCount);
  if (bool(si.hasInPoint)) s.inP = num(si.inPoint);
  if (bool(si.hasOutPoint)) s.outP = num(si.outPoint);
  return s;
}

const chars = {};
const morphIds = new Set();

// Pass 1: collect character types
for (const t of tags) {
  if (t.type === 'DefineMorphShapeTag' || t.type === 'DefineMorphShape2Tag') morphIds.add(Number(t.characterId));
}

// Parse a timeline (root or sprite)
function timeline(items, ownerKey) {
  const frames = [];
  let cur = { ops: [] };
  const depthChar = new Map();
  let actionCount = 0;
  for (const t of items || []) {
    switch (t.type) {
      case 'PlaceObject2Tag':
      case 'PlaceObject3Tag': {
        const op = { t: 'p', d: Number(t.depth) };
        if (bool(t.placeFlagHasCharacter)) { op.c = Number(t.characterId); depthChar.set(op.d, op.c); }
        if (bool(t.placeFlagMove)) op.mv = 1;
        const m = mat(t.matrix); if (m) op.m = m;
        const c = ct(t.colorTransform); if (c) op.ct = c;
        else if (bool(t.placeFlagHasColorTransform)) op.ct = [1, 1, 1, 1, 0, 0, 0, 0];
        if (bool(t.placeFlagHasRatio)) {
          op.r = Number(t.ratio);
          const ch = depthChar.get(op.d);
          if (morphIds.has(ch)) (morphRatios[ch] ||= new Set()).add(op.r);
        }
        if (bool(t.placeFlagHasName)) op.n = t.name;
        if (bool(t.placeFlagHasClipDepth)) op.cd = Number(t.clipDepth);
        cur.ops.push(op);
        break;
      }
      case 'RemoveObject2Tag':
      case 'RemoveObjectTag':
        cur.ops.push({ t: 'r', d: Number(t.depth) });
        depthChar.delete(Number(t.depth));
        break;
      case 'StartSoundTag':
        (cur.snd ||= []).push(soundInfo(t.soundId, t.soundInfo));
        break;
      case 'FrameLabelTag':
        cur.label = t.name;
        break;
      case 'DoActionTag':
        actionCount++;
        break;
      case 'ShowFrameTag':
        if (actionCount) cur.act = 1;
        frames.push(cur);
        cur = { ops: [] };
        actionCount = 0;
        break;
    }
  }
  if (cur.ops.length || cur.snd) frames.push(cur);
  return frames;
}

const morphRatios = {};
const rootFrames = timeline(tags, 'root');

const buttonSounds = {};
for (const t of tags) {
  if (t.type === 'DefineButtonSoundTag') {
    const arr = [];
    for (let i = 0; i < 4; i++) {
      const id = num(t['buttonSoundChar' + i]);
      arr.push(id ? soundInfo(id, t['buttonSoundInfo' + i]) : null);
    }
    buttonSounds[t.buttonId] = arr;
  }
}

function svgMeta(file) {
  const s = fs.readFileSync(file, 'utf8');
  const w = parseFloat(s.match(/width="([\d.]+)px"/)[1]);
  const h = parseFloat(s.match(/height="([\d.]+)px"/)[1]);
  const m = s.match(/<g transform="matrix\(([^)]*)\)"/);
  const parts = m ? m[1].split(',').map(Number) : [1, 0, 0, 1, 0, 0];
  return { w, h, ox: round(-parts[4], 3), oy: round(-parts[5], 3) };
}

// only replace the folders generated from the SWF (keep custom assets such as items/)
for (const d of ['shapes', 'morphs', 'texts', 'sounds']) {
  fs.rmSync(path.join(OUT_ASSETS, d), { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT_ASSETS, d), { recursive: true });
}

for (const t of tags) {
  switch (t.type) {
    case 'DefineShapeTag': case 'DefineShape2Tag': case 'DefineShape3Tag': case 'DefineShape4Tag': {
      const id = Number(t.shapeId);
      const f = B('svg', 'shapes', `${id}.svg`);
      fs.copyFileSync(f, path.join(OUT_ASSETS, 'shapes', `${id}.svg`));
      chars[id] = { type: 'shape', src: `shapes/${id}.svg`, ...svgMeta(f) };
      break;
    }
    case 'DefineMorphShapeTag': case 'DefineMorphShape2Tag': {
      const id = Number(t.characterId);
      const f = B('svg', 'morphshapes', `${id}.svg`);
      fs.copyFileSync(f, path.join(OUT_ASSETS, 'morphs', `${id}.svg`));
      chars[id] = { type: 'morph', src: `morphs/${id}.svg`, ...svgMeta(f) };
      break;
    }
    case 'DefineTextTag': case 'DefineText2Tag': {
      const id = Number(t.characterID ?? t.characterId);
      const f = B('svg', 'texts', `${id}.svg`);
      fs.copyFileSync(f, path.join(OUT_ASSETS, 'texts', `${id}.svg`));
      chars[id] = { type: 'text', src: `texts/${id}.svg`, ...svgMeta(f) };
      break;
    }
    case 'DefineSpriteTag': {
      const id = Number(t.spriteId);
      const frames = timeline(t.subTags?.item, `sprite_${id}`);
      while (frames.length < num(t.frameCount, 1)) frames.push({ ops: [] });
      chars[id] = { type: 'sprite', frames };
      break;
    }
    case 'DefineButton2Tag': case 'DefineButtonTag': {
      const id = Number(t.buttonId);
      const recs = [];
      for (const r of t.characters?.item || []) {
        if (r.type !== 'BUTTONRECORD') continue;
        const s = (bool(r.buttonStateUp) ? 1 : 0) | (bool(r.buttonStateOver) ? 2 : 0) |
          (bool(r.buttonStateDown) ? 4 : 0) | (bool(r.buttonStateHitTest) ? 8 : 0);
        const rec = { s, c: Number(r.characterId), d: Number(r.placeDepth), m: mat(r.placeMatrix) || [1, 0, 0, 1, 0, 0] };
        const c = ct(r.colorTransform); if (c) rec.ct = c;
        recs.push(rec);
      }
      chars[id] = { type: 'button', recs, snd: buttonSounds[id] };
      break;
    }
    case 'DefineSoundTag': {
      const id = Number(t.soundId);
      const dir = B('export', 'sounds');
      const file = fs.readdirSync(dir).find((f) => f.replace(/\.\w+$/, '') === String(id));
      if (file) {
        fs.copyFileSync(path.join(dir, file), path.join(OUT_ASSETS, 'sounds', file));
        chars[id] = { type: 'sound', src: `sounds/${file}` };
      }
      break;
    }
  }
}
for (const [id, set] of Object.entries(morphRatios)) chars[id].ratios = [...set].sort((a, b) => a - b);

// Scripts: merge multiple DoAction blocks per frame into one editable .as file
fs.rmSync(OUT_ACTIONS, { recursive: true, force: true });
fs.mkdirSync(OUT_ACTIONS, { recursive: true });
const SCRIPTS = B('export', 'scripts');
const suffixNum = (f) => { const m = f.match(/DoAction(?:_(\d+))?\.as$/); return m ? Number(m[1] || 1) : 0; };

function writeFrameScripts(dir, owner) {
  for (const fd of fs.readdirSync(dir)) {
    const m = fd.match(/^frame_(\d+)$/);
    if (!m) continue;
    const files = fs.readdirSync(path.join(dir, fd)).filter((f) => f.endsWith('.as')).sort((a, b) => suffixNum(a) - suffixNum(b));
    const body = files.map((f) => {
      const src = fs.readFileSync(path.join(dir, fd, f), 'utf8').trim();
      return files.length > 1 ? `// ---- ${f}\n${src}` : src;
    }).join('\n\n').trim();
    if (!body) continue;
    fs.mkdirSync(path.join(OUT_ACTIONS, owner), { recursive: true });
    fs.writeFileSync(path.join(OUT_ACTIONS, owner, `frame_${m[1]}.as`), body + '\n');
  }
}
writeFrameScripts(SCRIPTS, 'root');
for (const d of fs.readdirSync(SCRIPTS)) {
  let m;
  if ((m = d.match(/^DefineSprite_(\d+)$/))) writeFrameScripts(path.join(SCRIPTS, d), `sprite_${m[1]}`);
  else if ((m = d.match(/^DefineButton2?_(\d+)$/))) {
    const files = fs.readdirSync(path.join(SCRIPTS, d)).filter((f) => f.endsWith('.as'));
    const body = files.map((f) => fs.readFileSync(path.join(SCRIPTS, d, f), 'utf8').trim()).join('\n');
    fs.mkdirSync(path.join(OUT_ACTIONS, 'buttons'), { recursive: true });
    fs.writeFileSync(path.join(OUT_ACTIONS, 'buttons', `button_${m[1]}.as`), body + '\n');
  }
}

const bg = swf.tags.item.find((t) => t.type === 'SetBackgroundColorTag')?.backgroundColor;
const hex = (n) => Number(n).toString(16).padStart(2, '0');
const rect = swf.displayRect;
const data = {
  width: (num(rect.Xmax) - num(rect.Xmin)) / 20,
  height: (num(rect.Ymax) - num(rect.Ymin)) / 20,
  fps: Number(swf.frameRate),
  bg: bg ? `#${hex(bg.red)}${hex(bg.green)}${hex(bg.blue)}` : '#ffffff',
  root: rootFrames,
  chars,
};
fs.mkdirSync(OUT_DATA, { recursive: true });
fs.writeFileSync(path.join(OUT_DATA, 'swf.json'), JSON.stringify(data));
const count = (type) => Object.values(chars).filter((c) => c.type === type).length;
console.log(`root frames: ${rootFrames.length}, shapes: ${count('shape')}, texts: ${count('text')}, morphs: ${count('morph')}, sprites: ${count('sprite')}, buttons: ${count('button')}, sounds: ${count('sound')}`);
