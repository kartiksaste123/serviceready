/**
 * Content-hashed login demo media. Bump by re-copying files with new MD5 prefixes
 * whenever Artlist delivers a new cut — old URLs stop being referenced so caches cannot stick.
 */
export const LOGIN_DEMO = {
  /** Prefer MP4 first: universal decode; WebM as progressive enhancement. */
  mp4: "/videos/login-demo.c8211490fc.mp4",
  webm: "/videos/login-demo.52f703be51.webm",
  poster: "/videos/login-demo-poster.5b7e660ed6.jpg",
  /** md5 of current mp4 — used in UI version chip / debugging */
  contentId: "c8211490fc",
} as const;
