import { Card } from "@/components/layout/card";
import { Disclosure } from "@/components/layout/disclosure";
import type { Product } from "@/lib/catalog";
import { OUTLINE } from "../shared";
import { Rows } from "../ui";
import { FaqFields } from "./faq-fields";
import { ProductForm } from "./product-form";
import { RowSummary } from "./row-summary";
import { TestimonialFields } from "./testimonial-fields";

export function ReviewsSection({ product }: { product: Product }) {
  return (
    <ProductForm product={product} section="reviews">
      <Card title="Perguntas frequentes">
        <Rows
          addLabel="Adicionar pergunta"
          button={OUTLINE}
          empty={{
            title: "Nenhuma pergunta ainda",
            description: "Responda as dúvidas que travam a compra: acesso, prazo, garantia.",
          }}
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
      </Card>
      <Card title="Depoimentos">
        <Rows
          addLabel="Adicionar depoimento"
          button={OUTLINE}
          empty={{
            title: "Nenhum depoimento ainda",
            description: "Use só depoimentos reais de alunos, com o nome que eles autorizaram.",
          }}
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
      </Card>
    </ProductForm>
  );
}
