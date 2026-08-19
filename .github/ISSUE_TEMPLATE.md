Please make sure you are testing with the latest [release of domlens](https://github.com/mrmoeboto/domlens/releases).

# Before opening an issue

- [ ] You are on the latest [version](https://github.com/mrmoeboto/domlens/releases)
- [ ] You are testing with the non-minified bundle (`dist/domlens.js`, not `dist/domlens.min.js`) and have checked the console
- [ ] You have tried the other engine — `capture(el, {engine: 'canvas'})` if you are on the default, `{engine: 'svg'}` if you are not — and said below whether it changes anything

That last one is the single most useful thing you can tell us: domlens has two independent
renderers, and which of them reproduces a bug narrows it down enormously.

<!-- Erase any part of this template that does not apply. -->

### Bug reports

A brief summary, and if at all possible a reproduction on [jsfiddle](https://jsfiddle.net/) or
[CodePen](https://codepen.io/). A screenshot of what you got next to what you expected helps.

### Specifications

 * domlens version:
 * Package (`domlens` or `domlens-html2canvas`):
 * Engine (`auto` / `svg` / `canvas`, and whether the other one differs):
 * Browser & version:
 * Operating system:

### Migrating from html2canvas?

Say so — behavior differences between `html2canvas` and `domlens-html2canvas` are treated as
bugs in this project.
