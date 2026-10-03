<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- All data access goes through `src/lib/api.ts`; it uses `src/lib/mock.ts` unless `VITE_USE_MOCKS === 'false'` — the real backend is external and owned by the user.
- `PayPalDepositButton`, `BookingsGrid`, `CollectionsStudio` are swap-in seams; keep their props stable.
- Frontend presentation uses only semantic light-mode tokens from `src/styles.css`; feature code must not introduce palette-specific colors.
- Frontend presentation uses only semantic light-mode tokens from `src/styles.css`; feature code must not introduce palette-specific colors.
