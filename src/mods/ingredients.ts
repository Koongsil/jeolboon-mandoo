/**
 * 정답 재료 7개(만두속 +1점 재료)를 다른 아이템으로 교체하는 모드.
 *
 * - label:  버튼 글자
 * - image:  재료를 골랐을 때 그릇에 나타나는 그림 (public/assets/ 기준 경로)
 * - size:   그릇에 그려질 크기(px, 긴 변 기준)
 * - at:     그릇 속 위치(화면 좌표, 500x400 기준)
 *
 * 점수 로직은 원본 그대로입니다(버튼 스크립트 src/actions/buttons/button_*.as).
 */
import type { Assets } from '../engine/assets';
import { IDENTITY, mul } from '../engine/types';
import type { GraphicDef, Mat, SwfData } from '../engine/types';

interface Ingredient {
  original: string;
  label: string;
  image: string;
  size: number;
  at: [number, number];
  /** 그릇 속 그림을 담은 무비클립의 인스턴스 이름(위치 계산용) */
  clip: string;
  /** 원본 SWF의 문자 ID: 그릇 속 그림, 버튼 글자(연노랑 그림자, 주황 글자) */
  shape: number;
  textShadow: number;
  textMain: number;
}

export const INGREDIENTS: Ingredient[] = [
  // 뒷줄 (먼저 그려지는 레이어)
  { original: '양배추', label: '시야의 타오', image: 'items/sight-tao.png', size: 76, at: [195, 122], clip: 'bechu', shape: 112, textShadow: 184, textMain: 185 },
  { original: '돼지고기', label: '어둠의 타오', image: 'items/dark-tao.png', size: 76, at: [255, 118], clip: 'pig', shape: 114, textShadow: 158, textMain: 159 },
  { original: '두부', label: '일비표창', image: 'items/ilbi.png', size: 80, at: [315, 122], clip: 'dubu', shape: 116, textShadow: 164, textMain: 165 },
  // 앞줄
  { original: '양파', label: '티폰의 깃털', image: 'items/typhon-feather.png', size: 80, at: [172, 180], clip: 'yangpa', shape: 120, textShadow: 178, textMain: 179 },
  { original: '마늘', label: '별의 돌', image: 'items/star-stone.png', size: 76, at: [228, 186], clip: 'manle', shape: 122, textShadow: 169, textMain: 170 },
  { original: '대파', label: '메소', image: 'items/meso.png', size: 76, at: [284, 186], clip: 'bigpa', shape: 152, textShadow: 175, textMain: 176 },
  { original: '참기름', label: '조화의 타오', image: 'items/harmony-tao.png', size: 76, at: [340, 180], clip: 'oil', shape: 154, textShadow: 196, textMain: 197 },
];

/** 원본 버튼 글꼴(산돌광수 M, 내장 글리프에 새 글자가 없음)과 비슷한 손글씨체 */
const FONT = '"Gamja Flower", "Jua", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
/** 굵기 보정: 글자 크기 대비 외곽선 두께 */
const BOLD = 0.035;
/** 자간: 원본 버튼 글자처럼 글자 사이를 조금 띄움(글자 크기 대비) */
const SPACING = 0.08;
/** 버튼 안쪽 여백(px) */
const PAD_X = 3;
/** 버튼 위아래 여백(px). 버튼 그림에는 그림자·테두리가 포함돼 있어 실제 면보다 큼 */
const PAD_Y = 5;
/** 두 줄이 한 줄보다 이만큼 이상 커질 때만 두 줄로 나눔 */
const WRAP_GAIN = 1.15;
const MAX_SIZE = 21;
const MIN_SIZE = 9;
const LINE_H = 1.0;
const LABEL_RES = 4; // label canvas pixels per stage pixel

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('failed to load ' + url));
    img.src = url;
  });
}

/**
 * 버튼 글자를 그림. 한 줄과 (띄어쓰기에서 나눈) 두 줄 중 글자가 더 크게 들어가는 쪽을 고름.
 * box: 버튼 배경 상자(가운데·너비·높이)
 */
function makeLabel(text: string, color: string, box: { x: number; y: number; w: number; h: number }) {
  const probe = document.createElement('canvas').getContext('2d')!;
  const maxW = box.w - PAD_X * 2;
  const maxH = box.h - PAD_Y * 2;
  const fits = (lines: string[], size: number) => {
    probe.font = `${size}px ${FONT}`;
    probe.letterSpacing = `${size * SPACING}px`;
    return size * LINE_H * lines.length <= maxH && lines.every((l) => probe.measureText(l).width + size * BOLD <= maxW);
  };
  const fitSize = (lines: string[]) => {
    let size = MAX_SIZE;
    while (size > MIN_SIZE && !fits(lines, size)) size -= 0.5;
    return size;
  };
  let lines = [text];
  let size = fitSize(lines);
  const sp = text.lastIndexOf(' ');
  if (sp > 0) {
    const two = [text.slice(0, sp), text.slice(sp + 1)];
    const size2 = fitSize(two);
    if (size2 >= size * WRAP_GAIN) [lines, size] = [two, size2];
  }
  probe.font = `${size}px ${FONT}`;
  probe.letterSpacing = `${size * SPACING}px`;
  const lh = size * LINE_H;
  const w = Math.ceil(Math.max(...lines.map((l) => probe.measureText(l).width)) + size * BOLD) + 4;
  const h = Math.ceil(lh * lines.length + size * 0.4);
  const c = document.createElement('canvas');
  c.width = w * LABEL_RES;
  c.height = h * LABEL_RES;
  const ctx = c.getContext('2d')!;
  ctx.scale(LABEL_RES, LABEL_RES);
  ctx.font = `${size}px ${FONT}`;
  ctx.letterSpacing = `${size * SPACING}px`;
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = size * BOLD;
  ctx.lineJoin = 'round';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((l, i) => {
    const y = h / 2 + (i - (lines.length - 1) / 2) * lh + size * 0.05;
    ctx.strokeText(l, w / 2, y);
    ctx.fillText(l, w / 2, y);
  });
  const def: Omit<GraphicDef, 'type' | 'src'> = { w, h, ox: box.x - w / 2, oy: box.y - h / 2 };
  return { def, canvas: c };
}

/** Stage position of a named clip placed on the main timeline. */
function clipPosition(data: SwfData, name: string): [number, number] {
  for (const f of data.root) for (const op of f.ops) if (op.t === 'p' && op.n === name && op.m) return [op.m[4], op.m[5]];
  throw new Error(`clip ${name} not found`);
}

/**
 * 글자가 놓인 버튼의 배경 상자(글자 좌표계 기준): 가운데와 너비.
 * 원본 글자는 버튼 가운데에 있지 않아서, 글자 위치가 아니라 버튼 배경에 맞춰 가운데 정렬합니다.
 */
function buttonBox(data: SwfData, textId: number) {
  for (const def of Object.values(data.chars)) {
    if (def.type !== 'button') continue;
    const up = def.recs.filter((r) => r.s & 1);
    const label = up.find((r) => r.c === textId);
    if (!label) continue;
    // 배경: 글자가 아닌 가장 아래 레이어(도형이거나, 도형을 담은 무비클립)
    const bg = up.filter((r) => data.chars[r.c]?.type !== 'text').sort((a, b) => a.d - b.d)[0];
    const shape = bg && resolveShape(data, bg.c, bg.m);
    if (!shape) break;
    const { g, m } = shape;
    const xs: number[] = [];
    const ys: number[] = [];
    for (const [x, y] of [[g.ox, g.oy], [g.ox + g.w, g.oy], [g.ox, g.oy + g.h], [g.ox + g.w, g.oy + g.h]]) {
      xs.push(m[0] * x + m[2] * y + m[4] - label.m[4]);
      ys.push(m[1] * x + m[3] * y + m[5] - label.m[5]);
    }
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
  }
  throw new Error(`button for text ${textId} not found`);
}

/** 무비클립이면 첫 프레임의 첫 도형까지 따라 내려가 도형과 누적 행렬을 돌려줌 */
function resolveShape(data: SwfData, id: number, m: Mat): { g: GraphicDef; m: Mat } | null {
  const d = data.chars[id];
  if (!d) return null;
  if (d.type === 'shape') return { g: d, m };
  if (d.type !== 'sprite') return null;
  for (const op of d.frames[0]?.ops ?? []) {
    if (op.t !== 'p' || op.c === undefined) continue;
    const r = resolveShape(data, op.c, mul(m, op.m ?? IDENTITY));
    if (r) return r;
  }
  return null;
}

function graphic(data: SwfData, id: number): GraphicDef {
  const d = data.chars[id];
  if (!d || (d.type !== 'shape' && d.type !== 'text')) throw new Error(`character ${id} is not a graphic`);
  return d;
}

export async function applyIngredientMod(data: SwfData, assets: Assets, base: string) {
  // 한글 웹폰트는 글자 범위별로 나눠 받으므로, 실제로 쓸 글자를 넘겨야 해당 조각이 모두 로드됨
  const text = INGREDIENTS.map((i) => i.label).join('');
  try { await Promise.all(['Gamja Flower', 'Jua'].map((f) => document.fonts.load(`17px "${f}"`, text))); } catch { /* fall back to system font */ }

  await Promise.all(INGREDIENTS.map(async (ing) => {
    // 1) 그릇 속 그림: 원본 도형 대신 아이템 이미지를 지정 위치에 배치
    const img = await loadImage(base + ing.image);
    const [px, py] = clipPosition(data, ing.clip);
    const cx = ing.at[0] - px; // clip-local coordinates
    const cy = ing.at[1] - py;
    const k = ing.size / Math.max(img.naturalWidth, img.naturalHeight);
    const w = img.naturalWidth * k;
    const h = img.naturalHeight * k;
    assets.replace(data, ing.shape, { w, h, ox: cx - w / 2, oy: cy - h / 2, pixelated: true }, img);

    // 2) 버튼 글자: 그림자(연노랑)와 글자(주황)를 원본 위치에 다시 그림
    // 그림자는 주황 글자 기준 좌표를 그대로 써서 원본의 어긋남(오른쪽 아래 약 2px)을 유지
    const box = buttonBox(data, ing.textMain);
    for (const [id, color] of [[ing.textShadow, '#ffffcc'], [ing.textMain, '#ff6600']] as const) {
      const { def, canvas } = makeLabel(ing.label, color, box);
      assets.replace(data, id, def, canvas);
    }
  }));
}
