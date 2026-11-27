# encryptfs requirements

Status: initial product requirements. This document records intended behavior;
it is not the normative `.efs` wire-format specification or a finalized cryptographic design.

## Product boundary

encryptfs is a browser application for client-side file encryption and decryption.
File bytes, passwords, keys, decrypted metadata, and previews stay client-side.
Future remote import/export integrations transfer files only at the user's direction.
Unsupported browsers receive a clear explanation when required Web Crypto or other
essential browser capabilities are unavailable.

There is no password recovery. Users who lose a password lose access to containers
protected by it unless they retain another usable copy of the original data.

## Workspace and tabs

Keep the interface minimal and focused on function: no promotional copy, decorative
footers, faux title bars, or traffic-light buttons. See `AGENTS.md`.

The responsive workspace has two keyboard-accessible tabs with filesystem-style list
rows, aligned name/status/size columns, expandable folders, and filesystem selection.

1. **Encrypt:** ordinary imported files appear in the source list. Successful
   encryption removes plaintext inputs and reveals a rename/export section beneath
   the list. Outputs leave the workspace when their download/export is requested.
2. **Decrypt:** imported `.efs` containers appear in the upper source list. Password
   entry reveals matching names there, without automatically decrypting payloads.
   The user selects desirable files and moves them by decryption into the lower results list.
   Successfully decrypted entries disappear from the upper list; folders retain only
   their remaining entries. Completed containers leave the encrypted workspace and
   release their retained source/key handle. Failed or cancelled entries stay above.
   Removing or re-encrypting a result does not resurrect its previous source entry.
   The first newly decrypted result previews automatically. Selecting a result,
   including its checkbox, or using its eye button opens an inline preview alongside it
   (below it on mobile). Results can be downloaded or moved to Encrypt to change
   their password. They remain separate from ordinary imported plaintext.

Switching application tabs preserves the workspace until the browser tab closes.
Imports route by a bounded header inspection, rather than trusting the extension.
Imports containing only one kind open its corresponding tab. Mixed imports populate
both tabs while preserving the current tab. Recognized malformed or unsupported
containers receive an explicit error rather than silently becoming plaintext.

Download removal happens after handing data to the browser. The application cannot
verify that the browser completed saving; users are told to check their downloads.
Failed export attempts retain their output for retry. Local and remote source files
are never deleted by workspace removal.

## Encryption

- Users select one or more plaintext entries and supply one password for the group.
- Default mode produces one `.efs` container per selected file.
- “Encrypt as single folder” produces one `.efs` container containing the group's
  directory structure and contents.
- Original file names are encrypted inside the container. Generated external names
  are UUID-based and end in `.efs`.
- Users may rename external output names in the export panel. Renaming an external
  container does not change its encrypted original name.
- Completion opens the rename/export panel for that group.
- Once encrypted output has been successfully produced and retained for export,
  remove the corresponding plaintext entries from the workspace and release their
  preview resources. Failed or cancelled inputs remain available for retry. Removing
  a workspace entry does not delete its original local or remote source file.
- Encryption displays best-effort progress, with honest indeterminate states where
  a browser operation cannot report incremental work.

## Unlocking and selective decryption

- When encrypted imports exist, the encrypted panel exposes a password input.
- One submitted password is checked against all imported encrypted entries.
- Matching entries reveal their original names before content decryption and move
  to the top in a clearly marked **ready to decrypt** state.
- Password matching must authenticate the encrypted metadata before displaying it.
- Nonmatching entries remain locked; a mixed-password collection is expected.
- Users select which ready entries to decrypt. Support single selection, range
  selection, select all, and accessible touch/keyboard equivalents.
- Explicit selected-file decryption takes precedence over the earlier suggestion
  to automatically decrypt every matching file.
- Decrypted results appear in the lower results pane of Decrypt with their provenance marked.
- A decrypted folder container appears as an expandable directory.
- Unlocking a folder reveals its encrypted manifest, allowing users to select,
  decrypt, and preview individual contained files without decrypting every payload.
- Decryption displays best-effort progress and clear per-entry failures.
- One failed file does not stop the rest of a batch. Users can cancel operations
  and retry failures; successful outputs remain available.

## Change password

After decryption, users can move selected results (or all results if none are
selected) to Encrypt through a change-password action, then re-encrypt with a new password. This produces new encrypted output using the normal
rename/export flow. It does not revoke, overwrite, or delete previous encrypted
copies; users are responsible for deleting those copies wherever they exist.

## Previews

The initial preview set includes plain/ASCII text, PDF, common images, and common
video formats supported by the browser. A view/eye action opens a preview. Decrypted files use the lower inline viewer;
plaintext inputs in Encrypt use a preview dialog.
Unsupported types remain downloadable and show a useful fallback.

Use an extensible detection and renderer registry, separate from the file list.
Imported MIME types and names are hints, not trusted executable instructions.
Previewing untrusted content must not allow it to execute in the application's origin.
Release preview resources when closed or when their workspace entries are removed.

Decrypted results support case-insensitive search over filenames and complete folder
paths, including root folder names. Preserve the tree and expand matching ancestors;
do not navigate into folders. Select-all applies to current search results. Show a
clear no-matches state and a way to clear the query. Search is local and ephemeral.

PDFs render to canvas with a locally bundled PDF.js worker and page controls rather
than a sandboxed native PDF iframe. Do not execute PDF actions or create annotation
links/forms. Destroy the preview worker on close/change. Broken or unsupported files
show a visible message and a download action rather than leaving a blank preview.

## Tab lifetime and privacy

The workspace is ephemeral and isolated to a tab. Closing and reopening a tab must
not restore previous files, plaintext, previews, passwords, or unlocked metadata.
Unlock access lasts for the lifetime of the tab; no idle expiry or automatic
relocking is required. Retain the key material needed for that access in memory;
retaining the entered password itself is not required.
Do not persist sensitive workspace state in browser storage, URLs, history state,
service-worker caches, or application logs. Browser restoration and back/forward
cache behavior must be covered explicitly in the lifecycle design and tests.

Release object URLs, worker references, and sensitive buffers when no longer needed.
Browser-managed memory does not offer a guarantee of physical secure erasure;
the requirement is to prevent application restoration and minimize retention.
Files explicitly downloaded/exported are outside the ephemeral workspace.

## Container format requirements

Publish a precise, normative version-one format specification before implementing
the production cryptographic writer. Include byte layout, endianness, lengths,
encoding rules, bounds, algorithm identifiers, password processing, key derivation,
nonce rules, authenticated fields, parsing errors, and interoperability test vectors.

Required capabilities:

- An unambiguous magic header and explicit format version.
- Version and feature negotiation with safe rejection of unsupported requirements.
- Encrypted, authenticated original names and metadata, including file types,
  file-versus-folder kind, directory paths, and entry counts. These are unavailable
  until the correct password unlocks the metadata.
- A bounded metadata unlock operation that verifies a password and reveals names
  without decrypting file payloads. A separate plaintext password hash is not a requirement.
- Authenticated payloads and protection against metadata/payload substitution,
  truncation, reordering, and malformed lengths.
- File and folder containers, with an encrypted manifest for folder paths and entries.
- Independently accessible file payloads inside folder containers to support
  selective decryption and preview after manifest unlock.
- Original file and aggregate collection byte sizes need not be hidden; padding
  to conceal sizes is not required. Public parsing and cryptographic parameters
  must be documented separately from encrypted user metadata. Avoid exposing
  semantic metadata through public type-specific header fields.
- A documented extension/evolution mechanism for v2 and future versions.
- Resource limits for untrusted containers, including expensive password-derivation
  settings and folder manifest/path parsing.

An offline encrypted container necessarily allows offline password guesses. “Quick
password matching” must mean checking small authenticated metadata rather than
making each password guess inexpensive. The KDF and batch-performance design
remain to be decided and reviewed.

## Architectural boundaries

- **Import sources:** normalize local upload and future Drive/OneDrive/Dropbox
  sources into the same file-intake abstraction.
- **Export destinations:** consume encrypted output groups independently of their
  source; local download is the first implementation.
- **Container codec:** bounded header inspection, version dispatch, metadata unlock,
  payload encryption/decryption, and folder manifest handling.
- **Workspace state:** file identity, provenance, selection, operation states, and
  output groups; independent of presentation and provider-specific APIs.
- **Preview registry:** content detection and safe renderers.
- **Operation execution:** scheduling, progress, errors, cancellation, and cleanup;
  keep costly work off the main UI thread where practical.

Google Drive and Dropbox import are implemented behind optional public configuration;
see `docs/google-drive.md` and `docs/dropbox.md`. Only explicit selections of ordinary files are downloaded,
with memory-only tokens/temporary links, cancellation, and bounded streaming. Other providers,
recursive folder import, native-document export, and Drive upload remain future scope.

## Acceptance coverage

Automated tests should cover format round trips and invalid/tampered inputs;
mixed-password unlocking; name visibility before selected decryption; folder trees;
origin badges; UUID output naming and export renaming; header-based import routing;
preview behavior; and unsupported-browser handling.
Also cover selective folder-entry decryption, encrypted metadata visibility,
change-password round trips, source cleanup after successful encryption, and
partial batch failures with cancellation and retry.

Automated browser tests must cover desktop and mobile layouts, touch-friendly
selection and actions, keyboard selection, progress/error states, and tab restoration
without sensitive workspace recovery. Test cancellation/resource cleanup as those
operations are implemented.

## Decisions still needed

1. Additional metadata and the subsequent use cases it must support.
2. Password policy, cryptographic suite, key derivation, and batch unlock performance.
3. Expected file sizes and collection counts, streaming/memory constraints, and
   the first supported browser matrix.
4. Folder naming, path preservation, and export behavior for decrypted directories.
5. Initial preview formats and handling of browser-dependent PDF/video support.
6. Output-group retention and detailed retry/cancellation interactions.

These decisions should be resolved in the format and architecture design rather
than silently becoming accidental implementation defaults.

## Current import and output behavior

Local import accepts individual files; there is no folder-upload control. Folder
containers and tree results remain supported. Completed encryption scrolls to
export results; completed decryption scrolls to decrypted results, respecting
reduced motion. OneDrive uses a local picker and delegated read-only Graph access;
see `onedrive.md` for registration, SDK setup, and verification limits.

## Workflow confidence and collection controls

- Export rows show the source name locally alongside the editable public filename.
- Successful download requests remove outputs from export lists, but retain an
  explicitly labeled retry copy for two minutes. Retry links can be dismissed and are cleared with all expiry timers on tab cleanup.
  Temporary ciphertext can remain on disk until workspace cleanup.
  Saving is never presented as confirmed by the app.
- Download selected and Re-encrypt selected act only on an explicit selection.
- Recent failed batches (up to five) remain in a dismissible, expandable summary.
- Unlock filenames is a separate action from Decrypt selected. The interface shows
  unlocked file and locked container counts, and password checks show batch progress.
- Search unlocked names and full folder paths; sort ascending/descending by name.
  Select-all and folder selection respect the current filter and canonical indices.
  Locked names cannot be searched. Decrypting new files resets the results search.
- Decrypt tab counts include encrypted containers and decrypted files; count
  tooltips describe the breakdown. Mobile row actions have 44px targets, larger
  supporting text, and a sticky selection action bar.
- Unconfigured providers remain visible with setup tooltips on localhost and
  loopback development hosts. Production hosts show configured providers only.
- Remove the Local processing header indicator and workspace privacy footer.


## File-to-vault explanation

Show a compact photos/videos/documents → .efs vaults diagram in Encrypt. Reverse
its visual and reading order in Decrypt. The vault links to `/efs` in a new tab.
The guide uses ASD-STE100-style technical English and responsive HTML/CSS diagrams.
Explain the public header, encrypted manifest, chunk layout, key derivation,
authentication checks, versioning, and security limits. Keep the public full
specification synchronized with the canonical file. Do not load app or provider
scripts on the guide page.


## Large files and discovery audit fixes

Remove the 256 MiB file/workspace cap. Keep safe-integer, manifest, and entry-count
validation. Stream crypto into backpressure-aware sinks. Stage only ciphertext in
origin-private storage; hold a Web Lock for each tab and remove abandoned sessions.
Keep decrypted results in the tab as browser-managed Blobs. The app does not
write decrypted output to a folder. Blob output remains subject to browser limits.

Percentages count content bytes across the batch, not files or time. Label key
derivation and output finalization separately. Export rows show a green success
check. Use native checkboxes inside labeled groups, rather than invalid listboxes.
Serve real robots.txt, llms.txt, ai-catalog.json, and its .well-known alias. Include
404.html to stop Cloudflare's automatic app-HTML fallback for missing resources.

Discovery formats follow [llms.txt](https://llmstxt.org/) and the
[ARD catalog schema](https://github.com/ards-project/ard-spec/blob/main/spec/schemas/ai-catalog.schema.json).
The catalog advertises documentation, not a server encryption API.
