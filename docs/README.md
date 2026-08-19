# These are html2canvas 1.4.1's docs, not domlens's

The files in this directory document the **classic html2canvas option surface** — `scale`,
`useCORS`, `foreignObjectRendering`, `ignoreElements` and the rest. They are kept here, largely
as upstream wrote them, for two reasons:

1. `domlens-html2canvas` still implements exactly this surface. `configuration.md` is the
   canonical list of what that package accepts, and a test in
   `packages/html2canvas-compat/src/__tests__/mapping.ts` asserts every option documented there
   is mapped onto a domlens option. Editing `configuration.md` can therefore fail a test, which
   is the intended relationship.
2. They are the reference for anyone migrating off html2canvas.

They are **not** documentation for `domlens` itself, whose API is different (grouped options, a
capture result rather than a canvas). That lives in the [root README](../README.md).

Some of these pages still carry frontmatter (`previousUrl`, `nextUrl`) from upstream's Gatsby
documentation site, which is not part of this repository.
