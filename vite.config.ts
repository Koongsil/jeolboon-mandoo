import { defineConfig } from 'vite';

// GitHub Pages(https://koongsil.github.io/jeolboon-mandoo/)처럼 하위 경로에 올려도 동작하도록 상대 경로로 빌드
export default defineConfig({
  base: './',
});
