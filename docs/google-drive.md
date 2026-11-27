# Google Drive import setup

The importer is implemented but inactive until the installation has public Google
configuration. No backend, service account, or client secret is used.

## Create the Google configuration

1. Create a project in [Google Cloud Console](https://console.cloud.google.com/).
2. Enable **Google Drive API** and **Google Picker API** for that project.
3. Configure the OAuth consent screen in **Google Auth platform**. For personal
   development, keep the app in Testing and add your Google account as a test user.
4. Create an OAuth client with application type **Web application**. Add authorized
   JavaScript origins for the exact app origins you use, for example:
   - `http://127.0.0.1:4173`
   - `http://localhost:4173` (if you also use that hostname)
   - Your eventual production HTTPS origin.
   Origins contain no path. This browser token flow needs no redirect endpoint.
5. Create an API key. Restrict it to the **Google Picker API** and **Google Drive API**.
   Apply website/referrer restrictions for the app hosts, such as
   `http://127.0.0.1:4173/*` and your production host. Google's current Picker setup
   instructions also require `https://docs.google.com/*` because Picker runs in
   a Google-hosted iframe.
6. Copy the project's numeric **project number** from its project settings.
7. Fill in `dist/drive-config.js`:

```js
export const GOOGLE_DRIVE_CONFIG = Object.freeze({
  clientId: 'YOUR_WEB_CLIENT_ID.apps.googleusercontent.com',
  apiKey: 'YOUR_RESTRICTED_BROWSER_API_KEY',
  appId: 'YOUR_NUMERIC_PROJECT_NUMBER'
});
```

These values are public browser configuration. **Do not add a client secret,
service-account key, access token, or refresh token to this file.** For a public
release, complete Google's applicable consent/verification and publishing steps.

See Google's [Picker integration guide](https://developers.google.com/workspace/drive/picker/guides/web-picker)
and [browser token-model guide](https://developers.google.com/identity/oauth2/web/guides/use-token-model).

## Use

Refresh the app. Click the **Google Drive icon** to load the optional Google libraries, then
click the icon again to authorize and choose files. The second click
ensures the authorization popup starts directly inside a user gesture rather than
after asynchronous script loading. Later imports reuse an unexpired in-memory token.

Select multiple ordinary files or `.efs` containers. Selected files download directly
from Google into browser memory and enter the existing header-inspection pipeline.
The appropriate Encrypt/Decrypt tab opens for a single-kind import; mixed imports
preserve the current tab. Progress, cancellation, per-file errors, and workspace
size limits apply. No files are sent to an encryptfs server or written back to Drive.

Google Docs, Sheets, Slides, shortcuts, and recursive folder import are not included
in this first integration. Export native Google documents to ordinary files first.
You can browse folders in Picker to select individual files. A download-disabled
file fails with a useful message while other selected files continue.

## Privacy and permissions

The requested scope is only `https://www.googleapis.com/auth/drive.file`, scoped
to files explicitly opened/shared with this app. This scope also permits modifying
those files, although this importer only makes read requests. It does not request
permission to list or read the user's entire Drive.

Tokens remain in private adapter fields and are cleared on Disconnect Drive,
Clear workspace, reload, or browser tab lifecycle cleanup. Disconnecting locally
does not sign the user out of Google or revoke existing account consent. Expired
tokens require another explicit user interaction; there are no refresh tokens.
Tokens travel only in Authorization headers to the fixed Drive API endpoint,
never in app URLs, logs, or browser storage. The adapter does not receive encryption
passwords or keys.

The Google authentication/Picker libraries are external scripts, loaded only after
an explicit request. Once loaded, they share the application's JavaScript trust
boundary; the module separation does not sandbox them from the page. Encryption
keys remain in the crypto worker, but trusted delivered code remains part of the
security model. An independent integration origin would be a separate future design.

The CSP permits the required Google script, connection, and frame origins, and
inline styling for the provider's picker UI. It does not enable inline scripts or
`unsafe-eval`. File decoding, encryption, decryption, and previews remain local.

## Verification

Unit tests use mocked Google authorization, picker, and Drive responses. They cover
popup activation timing, token expiry/cleanup, cancellation, denied permissions,
resource keys, `.efs` byte preservation, bounded streamed downloads, and partial
failures. The real account flow must still be tested with configured credentials,
including consent, referrer restrictions, CSP, shared-drive files, and mobile popups.
No real account connection was tested during implementation.

If the button reports an unavailable installation, check the three public config
values. For an invalid developer key, recheck API enablement, the API-key restrictions,
the `docs.google.com` referrer entry, and the project number. For `origin_mismatch`,
make sure the exact hostname and port are in the OAuth client's authorized origins.
