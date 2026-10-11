import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  define: { __DINGTALK_TRIAL__: JSON.stringify(mode === 'dingtalk-trial'), __WEBSITE__: JSON.stringify(mode === 'website') },
  server: { proxy: { '/api': 'http://127.0.0.1:4175' } },
}));
