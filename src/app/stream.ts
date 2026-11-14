import type Hls from "hls.js";

export function attachStream(video: HTMLVideoElement, src: string, stream?: string): () => void {
  if (!stream || video.canPlayType("application/vnd.apple.mpegurl")) {
    video.src = stream ?? src;
    return () => video.removeAttribute("src");
  }

  let player: Hls | undefined;
  let detached = false;

  void import("hls.js/light").then(({ default: Player }) => {
    if (detached) return;
    if (!Player.isSupported()) {
      video.src = src;
      return;
    }
    const created = new Player({ enableWorker: false });

    created.loadSource(stream);
    created.attachMedia(video);
    player = created;
  });

  return () => {
    detached = true;
    player?.destroy();
    video.removeAttribute("src");
  };
}
