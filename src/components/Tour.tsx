import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
} from "react";
import type { ReactNode } from "react";
import { GraduationCap, X } from "lucide-react";
import { TOURS, type TourId } from "@/lib/tours";

const SEEN_KEY = (id: TourId) => `sr.tour.seen.${id}.v1`;

export function tourSeen(id: TourId): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(SEEN_KEY(id)) === "1";
  } catch {
    return true;
  }
}
function markSeen(id: TourId) {
  try {
    window.localStorage.setItem(SEEN_KEY(id), "1");
  } catch {
    /* private mode */
  }
}

type Ctx = { start: (id: TourId) => void; active: TourId | null };
const TourCtx = createContext<Ctx>({ start: () => {}, active: null });
export const useTour = () => useContext(TourCtx);

type Rect = { top: number; left: number; width: number; height: number };

function findTarget(id?: string): HTMLElement | null {
  if (!id) return null;
  const els = Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${id}"]`));
  // First one that is actually visible (sidebar items are hidden on mobile).
  return els.find((el) => el.getClientRects().length > 0 && el.offsetWidth > 0) ?? null;
}

export function TourProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<TourId | null>(null);
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [vw, setVw] = useState(0);
  const [vh, setVh] = useState(0);

  const start = useCallback((id: TourId) => {
    setI(0);
    setActive(id);
  }, []);

  const close = useCallback(() => {
    if (active) markSeen(active);
    setActive(null);
    setRect(null);
  }, [active]);

  const steps = active ? TOURS[active].steps : [];
  const step = steps[i];

  const measure = useCallback(() => {
    setVw(window.innerWidth);
    setVh(window.innerHeight);
    const el = findTarget(step?.target);
    if (!el) return setRect(null);
    const r = el.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [step?.target]);

  useLayoutEffect(() => {
    if (!active) return;
    const el = findTarget(step?.target);
    if (el) el.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
    measure();
    const t = setTimeout(measure, 350);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      clearTimeout(t);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [active, i, measure, step?.target]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") setI((x) => Math.min(x + 1, steps.length - 1));
      else if (e.key === "ArrowLeft") setI((x) => Math.max(x - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, close, steps.length]);

  const last = i === steps.length - 1;
  const PAD = 6;
  const CARD_W = Math.min(360, vw - 24);
  const mobile = vw < 640;

  let cardStyle: React.CSSProperties;
  if (!rect || mobile) {
    cardStyle = mobile
      ? { left: 12, right: 12, bottom: 12 }
      : { left: "50%", top: "50%", transform: "translate(-50%, -50%)", width: CARD_W };
  } else {
    const spaceBelow = vh - (rect.top + rect.height);
    const placeRight = rect.width < 280 && rect.left + rect.width + CARD_W + 24 < vw;
    if (placeRight) {
      cardStyle = {
        left: rect.left + rect.width + 16,
        top: Math.max(12, Math.min(rect.top - 8, vh - 260)),
        width: CARD_W,
      };
    } else {
      const left = Math.max(12, Math.min(rect.left, vw - CARD_W - 12));
      cardStyle =
        spaceBelow > 240
          ? { left, top: rect.top + rect.height + 14, width: CARD_W }
          : { left, bottom: Math.max(12, vh - rect.top + 14), width: CARD_W };
    }
  }

  return (
    <TourCtx.Provider value={{ start, active }}>
      {children}
      {active && step && (
        <div
          className="fixed inset-0 z-[100]"
          role="dialog"
          aria-modal="true"
          aria-label={TOURS[active].label}
        >
          {rect ? (
            <div
              className="pointer-events-none fixed rounded-xl ring-2 ring-primary transition-all duration-300"
              style={{
                top: rect.top - PAD,
                left: rect.left - PAD,
                width: rect.width + PAD * 2,
                height: rect.height + PAD * 2,
                boxShadow: "0 0 0 9999px rgba(15, 23, 42, 0.55)",
              }}
            />
          ) : (
            <div className="fixed inset-0 bg-slate-900/55" />
          )}
          {/* click-catcher so the page underneath isn't operated mid-tour */}
          <div className="fixed inset-0" onClick={close} aria-hidden="true" />
          <div
            className="fixed rounded-xl border border-border bg-background p-5 shadow-2xl"
            style={cardStyle}
          >
            <div className="flex items-start justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-primary">
                {TOURS[active].label} · {i + 1}/{steps.length}
              </p>
              <button
                type="button"
                onClick={close}
                className="-mr-1 -mt-1 grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Close tutorial"
              >
                <X className="size-4" />
              </button>
            </div>
            <h2 className="mt-1.5 text-base font-semibold">{step.title}</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
            <div className="mt-4 flex items-center justify-between gap-3">
              <div className="flex gap-1" aria-hidden="true">
                {steps.map((_, n) => (
                  <span
                    key={n}
                    className={`h-1.5 rounded-full transition-all ${n === i ? "w-4 bg-primary" : "w-1.5 bg-border"}`}
                  />
                ))}
              </div>
              <div className="flex gap-2">
                {i === 0 ? (
                  <button type="button" className="btn-glass btn-sm" onClick={close}>
                    Skip
                  </button>
                ) : (
                  <button type="button" className="btn-glass btn-sm" onClick={() => setI(i - 1)}>
                    Back
                  </button>
                )}
                <button
                  type="button"
                  className="btn-mint btn-sm"
                  autoFocus
                  onClick={() => (last ? close() : setI(i + 1))}
                >
                  {last ? "Done" : i === 0 && active === "welcome" ? "Start tour" : "Next"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </TourCtx.Provider>
  );
}

/** Small, consistent header button that (re)starts a section tour. */
export function TutorialButton({ tour }: { tour: TourId }) {
  const { start } = useTour();
  return (
    <button
      type="button"
      data-tour="tutorial-btn"
      className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-muted-foreground transition hover:bg-background hover:text-foreground"
      onClick={() => start(tour)}
      title="Show a quick walkthrough of this page"
    >
      <GraduationCap className="size-4" aria-hidden="true" />
      Tutorial
    </button>
  );
}

/** Auto-run the welcome tour once per browser after first sign-in. */
export function useWelcomeTour(enabled: boolean) {
  const { start, active } = useTour();
  useEffect(() => {
    if (!enabled || active || tourSeen("welcome")) return;
    const t = setTimeout(() => start("welcome"), 700);
    return () => clearTimeout(t);
  }, [enabled, active, start]);
}
