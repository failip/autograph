import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	server: {
		proxy: {
			'/graph/': {
				target: "http://localhost:43070",
				// target: "http://10.42.144.124:43070",
				changeOrigin: true,
				rewrite: (path) => path.replace(/^\/graph/, ''),
				secure: false
			},
		},
		watch: {
			ignored: ["**/static/**", "build/**"],
		},
	},
});
