# Lovable release handoff

- Project: **ServiceReady Frontend**
- Project ID: `7bfab13f-33d0-49f1-9398-96ed1714cb74`
- Workspace: `irLW4TciATm6oHrGANe4`
- Source of truth for this pass: `/workspace/serviceready`
- Keep mock mode enabled for the reviewed hackathon experience (default when no env override is set).

## Release notes

Reliable persistent booking/payment lifecycle; buyer-approved PayPal checkout; correct invoice aging and collections rules; safe approval audit/history; validation-aware catalog import/upsert; client messaging; real dashboard counts; mobile cards/navigation; actionable errors/loading/empty states; copy controls; production-worker preview fixes; patched dependency audit; 39 automated tests and repeatable browser smoke.

## Key paths

- `src/lib/mock.ts`, `api.ts`, `validation.ts`, `clipboard.ts`, `labels.ts`
- `src/components/PayPalDepositButton.tsx`, `BookingsGrid.tsx`, `CollectionsStudio.tsx`, `ProposalCard.tsx`, `StatusTracker.tsx`, `EventTimeline.tsx`, `kit.tsx`
- Public/onboarding/workspace files in `src/routes/`, plus `src/router.tsx` and `src/styles.css`
- `src/test/`, `scripts/browser-smoke.mjs`, `package.json`, `bun.lock`, `nitro.config.ts`, `vitest.config.ts`, `tsconfig.json`
- `.env.example`, `README.md`, `BUGFIX_REPORT.md`

## Parent release checklist

1. Apply the final source tree/archive or patch to the same Lovable project. Do not overwrite newer independent project work blindly and do not force-push.
2. Keep any secret/backend configuration out of source and public `VITE_*` variables.
3. Build in Lovable and publish to the existing project URL.
4. On the **published URL**, smoke-test landing → storefront → quote → buyer approval → deposit → seller delivery/invoice → collections approval → demo balance paid → paid metrics.
5. Check Settings, catalog import and mobile navigation. Reset demo data once the smoke pass finishes.
6. Report the actual published URL and verification result to Kartik. Do not claim the external production backend or real money flows were certified; see the report's integration boundaries.

No Lovable changes or publication were made by the executor. Local git metadata was created only to track the archive's baseline and changes; it is not a connected remote repository. Deploy the source files, never `.git`, `node_modules`, `.output`, or QA artifacts.
