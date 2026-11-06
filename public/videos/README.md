# Login demo video

Artlist & OpenArt cut (31s, 4:5, loopable). Right panel on `/login`.

- `login-demo.webm` — preferred (VP9)
- `login-demo.mp4` — H.264 fallback (1080×1350, faststart)
- `login-demo-poster.jpg` — first-frame poster
- `login-demo-9x16.mp4` — optional vertical export (not used by the page)

`<video>` prefers WebM then MP4; autoplay, muted, loop, `object-cover`.
If both fail to load, the page falls back to a crossfading still slideshow from `/public/images`.

To swap in a new cut: overwrite the same filenames, commit, push.
