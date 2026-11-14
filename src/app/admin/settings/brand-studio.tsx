"use client";

import { useState } from "react";
import inputStyles from "@/components/form/input.module.css";
import { inkFor } from "@/app/color";
import styles from "./settings.module.css";

// Saturated enough for a buy button and readable with the automatic text color.
const PRESETS = ["#1fa855", "#254ccb", "#0f766e", "#ea580c", "#e11d48", "#181917"];
const HEX = /^#[0-9a-f]{6}$/i;

export function BrandStudio({
  name,
  logo,
  accent,
  fallback,
}: {
  name: string;
  logo?: string;
  accent?: string;
  fallback: string;
}) {
  const [color, setColor] = useState(accent ?? "");
  const shown = HEX.test(color) ? color.toLowerCase() : fallback;

  return (
    <div className={styles.studio}>
      <div className={styles.swatches} role="radiogroup" aria-label="Cores sugeridas">
        {PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            role="radio"
            aria-checked={shown === preset}
            aria-label={preset}
            className={styles.preset}
            style={{ background: preset }}
            onClick={() => setColor(preset)}
          />
        ))}
        <label className={styles.custom} title="Outra cor">
          <span aria-hidden>+</span>
          <input
            type="color"
            aria-label="Outra cor"
            value={shown}
            onChange={(event) => setColor(event.currentTarget.value)}
          />
        </label>
      </div>
      <input
        className={inputStyles.input}
        name="accent"
        aria-label="Código da cor"
        value={color}
        placeholder={`${fallback} (padrão)`}
        maxLength={7}
        onChange={(event) => setColor(event.currentTarget.value)}
      />
      <div className={styles.preview} aria-label="Prévia do checkout">
        <div className={styles.previewBar}>
          {logo ? <img src={logo} alt="" height={24} /> : <strong>{name}</strong>}
          <span>Pagamento 100% seguro</span>
        </div>
        <div className={styles.previewBody}>
          <span className={styles.previewLine} />
          <span className={styles.previewLine} />
          <span className={styles.previewButton} style={{ background: shown, color: inkFor(shown) }}>
            PAGAR COM PIX
          </span>
        </div>
      </div>
    </div>
  );
}
