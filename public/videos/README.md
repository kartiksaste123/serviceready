# Login demo video

Artlist & OpenArt cut (~39s, 4:5, loopable, includes live PayPal sandbox checkout). Right panel on `/login`.

Filenames are **content-hashed** (first 10 hex of MD5). The login page imports
paths from `src/lib/login-demo-assets.ts` — never hardcode unhashed names in UI.

Current assets:
- `login-demo.<md5>.mp4` — H.264 (listed first in `<video>`)
- `login-demo.<md5>.webm` — VP9
- `login-demo-poster.<md5>.jpg` — first-frame poster

Nitro sets `Cache-Control: no-cache, no-store, must-revalidate` on `/videos/**`.
Old unhashed URLs 302 to the current hashed files.

To swap in a new cut:
1. Copy new files into this folder
2. `md5sum` each; rename to `login-demo.<10hex>.{mp4,webm}` / `login-demo-poster.<10hex>.jpg`
3. Update `src/lib/login-demo-assets.ts` + redirects in `nitro.config.ts` and `vite.config.ts`
4. Delete previous hashed files, commit, push
