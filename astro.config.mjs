import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

const base = process.env.BASE_PATH || '/';

export default defineConfig({
  site: 'https://logiagenesis.github.io',
  base,
  trailingSlash: 'always',
  output: 'static',
  devToolbar: { enabled: false },
  build: {
    format: 'directory',
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
