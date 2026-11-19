import './style.css';
import swf from './data/swf.json';
import { Assets } from './engine/assets';
import { Player } from './engine/player';
import { Sound } from './engine/sound';
import { applyIngredientMod } from './mods/ingredients';
import type { SwfData } from './engine/types';

// ActionScript sources (edit these .as files to change game logic)
const raw = import.meta.glob('./actions/**/*.as', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const actions: Record<string, string> = {};
for (const [path, src] of Object.entries(raw)) actions[path.replace('./actions/', '').replace(/\.as$/, '')] = src;

const data = swf as unknown as SwfData;
const base = import.meta.env.BASE_URL + 'assets/';
const canvas = document.querySelector<HTMLCanvasElement>('#stage')!;
const overlay = document.querySelector<HTMLDivElement>('#overlay')!;
const status = document.querySelector<HTMLParagraphElement>('#status')!;
const startBtn = document.querySelector<HTMLButtonElement>('#start')!;
const muteBtn = document.querySelector<HTMLButtonElement>('#mute')!;

function fit() {
  const ar = data.width / data.height;
  const w = Math.min(window.innerWidth, window.innerHeight * ar);
  canvas.style.width = `${Math.floor(w)}px`;
  canvas.style.height = `${Math.floor(w / ar)}px`;
}

async function boot() {
  fit();
  const assets = new Assets(base);
  const sound = new Sound();
  await Promise.all([
    assets.load(data, (d, t) => { status.textContent = `불러오는 중... ${Math.round((d / t) * 100)}%`; }),
    sound.load(data, base),
  ]);
  await applyIngredientMod(data, assets, base);
  const player = new Player({ data, canvas, assets, sound, actions });
  player.resize();
  window.addEventListener('resize', () => { fit(); player.resize(); });

  status.textContent = '';
  startBtn.hidden = false;
  startBtn.addEventListener('click', async () => {
    await sound.ctx.resume();
    overlay.remove();
    muteBtn.hidden = false;
    player.start();
  }, { once: true });

  muteBtn.addEventListener('click', () => {
    sound.muted = !sound.muted;
    muteBtn.textContent = sound.muted ? '🔇' : '🔊';
  });

  (window as unknown as { player: Player }).player = player; // for debugging in devtools
}

boot().catch((e) => {
  console.error(e);
  status.textContent = '불러오기 실패: ' + e.message;
});
