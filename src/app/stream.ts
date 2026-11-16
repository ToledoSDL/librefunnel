import type Hls from "hls.js";

// Any failure of the adaptive stream (the hls.js chunk not loading, a fatal network or decode error) falls back to the
// original file, so a broken stream never leaves the viewer with a black frame.
export function attachStream(video: HTMLVideoElement, src: string, stream?: string): () => void {
  if (!stream || video.canPlayType("application/vnd.apple.mpegurl")) {
    video.src = stream ?? src;
    return () => video.removeAttribute("src");
  }

  let player: Hls | undefined;
  let detached = false;

  function original() {
    player?.destroy();
    player = undefined;
    if (!detached) video.src = src;
  }

  import("hls.js/light")
    .then(({ default: Player }) => {
      if (detached) return;
      if (!Player.isSupported()) {
        original();
        return;
      }
      const created = new Player({ enableWorker: false });

      created.on(Player.Events.ERROR, (_event, data) => {
        if (data.fatal) original();
      });
      created.loadSource(stream);
      created.attachMedia(video);
      player = created;
    })
    .catch(original);

  return () => {
    detached = true;
    player?.destroy();
    video.removeAttribute("src");
  };
}
