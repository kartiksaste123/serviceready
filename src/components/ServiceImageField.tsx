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
  /**
   * stack = preview on top + Upload/Generate row (narrow column / onboard right rail)
   * row = preview left + buttons right (catalog cards)
   */
  layout?: "stack" | "row" | undefined;
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
  layout = "stack",
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

  const preview = (
    <div
      className={`relative overflow-hidden rounded-lg bg-muted ${
        layout === "row"
          ? "h-28 w-36 shrink-0 sm:h-32 sm:w-40"
          : "h-[160px] w-full"
      }`}
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={`Cover for ${title}`}
          className={`h-full w-full object-cover ${generating ? "blur-[2px]" : ""}`}
        />
      ) : (
        <div className="grid h-full place-items-center px-2 text-center">
          <div className="flex flex-col items-center gap-1 text-muted-foreground">
            <ImagePlus className="size-5 opacity-60" aria-hidden="true" />
            <span className="text-xs font-medium text-foreground/80">No cover</span>
          </div>
        </div>
      )}

      {generating && (
        <div
          className="absolute inset-0 grid place-items-center bg-background/75 backdrop-blur-sm"
          role="status"
          aria-live="polite"
        >
          <div className="flex flex-col items-center gap-1 px-2 text-center">
            <Loader2 className="size-5 animate-spin text-primary" aria-hidden="true" />
            <span className="text-[11px] font-semibold text-foreground tabular-nums">{elapsed}s</span>
            <span className="hidden text-[10px] text-muted-foreground sm:block">{hint}</span>
          </div>
        </div>
      )}

      {imageUrl && !generating && (
        <button
          type="button"
          className="absolute right-1.5 top-1.5 grid size-6 place-items-center rounded-full bg-background/90 text-foreground shadow-sm ring-1 ring-border transition hover:bg-background disabled:opacity-50"
          aria-label="Remove cover"
          title="Remove cover"
          disabled={disabled}
          onClick={() => void clear()}
        >
          {busy === "clear" ? (
            <Loader2 className="size-3 animate-spin" aria-hidden="true" />
          ) : (
            <X className="size-3" aria-hidden="true" />
          )}
        </button>
      )}
    </div>
  );

  const actions = (
    <div className={`flex gap-2 ${layout === "row" ? "flex-col sm:flex-1 sm:justify-center" : "w-full"}`}>
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
        className="inline-flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-2.5 text-xs font-semibold text-primary-foreground shadow-xs transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
        disabled={disabled || !title.trim()}
        aria-busy={generating}
        onClick={() => void run("generate")}
      >
        {generating ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden="true" />
        ) : imageUrl ? (
          <RefreshCw className="size-3.5 shrink-0" aria-hidden="true" />
        ) : (
          <Sparkles className="size-3.5 shrink-0" aria-hidden="true" />
        )}
        <span className="truncate">{generating ? "Generating…" : imageUrl ? "Regenerate" : "Generate"}</span>
      </button>
      <button
        type="button"
        className="inline-flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg border border-input bg-background px-2.5 text-xs font-medium text-foreground shadow-xs transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
        disabled={disabled}
        aria-busy={busy === "upload"}
        title={imageUrl ? "Replace with your own image" : "Upload your own image"}
        onClick={() => inputRef.current?.click()}
      >
        {busy === "upload" ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <Upload className="size-3.5" aria-hidden="true" />
        )}
        <span>{imageUrl ? "Replace" : "Upload"}</span>
      </button>
    </div>
  );

  return (
    <div
      className={`overflow-hidden rounded-xl border border-border bg-card p-2 ${
        layout === "row" ? "flex items-stretch gap-3" : "flex flex-col gap-2"
      }`}
    >
      {preview}
      {actions}
    </div>
  );
}
