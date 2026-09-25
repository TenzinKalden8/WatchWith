import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages hosts this project below /WatchWith/.
  base: '/WatchWith/',
  plugins: [react()],
})
