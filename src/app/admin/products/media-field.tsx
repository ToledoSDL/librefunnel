import { Field } from "@/components/form/field";
import { OUTLINE } from "../shared";
import { MediaUpload } from "../ui";

const HINTS = {
  image: "JPG, PNG ou WebP, até 10 MB.",
  video: "MP4 ou WebM, até 1 GB. Salve quando chegar a 100%.",
  captions: "Arquivo .vtt, até 1 MB.",
};

export function MediaField({
  name,
  kind,
  value,
  label,
}: {
  name: string;
  kind: "video" | "image" | "captions";
  value?: string;
  label: string;
}) {
  return (
    <Field label={label} hint={HINTS[kind]}>
      {(control) => (
        <MediaUpload {...control} name={name} kind={kind} value={value} button={OUTLINE} remove={OUTLINE} />
      )}
    </Field>
  );
}
