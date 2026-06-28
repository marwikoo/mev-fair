import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import s from "./Toast.module.css";

type Kind = "info" | "success" | "error" | "pending";
interface Toast {
  id: number;
  kind: Kind;
  msg: string;
}
interface ToastApi {
  push: (kind: Kind, msg: string) => number;
  update: (id: number, kind: Kind, msg: string) => void;
  dismiss: (id: number) => void;
}

const Ctx = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useToast outside provider");
  return v;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const push = useCallback(
    (kind: Kind, msg: string) => {
      const id = seq.current++;
      setToasts((t) => [...t, { id, kind, msg }]);
      if (kind !== "pending") setTimeout(() => dismiss(id), 5200);
      return id;
    },
    [dismiss]
  );

  const update = useCallback(
    (id: number, kind: Kind, msg: string) => {
      setToasts((t) => t.map((x) => (x.id === id ? { ...x, kind, msg } : x)));
      if (kind !== "pending") setTimeout(() => dismiss(id), 5200);
    },
    [dismiss]
  );

  const api = useMemo(() => ({ push, update, dismiss }), [push, update, dismiss]);

  return (
    <Ctx.Provider value={api}>
      {children}
      <div className={s.stack} role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`${s.toast} ${s[t.kind]}`} onClick={() => dismiss(t.id)}>
            <span className={s.dot} />
            <span className={s.msg}>{t.msg}</span>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
