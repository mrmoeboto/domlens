A similar PR may already be open — please search the [pull requests](https://github.com/mrmoeboto/domlens/pulls) first.

Before opening, run `npm test` locally (lint, typecheck, unit tests and reference tests).

**Summary**

<!-- What does this change and why? -->

**Motivation**

<!-- What existing problem does this solve? -->

**Test plan (required)**

For most rendering changes, adding an html/css template to the [reftests](https://github.com/mrmoeboto/domlens/tree/main/tests/reftests)
is enough — see the existing ones for reference. Note which engines you ran:

- [ ] `npm run unittest`
- [ ] `npx playwright test --project=chromium`
- [ ] `npx playwright test --project=firefox`
- [ ] `ENGINE=svg npx playwright test` (the SVG engine's own suite)

**Rendering changes**

If this changes output pixels, say so explicitly and update the affected baselines in the same
commit. Baselines under `tests/playwright/baselines/` are a contract — regenerating them wholesale
to make a suite pass will be rejected.

**Code formatting**

`npm run format` formats to the project style.

**Closing issues**

<!-- Put `closes #XXXX` here to auto-close the issue this fixes. -->
Fixes #
