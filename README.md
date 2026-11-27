# encryptfs

A client-side browser workspace for encrypting, selectively decrypting, and
previewing files. No application server, encryptfs accounts, analytics, or automatic file uploads.
Optional Google Drive and Dropbox importers download selected files directly into the browser. File data and unlocked keys live only in the current tab.

## Run

Requires Node.js 22+ (development and tests only):

```sh
npm start
```

Open `http://127.0.0.1:4173`. Deploy the contents of `dist/` to a static HTTPS host.
Web Crypto requires HTTPS or localhost; opening `index.html` as a local file is not
supported. No build or dependency installation is needed. PDF.js and its worker/font assets
are vendored in `dist/vendor/pdfjs/` and served locally.

Use **Extract ZIP** on an imported or decrypted ZIP to add its contents to the
current file list. Extraction runs locally using zip.js 2.8.55, bundled under
`dist/vendor/zipjs/`. Password-protected ZIP archives are unsupported.

If browser storage fails, **Retry to a folder…** can stream the encrypted output
into a folder you choose. The app offers this retry when the browser supports
folder access. It writes only encrypted .efs files to that folder. If the browser loses
access to a local input during encryption, use the same codec from a terminal:

```sh
node scripts/encrypt-file.mjs /path/to/input /path/to/output.efs
```

The command prompts for a password and verifies that the saved vault can be
unlocked. It refuses to replace an existing output.

On a Mac with ChatGPT installed but no Node on `PATH`, the bundled runtime can
also start this server:

```sh
"/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node" scripts/serve.mjs
```

## Use

1. Add files. Header inspection routes `.efs` containers into
   the Decrypt tab regardless of their extension. Ordinary files appear in Encrypt.
2. Select plaintext files, enter and confirm a password, and encrypt separately or
   as one folder. Successful inputs leave the workspace; originals on disk remain.
3. Rename the generated UUID `.efs` names and export the output group. Exported
   outputs leave the workspace after the browser download is requested.
4. Import encrypted containers and enter a password. Matching names appear first;
   select only the entries you want to decrypt in the upper list. Folder contents
   are independently selectable. Successful entries move from the upper list to the
   lower results list; completed containers leave the workspace. Failed or cancelled
   entries stay above. Results remain separate from Encrypt inputs.
5. Select a decrypted result or use its eye button for inline text, PDF, image, or
   video previews in the lower viewer. The first new result previews automatically.
   PDFs render locally to canvas with page controls. Encrypt inputs use a preview dialog.
   Search decrypted filenames and folder paths without leaving the expanded tree. Video
   support depends on browser codecs.
6. Change a password by moving selected decrypted results to Encrypt and re-encrypting. Old copies
   still use their old password; deleting those copies is your responsibility.

Click selects one file; Shift selects a range; Ctrl/Cmd-click toggles selection.
Checkboxes support touch selection. Arrow keys move focus; Space toggles; Ctrl/Cmd+A
selects all within a file list.

## Tests

```sh
npm test
npm run check
```

With the development server running, open
`http://127.0.0.1:4173/tests/browser.html`. The automated browser harness exercises
the real workspace and crypto worker in 1280px, 390px, and 320px frames, including
imports, mixed passwords, metadata privacy, selection, folder decryption, inline
image decoding, canvas PDF rendering/page navigation, failed-preview fallbacks,
folder search, tab navigation, output naming, renaming, export removal, provenance,
and reload cleanup.
All fixtures are synthetic. Results appear on the page and on the root element as
`data-test-status="passed"` or `"failed"`. Test pages are outside the deployment
directory and are never shipped with the application.

The Node PDF rasterization test uses optional `@napi-rs/canvas` when installed;
otherwise it is explicitly skipped. Browser tests render PDFs without that package.

## Structure

- `dist/app.js`: ephemeral workspace, selection, operations, and rendering.
- `dist/crypto-worker.js`: password/key lifetime and cancellable crypto execution.
- `dist/lib/format.js`: bounded version-one codec with authenticated 1 MiB chunks.
- `dist/lib/transfers.js`: provider interfaces; local import/download adapters first.
- `dist/lib/previews.js`: extensible content detection and preview registry.
- `dist/lib/pdf-preview.js`: local canvas PDF renderer with cancellation and page controls.
- `dist/lib/file-search.js`: case-insensitive filename and folder-path filtering.
- `dist/lib/google-drive.js`: optional Picker, memory-only authorization, and bounded downloads.
- `dist/drive-config.js`: public Google configuration (empty until configured).
- `dist/lib/dropbox.js`: optional Chooser and bounded temporary-link downloads.
- `dist/dropbox-config.js`: public Dropbox Chooser app key (empty until configured).
- `AGENTS.md`: minimal, functional UI guidance; no marketing or faux window chrome.
- `docs/requirements.md`: product decisions and remaining design scope.
- `docs/format-v1.md`: normative wire format and evolution rules.
- `tests/vectors.json`: interoperability fixture, also checked with Node crypto.

## Limits and security status

There is no fixed 256 MiB file or workspace cap. Crypto uses 1 MiB content chunks
and awaits output writes. Supported browsers stage encrypted output in an
origin-private temporary directory. If storage fails, users can opt in to save
encrypted output to a folder. Files saved there remain after the tab closes.
Without temporary storage, encrypted output uses browser-managed Blobs.
Browser memory and storage limits still apply.
The 10,000-entry and 4 MiB manifest bounds remain, with safe integer checks on sizes.

Progress counts content bytes, not elapsed time. Password derivation and output
commit have separate phases. The percentage is not a remaining-time estimate.
Large PDF previews are limited to protect the viewer; file processing has no such
preview limit. Temporary ciphertext is removed on workspace cleanup when possible;
Web Locks protect active tabs during stale-file cleanup on later visits.

Current browsers with Web Crypto, module workers, dialogs, and modern JavaScript
are required; unsupported environments receive an explanatory message. Automated
browser tests are intended for Chromium, Firefox, and WebKit; a verified release
browser/version support matrix is still pending.

Names, types, directory structure, counts, timestamps, and contents are encrypted.
Header parameters, ciphertext sizes, and metadata length are public. Password
matching authenticates metadata, not every payload. Each container uses independent
password derivation, so large batches take time; the UI reports progress and permits
cancellation between non-interruptible Web Crypto calls.

There is no password recovery. Nothing sensitive is intentionally written to browser
storage. Page lifecycle handlers discard workspace state and terminate the key-holding
worker; reloading and back/forward restoration start empty. Browsers cannot guarantee
physical memory erasure, and downloads persist outside this workspace.

This is an initial implementation, not an independently audited cryptographic product.
The browser, delivered code, extensions, and operating system are trust boundaries.
PDF previews use locally vendored PDF.js 5.4.624 (Apache-2.0), with scripting, XFA,
dynamic evaluation, and WebAssembly disabled. Only canvas output is displayed;
PDF preview workers are destroyed when the preview closes or changes.
Google Drive and Dropbox import are optional and need public configuration; see
[Google Drive setup](docs/google-drive.md) and [Dropbox setup](docs/dropbox.md).
Other providers, cloud export, and offline
installation remain future work.

OneDrive import setup: [docs/onedrive.md](docs/onedrive.md). Run `npm install`
and `npm run setup:onedrive` to build the optional authentication assets, then
configure the public Microsoft application ID. Local imports work without them.


Workflow notes: export rows identify their original source locally. Requested
exports leave the list, with a dismissible two-minute retry copy that counts
against the workspace budget. Decrypted batch actions require a selection;
unlocked filenames can be searched and sorted before decryption. Recent failures
remain available in expandable details. Unconfigured cloud icons remain visible
on localhost/loopback for development and are hidden on production hosts.

The workspace diagram links to `/efs`, a static format and security guide. The link
opens in a separate tab to preserve the workspace. The guide uses short technical
English, responsive diagrams, and a public copy of `docs/format-v1.md`.


## Add a guide

Guides are static pages under `/guides/<slug>/`. Add a record to
`content/guides/index.json` with a unique slug, title, description, publication date,
and optional category. Add `content/guides/<slug>.md` with the same H1 title.
Run `npm run build` before deploying `dist`.

The guide renderer supports headings, paragraphs, lists, bold text, inline code,
links, and single-line blockquotes. It escapes HTML and rejects unsafe link schemes.
The build updates the guide index, article HTML, Markdown copies, and llms.txt.
Provider instructions should link to current official documentation.
