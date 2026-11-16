import { Row } from "@/components/layout/row";
import { Stack } from "@/components/layout/stack";
import { Text } from "@/components/text/text";
import { archiveItem } from "@/lib/actions/products";
import type { productStates } from "@/lib/catalog/products";
import { OUTLINE } from "../shared";
import { ActionButton } from "../ui";

type ProductState = Awaited<ReturnType<typeof productStates>>[number];

export function DemoProducts({ items }: { items: ProductState[] }) {
  return (
    <Stack gap={2}>
      {items.map((item) => (
        <Row key={item.slug} justify="between">
          <Text variant="body-sm" weight="semibold">
            {item.name}
          </Text>
          <ActionButton
            action={archiveItem}
            fields={{ kind: "product", key: item.slug, archived: "1" }}
            button={OUTLINE}
            label="Arquivar"
            pendingLabel="Arquivando"
          />
        </Row>
      ))}
    </Stack>
  );
}
