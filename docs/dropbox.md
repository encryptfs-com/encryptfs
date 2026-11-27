# Dropbox import setup

The optional Dropbox Chooser importer uses a public app key. It needs no encryptfs
backend, app secret, service account, or OAuth token storage.

1. Open the [Dropbox App Console](https://www.dropbox.com/developers/apps) and
   create an app suitable for the Chooser integration.
2. In that app's settings, register your **Chooser/Saver domains**, including
   `127.0.0.1`, `localhost` if used, and your production hostname. Follow the console's
   hostname format rather than entering an OAuth redirect URL.
3. Copy its public **app key** into `dist/dropbox-config.js`:

```js
export const DROPBOX_CONFIG = Object.freeze({ appKey: 'YOUR_PUBLIC_APP_KEY' });
```

Do not add an app secret, access token, or temporary download link to source files.
See Dropbox's [Chooser documentation](https://www.dropbox.com/developers/chooser).

Refresh the app. Click the Dropbox icon to load the optional Chooser library, then
click it again to open the popup from a fresh user gesture. Select multiple files;
their bytes download directly into browser memory and use the same header-based
routing as local files. Unconfigured installations show an explanatory message
without loading Dropbox or affecting local imports.

This version imports individual ordinary files and `.efs` containers. It permits
browsing Dropbox folders to select files but not importing whole directories.
Chooser's direct links support CORS and expire after four hours; the app consumes
them immediately. The app receives only selected files, not an account-wide token.
Native/cloud-only items that cannot supply downloadable file bytes are unsupported.

Download progress, cancellation, workspace byte/entry limits, expired-link messages,
and per-file retry behavior match the Drive importer. Cancelled or failed downloads
never become partial workspace files. Already completed imports remain available.
Cancelling an import ignores late Chooser callbacks; if Dropbox's own popup remains
open, close it manually. Clearing the workspace cancels the local operation and
does not sign the user out of Dropbox.

Temporary URLs are kept only in the active operation's memory. They are never put
in file rows, logs, application URLs, or browser storage. Downloads omit cookies and
referrers, accept only HTTPS Dropbox content hosts, and never pass URLs to inline
preview elements. Previews use the downloaded local bytes. The CSP allows Dropbox's
Chooser script/frame and approved content origins; provider scripts load only on
request. Like Google Picker, the loaded library shares the page's script trust
boundary. It is not a sandbox for untrusted provider code.

Automated tests mock the Chooser and download responses. They cover user-gesture
timing, cancellation, late callbacks, host validation, expired links, bounded streams,
partial failures, `.efs` byte preservation, and signed-URL error redaction. Live
account, registered-domain, CSP, popup, and mobile behavior remain to be verified
with a configured app key. No real Dropbox account was connected during development.
