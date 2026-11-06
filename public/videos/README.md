# Login demo video

`/login` right panel plays `login-demo.mp4` (autoplay, muted, loop, `object-cover`).
Poster: `login-demo-poster.jpg`. Panel is roughly portrait (~0.7 aspect); 1080x1440 or 1080x1350 works best.

To swap in a new cut: overwrite both files with the same names, commit, push. No code changes needed.
If the mp4 fails to load, the page falls back to a crossfading still slideshow from /public/images.
