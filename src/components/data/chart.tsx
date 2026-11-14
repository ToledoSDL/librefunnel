import type { ReactNode } from "react";
import { ChartFrame } from "./chart-frame";
import styles from "./chart.module.css";

function niceMax(value: number) {
  if (value <= 0) return 1;

  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((factor) => factor * magnitude >= value / 4) ?? 10;

  return step * magnitude * 4;
}

export function Chart({
  kind,
  title,
  data,
  format,
  empty,
  max: ceiling,
}: {
  kind: "bars" | "line" | "funnel";
  title: string;
  data: { label: string; value: number }[];
  format: (value: number) => string;
  empty: ReactNode;
  max?: number;
}) {
  if (data.every((point) => point.value === 0)) {
    return <div className={styles.chartEmpty}>{empty}</div>;
  }

  const fallback = (
    <table className="sr-only">
      <caption>{title}</caption>
      <tbody>
        {data.map((point) => (
          <tr key={point.label}>
            <th scope="row">{point.label}</th>
            <td>{format(point.value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  if (kind === "funnel") {
    const first = data[0]?.value ?? 0;

    return (
      <figure className={styles.funnel}>
        {fallback}
        <ol aria-hidden>
          {data.map((point, index) => {
            const previous = data[index - 1]?.value;

            return (
              <li key={point.label} className={styles.funnelRow}>
                <span className={styles.funnelLabel}>{point.label}</span>
                <svg className={styles.funnelBar} viewBox="0 0 100 8" preserveAspectRatio="none">
                  <rect width="100" height="8" className={styles.track} />
                  <rect width={first > 0 ? Math.max(1, (point.value / first) * 100) : 0} height="8" />
                </svg>
                <span className={styles.funnelValue}>
                  {format(point.value)}
                  {previous !== undefined && previous > 0 && (
                    <span>{Math.round((point.value / previous) * 100)}% da etapa anterior</span>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      </figure>
    );
  }

  const max = ceiling ?? niceMax(Math.max(...data.map((point) => point.value)));
  const y = (value: number) => 100 - (value / max) * 100;
  const ticks = [4, 3, 2, 1, 0].map((step) => (max / 4) * step);
  const width = 100 / data.length;
  const labelEvery = Math.ceil(data.length / 8);

  return (
    <figure className={styles.bars}>
      {fallback}
      <div className={styles.plot} aria-hidden>
        <ol className={styles.yAxis}>
          {ticks.map((tick) => (
            <li key={tick}>{format(tick)}</li>
          ))}
        </ol>
        <ChartFrame>
          <svg className={styles.svg} viewBox="0 0 100 100" preserveAspectRatio="none">
            {ticks.map((tick) => (
              <line key={tick} x1="0" x2="100" y1={y(tick)} y2={y(tick)} />
            ))}
            {data.map((point, index) => (
              <g key={point.label} data-tip={`${point.label}: ${format(point.value)}`} tabIndex={0}>
                <rect
                  className={kind === "line" ? styles.column : styles.hit}
                  x={index * width}
                  width={width}
                  y="0"
                  height="100"
                />
                {kind === "bars" && (
                  <rect
                    className={styles.bar}
                    x={index * width + width * 0.15}
                    width={width * 0.7}
                    y={y(point.value)}
                    height={100 - y(point.value)}
                  />
                )}
              </g>
            ))}
            {kind === "line" && (
              <polyline
                className={styles.line}
                points={[
                  `0,${y(data[0]?.value ?? 0)}`,
                  ...data.map((point, index) => `${(index + 0.5) * width},${y(point.value)}`),
                  `100,${y(data[data.length - 1]?.value ?? 0)}`,
                ].join(" ")}
              />
            )}
          </svg>
        </ChartFrame>
        <ol className={styles.xAxis} style={{ gridTemplateColumns: `repeat(${data.length}, minmax(0, 1fr))` }}>
          {data.map((point, index) => (
            <li key={point.label}>{index % labelEvery === 0 ? point.label : ""}</li>
          ))}
        </ol>
      </div>
    </figure>
  );
}
