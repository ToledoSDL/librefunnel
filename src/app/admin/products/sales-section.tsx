import { Switch } from "@/components/form/switch";
import { Disclosure } from "@/components/layout/disclosure";
import { Section } from "@/components/layout/section";
import { Stack } from "@/components/layout/stack";
import { Icon } from "@/components/media/icon";
import { DEFAULT_BAR } from "@/lib/catalog";
import type { Product } from "@/lib/catalog";
import styles from "../admin.module.css";
import { GHOST, TextField } from "../shared";
import { Rows } from "../ui";
import { MediaField } from "./media-field";
import { PLAYER_FIELDS, ProductForm } from "./product-form";
import { RetentionChart } from "./retention-chart";
import { RowSummary } from "./row-summary";
import { TriggerFields } from "./trigger-fields";

const PLAYER_ROWS: { name: keyof typeof PLAYER_FIELDS; title: string; description: string }[] = [
  {
    name: "playerAutoplay",
    title: "Autoplay inteligente",
    description: "Começa sem som, com o aviso “Seu vídeo já começou”.",
  },
  { name: "playerResume", title: "Continuar de onde parou", description: "Quem volta escolhe continuar ou recomeçar." },
  {
    name: "playerButton",
    title: "Botão de compra no vídeo",
    description: "Aparece sobre o vídeo junto com a oferta.",
  },
  { name: "playerFloating", title: "Vídeo flutuante", description: "Segue tocando num canto ao rolar a página." },
  { name: "playerFastBar", title: "Barra de progresso acelerada", description: "Anda mais rápido no começo." },
  { name: "playerSpeed", title: "Controle de velocidade", description: "1,25x, 1,5x ou 2x." },
];

export function SalesSection({ product }: { product: Product }) {
  return (
    <ProductForm product={product} section="sales">
      <Section title="Vídeo de vendas" description="A oferta abaixo do vídeo aparece no segundo escolhido.">
        <MediaField name="vslVideo" kind="video" label="Vídeo" value={product.vsl?.video} />
        <div className={styles.grid}>
          <TextField
            label="Oferta aparece aos (segundos)"
            hint="0 mostra desde o início."
            name="ctaSeconds"
            type="number"
            min={0}
            max={7200}
            defaultValue={product.vsl?.ctaSeconds ?? 0}
          />
          <TextField
            label="Texto do botão"
            name="ctaText"
            maxLength={80}
            placeholder="Sim, quero começar agora"
            defaultValue={product.vsl?.ctaText}
          />
        </div>
        <MediaField name="captions" kind="captions" label="Legendas" value={product.vsl?.captions} />
      </Section>
      {product.vsl ? (
        <Section title="Retenção" description="Quanto do vídeo as pessoas assistem com som.">
          <RetentionChart product={product.slug} />
        </Section>
      ) : null}
      <Section title="Player">
        <Stack gap={4}>
          {PLAYER_ROWS.map((row) => (
            <Switch
              key={row.name}
              name={row.name}
              value="1"
              defaultChecked={product.player[PLAYER_FIELDS[row.name]]}
              label={row.title}
              description={row.description}
            />
          ))}
        </Stack>
      </Section>
      <Section title="Textos no vídeo" description="Uma frase ou o botão de compra num trecho do vídeo.">
        <Rows
          addLabel="Adicionar texto"
          button={GHOST}
          icons={{ add: <Icon name="plus" size={16} />, remove: <Icon name="trash-2" size={16} /> }}
          rows={product.triggers.map((trigger) => (
            <Disclosure
              key={`${trigger.at}-${trigger.text}`}
              label={
                <RowSummary
                  title={trigger.text}
                  text={`${trigger.button ? "Botão" : "Texto"} de ${trigger.at}s a ${trigger.until}s`}
                />
              }
            >
              <TriggerFields trigger={trigger} />
            </Disclosure>
          ))}
          blank={
            <Disclosure open label="Novo texto">
              <TriggerFields />
            </Disclosure>
          }
        />
      </Section>
      <Section title="Barra no topo" description="Com fim da oferta definido, mostra a contagem regressiva.">
        <div className={styles.grid}>
          <TextField
            label="Texto"
            hint="Em branco, a barra não aparece."
            name="barText"
            maxLength={120}
            placeholder="Condição de lançamento: só até domingo"
            defaultValue={product.bar?.text}
          />
          <TextField label="Cor" name="barColor" type="color" defaultValue={product.bar?.color ?? DEFAULT_BAR} />
        </div>
      </Section>
      <Section title="Imagens">
        <div className={styles.grid}>
          <MediaField name="cover" kind="image" label="Capa (16:9)" value={product.cover} />
          <MediaField name="banner" kind="image" label="Banner (1040 × 325)" value={product.banner} />
        </div>
      </Section>
    </ProductForm>
  );
}
