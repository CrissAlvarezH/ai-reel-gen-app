import path from 'node:path';
import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Live preview imports each reel's own src/ (videos/<slug>/src/Root.tsx). Its bare imports must resolve to the
  // studio's single copy of React and Remotion, not the reel's node_modules, or hooks break (two Reacts).
  resolve: {alias: {'@': path.resolve(import.meta.dirname, 'src')}, dedupe: ['react', 'react-dom', 'remotion', '@remotion/google-fonts', '@remotion/player']},
  // server.fs.allow (the studio and the workspace) is set by server/index.ts.
  optimizeDeps: {include: ['remotion', '@remotion/player', '@remotion/google-fonts/Inter', '@remotion/google-fonts/Anton', '@remotion/google-fonts/SpecialElite', '@remotion/google-fonts/PermanentMarker']},
});
