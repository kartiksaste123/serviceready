import { useEffect, useRef, useState } from "react";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import type { AuthChallenge } from "@/lib/api";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";

interface AuthCodeProps {
  challenge: AuthChallenge;
  onSubmit: (code: string) => Promise<unknown>;
  onResend: () => Promise<AuthChallenge>;
  onDifferentEmail: () => void;
  autoSubmit?: boolean;
}

export function AuthCode({
  challenge,
  onSubmit,
  onResend,
  onDifferentEmail,
  autoSubmit = true,
}: AuthCodeProps) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [countdown, setCountdown] = useState(60);
  const [busy, setBusy] = useState(false);
  const submittedValue = useRef("");

  useEffect(() => {
    setValue("");
    setError("");
    setCountdown(60);
    submittedValue.current = "";
  }, [challenge.challenge_id, challenge.purpose]);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = window.setTimeout(() => setCountdown((current) => Math.max(0, current - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [countdown]);

  const submit = async (code = value) => {
    if (code.length !== 6 || busy) return;
    setBusy(true);
    setError("");
    try {
      await onSubmit(code);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "We couldn't verify that code.");
      submittedValue.current = "";
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setBusy(true);
    setError("");
    try {
      await onResend();
      setCountdown(60);
      setValue("");
      submittedValue.current = "";
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "We couldn't send another code.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <p className="text-sm text-muted-foreground">
        We sent a 6-digit code to <span className="font-medium text-foreground">{challenge.email_hint}</span>
      </p>
      <InputOTP
        maxLength={6}
        value={value}
        pattern={REGEXP_ONLY_DIGITS}
        inputMode="numeric"
        autoComplete="one-time-code"
        disabled={busy}
        onChange={(next) => {
          setValue(next);
          setError("");
          if (autoSubmit && next.length === 6 && submittedValue.current !== next) {
            submittedValue.current = next;
            void submit(next);
          }
        }}
        containerClassName="mt-5 justify-between gap-1"
      >
        <InputOTPGroup>
          {Array.from({ length: 6 }, (_, index) => (
            <InputOTPSlot key={index} index={index} className="size-10 rounded-md border bg-background" />
          ))}
        </InputOTPGroup>
      </InputOTP>
      {error && <p className="mt-3 text-sm text-danger" role="alert">{error}</p>}
      {!autoSubmit && (
        <button
          className="btn-primary mt-4 w-full"
          disabled={value.length !== 6 || busy}
          onClick={() => void submit()}
        >
          {busy ? "Checking code…" : "Verify code"}
        </button>
      )}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
        <button
          type="button"
          className="text-link underline underline-offset-4 disabled:text-muted-foreground disabled:no-underline"
          disabled={countdown > 0 || busy}
          onClick={() => void resend()}
        >
          Resend code{countdown > 0 ? ` in ${countdown}s` : ""}
        </button>
        <button
          type="button"
          className="text-muted-foreground underline underline-offset-4 hover:text-foreground"
          onClick={onDifferentEmail}
        >
          Use a different email
        </button>
      </div>
    </div>
  );
}
