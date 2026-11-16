"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { attachStream } from "@/app/stream";
import { QUARTILES, track } from "@/app/track";
import type { TrackEvent } from "@/app/track";
import type { Player, Trigger } from "@/lib/catalog/products";
import styles from "./page.module.css";
import { watched } from "./retention";

type Mode = "preview" | "resume" | "playing" | "paused" | "error";

const SPEEDS = [1, 1.25, 1.5, 2];

// The offer below the video is hidden by CSS until <html data-offer="open">, so nothing flashes before this runs.
function openOffer() {
  document.documentElement.dataset.offer = "open";
}

// Front-loaded like the VSL players: early seconds move the bar faster, so the viewer does not leave at minute one. It still ends at the real end.
function shown(share: number) {
  return 1 - (1 - share) ** 2;
}

export function VslPlayer({
  product,
  src,
  stream,
  poster,
  title,
  captions,
  ctaSeconds,
  ctaText,
  href,
  options,
  triggers,
  icons,
}: {
  product: string;
  src: string;
  stream?: string;
  poster?: string;
  title: string;
  captions?: string;
  ctaSeconds: number;
  ctaText: string;
  href: string;
  options: Player;
  triggers: Trigger[];
  icons: {
    sound: ReactNode;
    play: ReactNode;
    restart: ReactNode;
    expand: ReactNode;
    close: ReactNode;
    captions: ReactNode;
  };
}) {
  const frame = useRef<HTMLDivElement>(null);
  const screen = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const fired = useRef(new Set<TrackEvent>());
  const [mode, setMode] = useState<Mode>("preview");
  const [saved, setSaved] = useState(0);
  const [time, setTime] = useState(0);
  const [share, setShare] = useState(0);
  const [offered, setOffered] = useState(false);
  const [inView, setInView] = useState(true);
  const [docked, setDocked] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [subtitles, setSubtitles] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const offerKey = `lf_cta_${product}`;
  // Keyed by the file too, so a new video from the seller never resumes at the old one's second.
  const timeKey = `lf_vsl_${product}_${src}`;
  const listening = mode === "playing" || mode === "paused";
  const floating = options.floating && mode === "playing" && !inView && !docked;
  const active = listening && !floating ? triggers.filter((entry) => time >= entry.at && time < entry.until) : [];
  const banner = active.find((entry) => !entry.button);
  const button = active.find((entry) => entry.button);
  const showCta = !button && options.button && offered && listening && !floating;

  function once(event: TrackEvent) {
    if (fired.current.has(event)) return;
    fired.current.add(event);
    track(event, product);
  }

  useEffect(() => {
    try {
      if (localStorage.getItem(offerKey) === "1") {
        openOffer();
        setOffered(true);
      }
      const seconds = options.resume ? Number(localStorage.getItem(timeKey)) || 0 : 0;
      if (seconds > 5) {
        setSaved(seconds);
        setMode("resume");
      }
    } catch {}
  }, [offerKey, timeKey, options.resume]);

  useEffect(() => {
    const node = video.current;

    if (!node) return;
    return attachStream(node, src, stream);
    // attempt: "Tentar de novo" attaches the video again.
  }, [src, stream, attempt]);

  // Coming back with the browser's back button restores the page as it was, but the browser paused the video meanwhile.
  useEffect(() => {
    function restored(event: PageTransitionEvent) {
      if (!event.persisted) return;
      setBuffering(false);
      setMode((current) => (current === "playing" && video.current?.paused ? "paused" : current));
    }

    addEventListener("pageshow", restored);
    return () => removeEventListener("pageshow", restored);
  }, []);

  useEffect(() => {
    const node = frame.current;

    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const { isIntersecting } of entries) {
          setInView(isIntersecting);
          if (isIntersecting) setDocked(false);
        }
      },
      { threshold: 0.25 },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  function reveal() {
    if (document.documentElement.dataset.offer === "open") return;
    openOffer();
    setOffered(true);

    try {
      localStorage.setItem(offerKey, "1");
    } catch {}
  }

  function progress() {
    const node = video.current;

    if (!node || !listening) return;

    const { currentTime, duration } = node;

    setTime(currentTime);
    if (!node.paused) watched(product, Math.floor(currentTime));
    if (currentTime >= ctaSeconds) reveal();
    if (!duration) return;
    setShare(currentTime / duration);
    for (const [part, name] of QUARTILES) if (currentTime / duration >= part) once(name);
    if (!options.resume) return;

    try {
      localStorage.setItem(timeKey, String(Math.floor(currentTime)));
    } catch {}
  }

  function listen(from: number) {
    const node = video.current;

    if (!node) return;

    // A saved second at or past the end (the seller trimmed the video) starts over instead of ending at once.
    const seek = () => {
      node.currentTime = node.duration && from >= node.duration - 3 ? 0 : from;
    };

    // Before the metadata arrives a seek is dropped, so it waits for it.
    if (node.readyState >= HTMLMediaElement.HAVE_METADATA) seek();
    else node.addEventListener("loadedmetadata", seek, { once: true });
    node.muted = false;
    setMode("playing");
    once("video_play");
    // Refused or not loaded yet: the play button stays, instead of a screen that looks like it is playing.
    node.play().catch(() => setMode((current) => (current === "playing" ? "paused" : current)));
  }

  // The offer opens too, so a viewer whose video never loads can still buy.
  function failed() {
    const error = video.current?.error;

    if (!error || error.code === MediaError.MEDIA_ERR_ABORTED) return;
    setBuffering(false);
    setMode("error");
    reveal();
  }

  function retry() {
    setMode("preview");
    setAttempt((current) => current + 1);
  }

  function ended() {
    // The muted preview reaching the end is not a view.
    if (!listening) return;
    once("video_100");
    reveal();
    setShare(1);

    try {
      localStorage.removeItem(timeKey);
    } catch {}
  }

  // iPhone Safari has no element fullscreen, only the native video one.
  function fullscreen() {
    const node = video.current;

    if (document.fullscreenElement) void document.exitFullscreen();
    else if (document.fullscreenEnabled) void screen.current?.requestFullscreen();
    else if (node && "webkitEnterFullscreen" in node && typeof node.webkitEnterFullscreen === "function")
      node.webkitEnterFullscreen();
  }

  function nextSpeed() {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length] ?? 1;

    if (video.current) video.current.playbackRate = next;
    setSpeed(next);
  }

  function toggleSubtitles() {
    const text = video.current?.textTracks[0];

    if (!text) return;
    text.mode = subtitles ? "hidden" : "showing";
    setSubtitles(!subtitles);
  }

  function dock() {
    video.current?.pause();
    setDocked(true);
  }

  return (
    <div ref={frame} className={styles.player}>
      <div ref={screen} className={styles.screen} data-floating={floating || undefined}>
        <video
          ref={video}
          className={styles.video}
          poster={poster}
          title={title}
          autoPlay={options.autoplay}
          muted={options.autoplay}
          playsInline
          preload="auto"
          onTimeUpdate={progress}
          onPause={() => setMode((current) => (current === "playing" ? "paused" : current))}
          onPlay={() => setMode((current) => (current === "paused" ? "playing" : current))}
          onWaiting={() => setBuffering(true)}
          onPlaying={() => setBuffering(false)}
          onCanPlay={() => setBuffering(false)}
          onEnded={ended}
          onError={failed}
        >
          {captions ? <track kind="captions" src={captions} srcLang="pt-BR" label="Português" /> : null}
        </video>

        {mode === "preview" && options.autoplay ? (
          <button
            type="button"
            className={styles.overlay}
            onClick={() => {
              once("video_unmute");
              listen(0);
            }}
          >
            <span className={styles.unmute}>
              {icons.sound}
              Toque para ouvir
            </span>
          </button>
        ) : null}

        {mode === "preview" && !options.autoplay ? (
          <button type="button" className={styles.overlay} aria-label="Assistir ao vídeo" onClick={() => listen(0)}>
            <span className={styles.bigPlay}>{icons.play}</span>
          </button>
        ) : null}

        {mode === "resume" ? (
          <div className={`${styles.overlay} ${styles.dim}`}>
            <span className={styles.panel}>
              <strong>Você já começou a assistir este vídeo</strong>
              <span className={styles.choices}>
                <button type="button" className={styles.choice} onClick={() => listen(saved)}>
                  {icons.play}
                  Continuar assistindo
                </button>
                <button type="button" className={styles.choice} onClick={() => listen(0)}>
                  {icons.restart}
                  Assistir do início
                </button>
              </span>
            </span>
          </div>
        ) : null}

        {mode === "playing" ? (
          <button
            type="button"
            className={styles.surface}
            aria-label="Pausar vídeo"
            onClick={() => video.current?.pause()}
          />
        ) : null}

        {mode === "paused" ? (
          <button
            type="button"
            className={`${styles.overlay} ${styles.dim}`}
            aria-label="Continuar assistindo"
            onClick={() => void video.current?.play()}
          >
            <span className={styles.bigPlay}>{icons.play}</span>
          </button>
        ) : null}

        {mode === "error" ? (
          <div className={`${styles.overlay} ${styles.dim}`} role="alert">
            <span className={styles.panel}>
              <strong>O vídeo não carregou</strong>
              <span>Confira a internet e tente de novo. A oferta continua logo abaixo.</span>
              <span className={styles.choices}>
                <button type="button" className={styles.choice} onClick={retry}>
                  {icons.restart}
                  Tentar de novo
                </button>
              </span>
            </span>
          </div>
        ) : null}

        {buffering && mode === "playing" ? (
          <p className={styles.buffering} role="status">
            Carregando o vídeo
          </p>
        ) : null}

        {banner ? (
          <p className={styles.trigger} role="status">
            {banner.text}
          </p>
        ) : null}

        {listening ? (
          <span className={styles.tools}>
            {floating ? (
              <button type="button" className={styles.tool} aria-label="Fechar o vídeo flutuante" onClick={dock}>
                {icons.close}
              </button>
            ) : (
              <>
                {captions ? (
                  <button
                    type="button"
                    className={styles.tool}
                    aria-label="Legendas"
                    aria-pressed={subtitles}
                    onClick={toggleSubtitles}
                  >
                    {icons.captions}
                  </button>
                ) : null}
                {options.speed ? (
                  <button type="button" className={styles.tool} aria-label={`Velocidade ${speed}x`} onClick={nextSpeed}>
                    {String(speed).replace(".", ",")}x
                  </button>
                ) : null}
                <button type="button" className={styles.tool} aria-label="Tela cheia" onClick={fullscreen}>
                  {icons.expand}
                </button>
              </>
            )}
          </span>
        ) : null}

        {button || showCta ? (
          <a className={styles.inVideoCta} href={href} onClick={() => track("cta_click", product)}>
            {button?.text ?? ctaText}
          </a>
        ) : null}

        {listening ? (
          <span className={styles.progress} aria-hidden>
            <span style={{ scale: `${options.fastBar ? shown(share) : share} 1` }} />
          </span>
        ) : null}
      </div>
    </div>
  );
}
