import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' makes the build work both at keenafrica.com/learn/
// and at the root of a learn.keenafrica.com subdomain
export default defineConfig({
  plugins: [react()],
  base: './',
})
