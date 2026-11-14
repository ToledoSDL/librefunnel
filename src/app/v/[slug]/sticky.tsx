"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { track } from "@/app/ui";
import styles from "./page.module.css";

// Shows the bar only once the offer under the video has been seen and scrolled past, so the price is never on screen twice.
export function StickyOffer({ product, children }: { product: string; children: ReactNode }) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const offer = document.getElementById("oferta");

    if (!offer) return;

    let seen = false;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const { isIntersecting, boundingClientRect } of entries) {
          if (isIntersecting && !seen) {
            seen = true;
            track("cta_view", product);
          }
          setShown(seen && !isIntersecting && boundingClientRect.top < 0);
        }
      },
      { threshold: 0.5 },
    );

    observer.observe(offer);
    return () => observer.disconnect();
  }, [product]);

  return (
    <div className={styles.sticky} hidden={!shown}>
      {children}
    </div>
  );
}
