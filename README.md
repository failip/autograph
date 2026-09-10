# Autograph

[Try autograph here](https://autograph-bpm.pages.dev/)

Autograph is a visualisation and exploration tool for reaction networks.

## Development

### Prerequisites

- [Node.js](https://nodejs.org/en/)
- [npm](https://www.npmjs.com/) or a npm compatible package manager like [yarn](https://yarnpkg.com/) or [pnpm](https://pnpm.io/)

### Development server

```bash
git clone https://github.com/failip/autograph
cd autograph
npm install
npm run dev
```

### Build

```bash
npm run build
```

## Progressive web app

Autograph can be installed as a standalone app. In a supporting browser, use
**Install Autograph** on the home page or the browser's install menu. On iPhone
or iPad, open the site in Safari and choose **Share → Add to Home Screen**.

After the home page reports **App ready offline**, the home page, `/vr`, `/pes`,
and `/trajectory` work offline, including their default content: the JSON and
XYZ files in `graphs/AtmosphereReduced`, `tasks/PES.gltf`, `trajectory/Run1.xyz`,
and the shared environment, fonts, and icons. Other graph collections and the
`/graph` and `/database` pages are excluded from offline support. The local
`.xyz` trajectory file picker also works offline.

Additional same-origin files opened from `graphs/AtmosphereReduced`, `tasks`,
or `trajectory` are cached on demand, preferring the network and falling back
to saved copies when offline or on server errors. This extra cache is limited
to 32 MiB and 160 files, with an 8 MiB limit per file. External URLs and database
operations require a connection. Browsers can evict stored data; uploaded
files and the current exploration state are not persisted.

Each new release replaces the default content and clears the old caches.
Reopen any additional files online after an update. Updates wait until all
Autograph tabs and installed windows are closed; the app displays a notice
when one is ready.

### Test and deploy

```bash
npm run test:pwa
npm run build
npm run preview
```

Open the preview URL on `localhost`, wait for **App ready offline**, open a
dataset, then use the browser's offline mode and reload a route (including one
with query parameters). In browser developer tools, check the manifest and
service worker under **Application**. A second open tab should keep a newly
built worker waiting until both tabs close.

Deploy the complete `build/` directory over HTTPS. Service workers also work on
`localhost`; plain HTTP on a LAN IP will not enable installation/offline
support. Development mode does not register a worker, so test PWA behavior
with the production preview on its separate port. `static/_headers` configures
Cloudflare Pages to revalidate the manifest and service worker; on other hosts,
serve `service-worker.js` with `Cache-Control: no-cache` and serve
`manifest.webmanifest` as `application/manifest+json`.

The implementation uses [SvelteKit's service worker support](https://svelte.dev/docs/kit/service-workers)
and a [web app manifest](https://web.dev/learn/pwa/web-app-manifest).
