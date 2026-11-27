# PDF.js

Vendored `pdfjs-dist` version **5.4.624**, from the installed local distribution.
Upstream: https://github.com/mozilla/pdf.js
License: Apache-2.0; see `LICENSE` and the font license files in `standard_fonts/`.

`pdf.js` and `pdf.worker.js` are the matching upstream minified legacy build files (with compatibility polyfills),
renamed from `pdf.min.mjs` and `pdf.worker.min.mjs`. CMaps and standard fonts are
unmodified upstream assets. The application loads these locally, without a CDN.

PDF previews render only canvas pixels. PDF JavaScript, XFA, annotation actions,
and dynamic code evaluation are not enabled. WebAssembly decoding is disabled.
