"use client";
import { useEffect, useRef, useState } from "react";
import { PhoneFrame, Shot } from "@/components/frames";

type Step = { time: string; title: string; text: string; shot: string; alt: string };

export function Story({ steps }: { steps: Step[] }) {
  const [active, setActive] = useState(0);
  const list = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const items = [...(list.current?.querySelectorAll(":scope > li") ?? [])];
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(items.indexOf(entry.target));
        }
      },
      { rootMargin: "-45% 0px -45% 0px" },
    );

    for (const item of items) observer.observe(item);

    return () => observer.disconnect();
  }, []);

  return (
    <div className="grid gap-10 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-16">
      <div className="hidden md:block">
        <div className="sticky top-[max(2rem,calc(50vh-300px))]">
          <PhoneFrame className="mx-auto w-[280px]">
            {steps.map((step, index) => (
              <div
                key={step.shot}
                className={`absolute inset-0 transition-[opacity,translate] duration-500 ease-out motion-reduce:transition-none ${
                  index === active
                    ? "opacity-100"
                    : index < active
                      ? "-translate-y-6 opacity-0"
                      : "translate-y-6 opacity-0"
                }`}
              >
                <Shot name={step.shot} alt={step.alt} />
              </div>
            ))}
          </PhoneFrame>
        </div>
      </div>
      <ol ref={list} className="relative grid gap-4 md:gap-0 md:py-[20vh]">
        <span aria-hidden className="absolute top-0 bottom-0 left-[1.6rem] w-px bg-fd-border max-md:hidden" />
        {steps.map((step, index) => (
          <li key={step.time + step.title} className="relative grid gap-4 md:min-h-[50vh] md:content-center">
            <div className="grid grid-cols-[3.25rem_minmax(0,1fr)] items-start gap-4">
              <span
                className={`relative z-10 rounded-full border py-1 text-center font-mono text-xs tabular-nums transition-colors duration-300 ${
                  index <= active
                    ? "border-fd-primary bg-fd-primary text-fd-primary-foreground"
                    : "border-fd-border bg-fd-background text-fd-muted-foreground"
                }`}
              >
                {step.time}
              </span>
              <div className={`transition-opacity duration-300 ${index === active ? "" : "md:opacity-40"}`}>
                <h3 className="text-xl font-medium tracking-tight md:text-2xl">{step.title}</h3>
                <p className="mt-1 text-fd-muted-foreground md:text-lg">{step.text}</p>
              </div>
            </div>
            <PhoneFrame className="reveal mx-auto w-[220px] md:hidden">
              <Shot name={step.shot} alt={step.alt} />
            </PhoneFrame>
          </li>
        ))}
      </ol>
    </div>
  );
}
