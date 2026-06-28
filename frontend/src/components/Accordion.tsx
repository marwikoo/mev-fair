import { useState } from "react";
import s from "./Accordion.module.css";

export interface QA {
  q: string;
  a: string;
}

export function Accordion({ items }: { items: QA[] }) {
  const [open, setOpen] = useState<number>(0);
  return (
    <div className={s.list}>
      {items.map((it, i) => {
        const isOpen = open === i;
        return (
          <div key={i} className={`${s.item} ${isOpen ? s.open : ""}`}>
            <button
              className={s.q}
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? -1 : i)}
            >
              <span>{it.q}</span>
              <span className={s.plus} aria-hidden>
                {isOpen ? "–" : "+"}
              </span>
            </button>
            <div className={s.aWrap} style={{ gridTemplateRows: isOpen ? "1fr" : "0fr" }}>
              <div className={s.aInner}>
                <p className={s.a}>{it.a}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
