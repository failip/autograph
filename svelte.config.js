import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://kit.svelte.dev/docs/integrations#preprocessors
	// for more information about preprocessors
	preprocess: vitePreprocess(),

	kit: {
		adapter: adapter(),
		serviceWorker: {
			// Register in PwaStatus so development stays free of offline caches.
			register: false,
			// Include the default content used by /vr, /pes, and /trajectory.
			files: (file) =>
				/^(fonts\/.*\.woff2|images\/.*\.svg|icons\/.*\.(png|svg)|manifest\.webmanifest|qwantani_dusk_2_puresky_1k\.hdr|graphs\/AtmosphereReduced\/.*\.(json|xyz)|tasks\/PES\.gltf|trajectory\/Run1\.xyz)$/.test(file)
		}
	}
};

export default config;
