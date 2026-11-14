import { SettingRow } from "@/components/form/setting-row";
import { Switch } from "@/components/form/switch";
import { Card } from "@/components/layout/card";
import { Disclosure } from "@/components/layout/disclosure";
import { DEFAULT_BAR } from "@/lib/catalog";
import type { Product } from "@/lib/catalog";
import styles from "../admin.module.css";
import { OUTLINE, TextField } from "../shared";
import { Rows } from "../ui";
import { MediaField } from "./media-field";
import { PLAYER_FIELDS, ProductForm } from "./product-form";
import { RetentionCard } from "./retention-card";
import { RowSummary } from "./row-summary";
import { TriggerFields } from "./trigger-fields";

const PLAYER_ROWS: { name: keyof typeof PLAYER_FIELDS; title: string; description: string }[] = [
  {
    name: "playerAutoplay",
    title: "Autoplay inteligente",
    description:
      "O vídeo começa sozinho e sem som, com o aviso “Seu vídeo já começou”. Ao tocar, ele volta do início com som. Desligado, a pessoa vê a capa e um botão de play.",
  },
  {
    name: "playerResume",
    title: "Continuar de onde parou",
    description: "Quem volta à página escolhe entre continuar do ponto em que parou ou assistir do início.",
  },
  {
    name: "playerButton",
    title: "Botão de compra dentro do vídeo",
    description: "Junto com a oferta da página, o botão também aparece sobre o vídeo, no segundo definido acima.",
  },
  {
    name: "playerFloating",
    title: "Vídeo flutuante",
    description: "Quem rola a página com o vídeo tocando continua assistindo numa janela pequena no canto.",
  },
  {
    name: "playerFastBar",
    title: "Barra de progresso acelerada",
    description:
      "A barra anda mais rápido no começo e mais devagar no fim, e termina junto com o vídeo. Desligada, mostra o tempo real.",
  },
  {
    name: "playerSpeed",
    title: "Controle de velocidade",
    description: "Mostra um botão para assistir em 1,25x, 1,5x ou 2x.",
  },
];

export function SalesSection({ product }: { product: Product }) {
  return (
    <ProductForm product={product} section="sales">
      <Card title="Vídeo de vendas">
        <MediaField name="vslVideo" kind="video" label="Vídeo de vendas" value={product.vsl?.video} />
        <div className={styles.grid}>
          <TextField
            label="Oferta aparece aos (segundos)"
            hint="A página abaixo do vídeo fica escondida até esse segundo, contado com o som ligado. 0 mostra tudo desde o início."
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
        <MediaField name="captions" kind="captions" label="Legendas (.vtt)" value={product.vsl?.captions} />
      </Card>
      {product.vsl ? <RetentionCard product={product.slug} /> : null}
      <Card title="Barra no topo">
        <div className={styles.grid}>
          <TextField
            label="Texto da barra"
            hint="Em branco, a barra não aparece. Com prazo da oferta definido em Checkout, ela mostra a contagem regressiva até ele."
            name="barText"
            maxLength={120}
            placeholder="Condição de lançamento: só até domingo"
            defaultValue={product.bar?.text}
          />
          <TextField
            label="Cor da barra"
            name="barColor"
            type="color"
            defaultValue={product.bar?.color ?? DEFAULT_BAR}
          />
        </div>
      </Card>
      <Card title="Textos e botões no vídeo">
        <Rows
          addLabel="Adicionar texto"
          button={OUTLINE}
          empty={{
            title: "Nenhum texto no vídeo",
            description: "Destaque um momento do pitch ou mostre o botão de compra num trecho específico.",
          }}
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
      </Card>
      <Card title="Player">
        <div>
          {PLAYER_ROWS.map((row) => (
            <SettingRow key={row.name} title={row.title} description={row.description}>
              <Switch
                name={row.name}
                value="1"
                defaultChecked={product.player[PLAYER_FIELDS[row.name]]}
                label="Ligado"
              />
            </SettingRow>
          ))}
        </div>
      </Card>
      <Card title="Imagens">
        <div className={styles.grid}>
          <MediaField name="banner" kind="image" label="Banner (1040 x 325)" value={product.banner} />
          <MediaField name="cover" kind="image" label="Capa (quadrada)" value={product.cover} />
        </div>
      </Card>
    </ProductForm>
  );
}
