/**
 * Content-hashed login demo media. Bump by re-copying files with new MD5 prefixes
 * whenever Artlist delivers a new cut — old URLs stop being referenced so caches cannot stick.
 */
export const LOGIN_DEMO = {
  /** Prefer MP4 first: universal decode; WebM as progressive enhancement. */
  mp4: "/videos/login-demo.733a0af60e.mp4",
  webm: "/videos/login-demo.8c9c9ece4a.webm",
  poster: "/videos/login-demo-poster.5b7e660ed6.jpg",
  /** md5 of current mp4 — used in UI version chip / debugging */
  contentId: "733a0af60e",
  /** Approximate duration of the current Artlist cut (seconds). */
  durationSec: 39,
} as const;
