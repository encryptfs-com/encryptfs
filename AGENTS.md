# encryptfs project guidance

## Product interface

- Keep the UI minimal and focused on file operations. Use deliberate typography,
  spacing, contrast, and a restrained blue accent; avoid tiny, low-contrast functional text.
- Use a dark charcoal theme with white/gray text and blue controls/selection, inspired
  by professional tools such as Figma. Keep actual document/image preview colors intact.
- Use fully rounded buttons and straight-edged workspace panes/fields; avoid generic
  small-radius rounding across every component.
- Do not add marketing copy, taglines, promotional footers, or decorative filler.
- Avoid imitating desktop window chrome, including traffic-light buttons and faux title bars.
- Add text when it explains an action, state, error, limitation, or necessary security decision.
- Prefer concise functional labels and filesystem-style file lists with accessible controls.
- Preserve responsive layouts and keyboard, checkbox, and range selection.
- Search decrypted filenames and folder paths in place; keep matching folders expanded
  as a tree rather than navigating into folders.

## Privacy and verification

- Keep file processing and previewing client-side. Never stage plaintext or keys in browser storage. Large encrypted outputs may use temporary disk storage; plaintext disk writes require a user-selected output folder.
- Cloud provider libraries load only on request. Keep Dropbox signed download links
  ephemeral and out of logs, application URLs, and browser storage.
- Google Drive libraries load only on request. Keep tokens in memory, request only
  `drive.file`, and never pass encryption passwords or keys to provider adapters.
- Give icon-only actions accessible names. Clear workspace uses a one-second hover
  tooltip, supports focus/Escape, and retains its existing confirmation.
- Keep public provider configuration separate from implementation; never add client secrets.
- Keep the `.efs` specification in sync with codec changes; see `docs/format-v1.md`.
- Verify functional changes with relevant tests. Distinguish passing automated checks
  from browser behavior that could not be verified in the current environment.
- OneDrive uses locally bundled MSAL with memory-only caching, popup authentication,
  and delegated `Files.Read`. Keep the redirect bridge local, provider endpoints
  restricted, and download URLs ephemeral. See `docs/onedrive.md`.
- Local import selects files only; do not restore a folder-upload control.
- Successful encryption/decryption should reveal their lower output panel and
  respect reduced-motion preferences.
- Routine status/error messages use ephemeral bottom-right toasts, never banners
  that shift the workspace. Pause dismissal while hovered or keyboard-focused.
- Keep original-to-output name mappings visible locally during export; never write
  original names into plaintext container metadata.
- Download requests leave the export list, with retry copies for
  two minutes. Clear retry references and timers with the tab workspace.
- Decrypted batch actions require an explicit selection and show its count.
- Keep failure details available in an expandable summary after toasts disappear.
- Unlocked-file search includes folder paths and preserves original crypto indices.
- Show unconfigured cloud providers on localhost/loopback for development; hide
  them on production hosts. Configured providers are always available.
- Keep privacy/status promotional chrome out of the workspace header and footer;
  explanatory material belongs in Help and the future landing page.
- The file-to-vault diagram reverses with the active tab. Its /efs guide link
  opens in a separate tab so reading it does not destroy an active workspace.
- Write the /efs guide in ASD-STE100 style: short, active sentences, consistent
  terms, and defined technical names. Keep descriptive sentences within 25 words.
  Explain security limits alongside protections; do not imply algorithm standards
  certify the custom format or implementation.
- Keep dist/efs/format-v1.md identical to docs/format-v1.md when updating the spec.
- Do not restore a fixed file/workspace byte cap. Keep safe integer and metadata
  bounds. Stream crypto into sinks with backpressure; use temporary ciphertext
  storage and explicit user-selected plaintext output folders when supported.
- Percentages count content bytes, not time. Label key derivation/final disk writes.
- Native checkboxes in groups support selection; do not restore listbox/option
  roles around folder disclosures, action buttons, or empty-state prose.
- Keep robots.txt, llms.txt, and both ai-catalog.json paths as real static files.
  Preserve 404.html so missing resources do not return the app's HTML on Pages.
- Content marketing articles belong under /guides, separate from workspace copy.
  Keep article instructions in simple technical English. Use exact UI labels,
  verify provider instructions, cite official sources, and distinguish iCloud Drive
  from iCloud Photos. Do not imply encrypted vaults keep cloud photo features.
- Add guide metadata to content/guides/index.json and body text to its slug.md.
  Run npm run build to update generated HTML, Markdown, and llms.txt links.
