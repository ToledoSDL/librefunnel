"use client";

import { useEffect, useRef, useState } from "react";
import { attachStream } from "@/app/stream";
import styles from "./video-player.module.css";

const MOVE_MS = 20_000;

export function VideoPlayer({
  src,
  stream,
  poster,
  title,
  watermark,
}: {
  src: string;
  stream?: string;
  poster?: string;
  title: string;
  watermark?: string;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [spot, setSpot] = useState({ top: 6, left: 6 });

  useEffect(() => {
    if (video.current) return attachStream(video.current, src, stream);
  }, [src, stream]);

  useEffect(() => {
    if (!watermark) return;

    const move = () => setSpot({ top: 6 + Math.random() * 80, left: 4 + Math.random() * 50 });
    const timer = setInterval(move, MOVE_MS);

    move();
    return () => clearInterval(timer);
  }, [watermark]);

  // The native fullscreen button takes the bare video, which would leave the watermark behind.
  useEffect(() => {
    const keepWatermark = () => {
      if (!video.current || document.fullscreenElement !== video.current) return;
      void document
        .exitFullscreen()
        .then(() => frame.current?.requestFullscreen())
        .catch(() => undefined);
    };

    document.addEventListener("fullscreenchange", keepWatermark);
    return () => document.removeEventListener("fullscreenchange", keepWatermark);
  }, []);

  return (
    <div ref={frame} className={styles.player} onContextMenu={(event) => event.preventDefault()}>
      <video
        ref={video}
        poster={poster}
        title={title}
        controls
        controlsList="nodownload"
        disablePictureInPicture
        playsInline
        preload="metadata"
      />
      {watermark ? (
        <span className={styles.watermark} style={{ top: `${spot.top}%`, left: `${spot.left}%` }} aria-hidden="true">
          {watermark}
        </span>
      ) : null}
    </div>
  );
}
