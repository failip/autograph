import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, type PreviewServer, type ViteDevServer } from 'vite';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

// SvelteKit's development and preview static middleware uses decodeURI,
// which preserves escaped #, +, and = characters in SMILES filenames.
function serveEncodedMolecules(server: ViteDevServer | PreviewServer, directory: string) {
	server.middlewares.use(async (request, response, next) => {
		const pathname = request.url?.split('?')[0] || '';
		const prefix = '/graphs/AtmosphereReduced/';
		if (!['GET', 'HEAD'].includes(request.method || '') ||
			!pathname.startsWith(prefix) || !pathname.endsWith('.xyz') || !pathname.includes('%')) return next();
		try {
			const file = resolve(directory, decodeURIComponent(pathname.slice(prefix.length)));
			if (!file.startsWith(directory + sep)) return next();
			const info = await stat(file);
			if (!info.isFile()) return next();
			response.setHeader('Content-Type', 'chemical/x-xyz');
			response.setHeader('Content-Length', info.size);
			if (request.method === 'HEAD') return response.end();
			createReadStream(file).on('error', () => response.destroy()).pipe(response);
		} catch {
			next();
		}
	});
}

const encodedMolecules = {
	name: 'encoded-molecule-assets',
	configureServer(server: ViteDevServer) {
		serveEncodedMolecules(server, resolve(server.config.root, 'static/graphs/AtmosphereReduced'));
	},
	configurePreviewServer(server: PreviewServer) {
		serveEncodedMolecules(server, resolve(server.config.root, '.svelte-kit/output/client/graphs/AtmosphereReduced'));
	}
};

export default defineConfig({
	plugins: [sveltekit(), encodedMolecules],
	server: {
		watch: {
			ignored: ["**/static/**", "build/**"],
		},
		allowedHosts: ['preview.failip.live', 'tunnel.kuboth.dev']
	},
});
