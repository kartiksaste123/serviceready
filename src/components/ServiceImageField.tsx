import { useRef, useState } from "react";
import { ImagePlus, Loader2, Sparkles, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { api, USE_MOCKS } from "@/lib/api";

type Props = {
  title: string;
  description?: string | undefined;
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
  imageUrl,
  serviceId,
  requireAuth,
  signedIn,
  onChange,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"upload" | "generate" | null>(null);

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
        ...(data_url ? { data_url } : {}),
        ...(serviceId ? { service_id: serviceId } : {}),
      });
      onChange(res.image_url);
      toast.success(mode === "generate" ? "Cover generated" : "Cover uploaded");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not set image");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-muted/40">
      <div className="relative aspect-[16/9] bg-muted">
        {imageUrl ? (
          <img src={imageUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="grid h-full place-items-center gap-2 px-4 text-center text-sm text-muted-foreground">
            <ImagePlus className="size-7 opacity-50" aria-hidden="true" />
            <span>No cover yet — upload one or generate with AI</span>
          </div>
        )}
        {imageUrl && (
          <button
            type="button"
            className="absolute right-2 top-2 rounded-full bg-background/90 p-1.5 shadow"
            aria-label="Remove cover"
            disabled={busy !== null}
            onClick={() => {
              if (serviceId) {
                void (async () => {
                  setBusy("upload");
                  try {
                    await api.setServiceImage({ mode: "clear", service_id: serviceId });
                    onChange(null);
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Could not remove image");
                  } finally {
                    setBusy(null);
                  }
                })();
              } else {
                onChange(null);
              }
            }}
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-2 border-t border-border bg-background p-2.5">
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
          className="btn-glass btn-sm"
          disabled={busy !== null}
          onClick={() => inputRef.current?.click()}
        >
          {busy === "upload" ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Upload className="size-3.5" aria-hidden="true" />
          )}
          Upload image
        </button>
        <button
          type="button"
          className="btn-mint btn-sm"
          disabled={busy !== null || !title.trim()}
          onClick={() => void run("generate")}
        >
          {busy === "generate" ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Sparkles className="size-3.5" aria-hidden="true" />
          )}
          Generate with AI
        </button>
      </div>
    </div>
  );
}
