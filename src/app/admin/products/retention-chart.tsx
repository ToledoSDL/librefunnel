import { Chart } from "@/components/data/chart";
import { Stack } from "@/components/layout/stack";
import { Text } from "@/components/text/text";
import { retentionCurve } from "@/lib/tracking";
import { INTEGER } from "../shared";

const PERCENT = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 0 });

function clock(second: number) {
  return `${Math.floor(second / 60)}:${String(second % 60).padStart(2, "0")}`;
}

export async function RetentionChart({ product }: { product: string }) {
  const curve = await retentionCurve(product);

  return (
    <Stack gap={3}>
      {curve.plays ? (
        <Text variant="body-sm" tone="muted">
          {INTEGER.format(curve.plays)} {curve.plays === 1 ? "reprodução" : "reproduções"} com som desde o início
        </Text>
      ) : null}
      <Chart
        kind="line"
        title="Retenção do vídeo"
        data={curve.points.map((point) => ({ label: clock(point.second), value: point.share }))}
        format={(value) => PERCENT.format(value)}
        max={1}
        empty="Ainda ninguém assistiu ao vídeo com som."
      />
    </Stack>
  );
}
