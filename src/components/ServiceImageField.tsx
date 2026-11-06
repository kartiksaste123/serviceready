import { useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, RefreshCw, Sparkles, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { api, USE_MOCKS } from "@/lib/api";

type Props = {
  title: string;
  description?: string | undefined;
  deliverables?: readonly string[] | undefined;
  imageUrl?: string | null | undefined;
  serviceId?: string | undefined;
  /** When true, user must be signed in for generate/upload (live mode). */
  requireAuth?: boolean | undefined;
  signedIn?: boolean | undefined;
  onChange: (url: string | null) => void;
};

async function fileToDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file (PNG, JPG or WebP)");
  if (file.size > 5_000_000) throw new Error("Image must be under 5 MB");
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read that file"));
    reader.readAsDataURL(file);
  });
}

export function ServiceImageField({
  title,
  description,
  deliverables,
  imageUrl,
  serviceId,
  requireAuth,
  signedIn,
  onChange,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"upload" | "generate" | "clear" | null>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (busy !== "generate") return;
    setElapsed(0);
    const started = Date.now();
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(t);
  }, [busy]);

  async function run(mode: "upload" | "generate", data_url?: string) {
    if (requireAuth && !USE_MOCKS && !signedIn) {
      toast.error("Sign in first to add a cover image");
      return;
    }
    setBusy(mode);
    try {
      const res = await api.setServiceImage({
        mode,
        title,
        ...(description ? { description } : {}),
        ...(deliverables?.length ? { deliverables: [...deliverables] } : {}),
        ...(data_url ? { data_url } : {}),
        ...(serviceId ? { service_id: serviceId } : {}),
      });
      onChange(res.image_url);
      toast.success(mode === "generate" ? "AI cover ready" : "Cover uploaded");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not set image");
    } finally {
      setBusy(null);
    }
  }

  async function clear() {
    if (!serviceId) {
      onChange(null);
      return;
    }
    setBusy("clear");
    try {
      await api.setServiceImage({ mode: "clear", service_id: serviceId });
      onChange(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove image");
    } finally {
      setBusy(null);
    }
  }

  const generating = busy === "generate";
  const disabled = busy !== null;
  const hint =
    elapsed < 15
      ? "Composing a cover for this service…"
      : elapsed < 45
        ? "Rendering details — usually 20–60s"
        : "Almost there — high-quality covers can take a minute";

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="relative aspect-[16/9] bg-muted">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={`Cover for ${title}`}
            className={`h-full w-full object-cover ${generating ? "blur-[2px]" : ""}`}
          />
        ) : (
          <div className="grid h-full place-items-center px-4 text-center">
            <div className="flex flex-col items-center gap-1.5 text-muted-foreground">
              <ImagePlus className="size-6 opacity-60" aria-hidden="true" />
              <span className="text-sm font-medium text-foreground/80">No cover image</span>
              <span className="text-xs">Generate one from this service, or upload your own</span>
            </div>
          </div>
        )}

        {generating && (
          <div
            className="absolute inset-0 grid place-items-center bg-background/75 backdrop-blur-sm"
            role="status"
            aria-live="polite"
          >
            <div className="flex flex-col items-center gap-2 px-4 text-center">
              <Loader2 className="size-6 animate-spin text-primary" aria-hidden="true" />
              <span className="text-sm font-semibold text-foreground">
                Generating cover · <span className="tabular-nums">{elapsed}s</span>
              </span>
              <span className="text-xs text-muted-foreground">{hint}</span>
              <span className="mt-1 h-1 w-32 overflow-hidden rounded-full bg-muted">
                <span
                  className="block h-full rounded-full bg-primary transition-[width] duration-1000 ease-linear"
                  style={{ width: `${Math.min(95, 8 + elapsed * 1.6)}%` }}
                />
              </span>
            </div>
          </div>
        )}

        {imageUrl && !generating && (
          <button
            type="button"
            className="absolute right-2 top-2 grid size-7 place-items-center rounded-full bg-background/90 text-foreground shadow-sm ring-1 ring-border transition hover:bg-background disabled:opacity-50"
            aria-label="Remove cover"
            title="Remove cover"
            disabled={disabled}
            onClick={() => void clear()}
          >
            {busy === "clear" ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <X className="size-3.5" aria-hidden="true" />
            )}
          </button>
        )}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 border-t border-border p-2">
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            void fileToDataUrl(f)
              .then((data_url) => run("upload", data_url))
              .catch((err) => toast.error(err instanceof Error ? err.message : "Upload failed"));
          }}
        />
        <button
          type="button"
          className="inline-flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground shadow-xs transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
          disabled={disabled || !title.trim()}
          aria-busy={generating}
          onClick={() => void run("generate")}
        >
          {generating ? (
            <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden="true" />
          ) : imageUrl ? (
            <RefreshCw className="size-4 shrink-0" aria-hidden="true" />
          ) : (
            <Sparkles className="size-4 shrink-0" aria-hidden="true" />
          )}
          <span className="truncate">
            {generating ? "Generating…" : imageUrl ? "Regenerate with AI" : "Generate with AI"}
          </span>
        </button>
        <button
          type="button"
          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-input bg-background px-3 text-sm font-medium text-foreground shadow-xs transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
          disabled={disabled}
          aria-busy={busy === "upload"}
          title={imageUrl ? "Replace with your own image" : "Upload your own image"}
          onClick={() => inputRef.current?.click()}
        >
          {busy === "upload" ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Upload className="size-4" aria-hidden="true" />
          )}
          <span>{imageUrl ? "Replace" : "Upload"}</span>
        </button>
      </div>
    </div>
  );
}
