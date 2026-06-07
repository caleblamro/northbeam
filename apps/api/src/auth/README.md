# auth/

Better Auth lives here. The construction (`instance.ts`) is **module-private**.

- Everything outside this directory imports typed helpers from `index.ts`
  (which re-exports the hand-written wrappers in `api.ts`).
- This isolates the rest of the app from Better Auth's inferred types, so a
  BA version bump only touches `api.ts`, not every call site.
- Need a method that isn't exposed yet? Add a wrapper to `api.ts` — don't
  import `instance.ts` directly.

Auth model (v1): **magic-link only** (`emailAndPassword:false`), organization
plugin with roles `owner | admin | member | viewer` (viewer is read-only,
registered via the `roles` option). GitHub social turns on only when
`GITHUB_APP_CLIENT_ID` + `GITHUB_APP_CLIENT_SECRET` are set.
