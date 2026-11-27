# OneDrive import

OneDrive uses a locally bundled Microsoft Authentication Library (MSAL), popup
sign-in with PKCE, and Microsoft Graph's delegated `Files.Read` permission.
The local picker browses your OneDrive folders and selects individual files,
including multiple files across folders. Whole folders, SharePoint libraries,
shared-item shortcuts, and export back to OneDrive are not supported yet.
Imported bytes go through the same header detection as local files.

## Installation

1. Run `npm install` followed by `npm run setup:onedrive` in the project root.
   This builds the pinned MSAL package and its redirect bridge into
   `dist/vendor/msal`. These assets must be included when deploying `dist`.
2. In the Microsoft Entra admin center, create an app registration. For personal
   and business accounts, choose accounts in any organizational directory and
   personal Microsoft accounts. Tenant policy can restrict registration/consent.
3. Add a **Single-page application** platform with the exact redirect address
   `http://localhost:4173/onedrive-redirect.html` (or your actual origin and path).
   If you serve on `127.0.0.1`, register that exact address instead.
   Add the HTTPS production address separately. Do not enable implicit grants,
   create a client secret, or use the Web platform type.
4. Add Microsoft Graph **delegated** permission `Files.Read`.
5. Put the application's public Application (client) ID in
   `dist/onedrive-config.js`. Restart/refresh the app.

Click the OneDrive icon once to initialize the local SDK, then again to sign in.
Choose files using checkboxes and press Import. Folder buttons expand the picker
into that folder; Back returns to its parent. Load more handles paged folders.

Tokens and selected download links are held in memory. Clear workspace discards
app credentials and closes the file picker; it does not sign you out of Microsoft.
Microsoft sign-in can retain its own account session independently. Workspace
cancellation ignores late sign-in results; close any remaining Microsoft popup.
The app never sends encryption passwords or keys to this adapter. `Files.Read`
allows reading the signed-in user's files, rather than granting access only to
individual files selected in our picker. No write permission is requested.

Downloads use Microsoft's temporary preauthenticated URLs without bearer headers,
cookies, or referrers. URLs are restricted to Microsoft content hosts and are
never persisted or displayed. Redirects are rejected. Network errors are sanitized.
Expired links can be refreshed by selecting the files again. The SDK shares the
page's trust boundary, as do the other provider SDKs.

## Verification still required

Automated tests mock MSAL and Graph. Before shipping, build the real SDK and verify
personal and business account sign-in, popup cancellation, multi-folder selection,
pagination, expired links, interrupted downloads, .efs routing, and mobile layout.
The development environment could not download npm packages or run a live browser,
so real Microsoft account authentication has not been verified here.

References: [MSAL redirect bridge](https://learn.microsoft.com/en-us/entra/msal/javascript/browser/redirect-bridge),
[MSAL caching](https://learn.microsoft.com/en-us/entra/msal/javascript/browser/caching),
[Graph downloads and browser CORS](https://learn.microsoft.com/en-us/graph/api/driveitem-get-content?view=graph-rest-1.0).
