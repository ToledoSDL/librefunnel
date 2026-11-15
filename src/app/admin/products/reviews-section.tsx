import { Disclosure } from "@/components/layout/disclosure";
import { Section } from "@/components/layout/section";
import { Icon } from "@/components/media/icon";
import type { Product } from "@/lib/catalog";
import { GHOST } from "../shared";
import { Rows } from "../ui";
import { FaqFields } from "./faq-fields";
import { ProductForm } from "./product-form";
import { RowSummary } from "./row-summary";
import { TestimonialFields } from "./testimonial-fields";

export function ReviewsSection({ product }: { product: Product }) {
  const icons = { add: <Icon name="plus" size={16} />, remove: <Icon name="trash-2" size={16} /> };

  return (
    <ProductForm product={product} section="reviews">
      <Section title="Perguntas frequentes" description="As dúvidas que travam a compra: acesso, prazo, garantia.">
        <Rows
          addLabel="Adicionar pergunta"
          button={GHOST}
          icons={icons}
          rows={product.faq.map((item) => (
            <Disclosure key={item.q} label={<RowSummary title={item.q} text={item.a} />}>
              <FaqFields question={item.q} answer={item.a} />
            </Disclosure>
          ))}
          blank={
            <Disclosure open label="Nova pergunta">
              <FaqFields />
            </Disclosure>
          }
        />
      </Section>
      <Section title="Depoimentos" description="Só depoimentos reais, com o nome autorizado.">
        <Rows
          addLabel="Adicionar depoimento"
          button={GHOST}
          icons={icons}
          rows={product.testimonials.map((item) => (
            <Disclosure
              key={item.name + item.text}
              label={
                <RowSummary
                  title={`${item.name}, ${item.stars === 1 ? "1 estrela" : `${item.stars} estrelas`}`}
                  text={item.text}
                />
              }
            >
              <TestimonialFields name={item.name} text={item.text} stars={item.stars} />
            </Disclosure>
          ))}
          blank={
            <Disclosure open label="Novo depoimento">
              <TestimonialFields />
            </Disclosure>
          }
        />
      </Section>
    </ProductForm>
  );
}
