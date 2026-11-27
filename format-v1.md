# encryptfs container format v1.0

Status: implemented first-version specification; pending independent security review.
File extension: `.efs`. Media type: `application/octet-stream`.
All integers are unsigned and big-endian. Byte offsets are zero-based. Writers MUST
emit the layout below. Readers MUST reject unsupported versions, suites, flags,
nonzero reserved bytes, malformed manifests, and invalid authentication tags.

## Header (64 bytes, public)

| Offset | Bytes | Meaning |
| --- | --- | --- |
| 0 | 8 | Magic: hex `45 46 53 00 0d 0a 1a 0a` |
| 8 | 2 | Major version: 1 |
| 10 | 2 | Minor version: 0 |
| 12 | 2 | Cryptographic suite: 1 |
| 14 | 2 | Required feature flags: 0 |
| 16 | 4 | PBKDF2 iteration count: 600000 |
| 20 | 4 | Plaintext payload chunk size: 1048576 |
| 24 | 16 | Cryptographically random password-derivation salt |
| 40 | 16 | Cryptographically random container identifier |
| 56 | 4 | Manifest ciphertext byte length, including its 16-byte tag |
| 60 | 4 | Reserved: 0 |

The header reveals format parameters and manifest length. Total container size and
approximate content sizes are visible; no padding is required. File/folder kind,
names, MIME types, paths, entry counts, and timestamps are encrypted. Manifest size
can still permit inferences about complexity. Renamed external filenames can leak
whatever a user chooses to put in them.

## Suite 1

Encode the password as UTF-8, with no trimming or Unicode normalization. Passwords
are case-sensitive; empty passwords and unpaired UTF-16 surrogates are rejected.
The implementation limits the encoded password to 1024 bytes.
Derive one non-extractable AES-256-GCM key using PBKDF2-HMAC-SHA-256, the header's
16-byte salt and exactly 600000 iterations. Every container has a fresh random salt
and identifier, including files encrypted together. There is no public password
verifier and no persistent key cache.

Each AEAD record uses a 128-bit tag. Its 12-byte IV is four zero bytes followed by
the record ordinal encoded as a big-endian uint64. Its authenticated additional
data is the exact 64-byte header followed by that same eight-byte ordinal.
Ordinal 0 is the manifest. Payload ordinals start at 1 and increase through all
chunks in manifest entry order. Never reuse a key/salt for a new encryption attempt.
Payload contents and ciphertexts are not modified in place for password changes.

The manifest follows the header; ciphertext includes the appended GCM tag as
returned by Web Crypto. Authenticating/decrypting only this record verifies a
candidate password and reveals names. Failure means incorrect password OR damaged
metadata; the UI must not pretend it can distinguish them. Matching a manifest does
not guarantee that unexamined payload bytes are intact.

## Encrypted manifest

The plaintext is a UTF-8 JSON object (no byte-order mark):

```json
{
  "kind": "folder",
  "name": "Vacation",
  "entries": [
    {"path": "photos/beach.jpg", "size": 12345, "type": "image/jpeg", "lastModified": 1700000000000}
  ]
}
```

`kind` is `file` or `folder`. `name` is a nonempty single safe path component.
`entries` is a nonempty ordered array. Each entry has `path` (relative slash-separated
path), `size` (nonnegative safe integer), `type` (MIME hint string, at most 255 UTF-8
bytes), and `lastModified` (nonnegative safe integer milliseconds since Unix epoch).
Paths reject empty, `.` and `..` components, backslashes, NUL/control characters,
Windows-reserved punctuation, and leading/trailing component whitespace or dots.
Components are limited to 255 UTF-8 bytes; paths to 4096 bytes. Exact duplicates
and file/directory collisions are rejected. Case sensitivity is preserved; export
adapters must handle destination-specific collisions rather than overwrite files.
For `file`, exactly one entry exists, with `path` equal to `name`.
Empty directories and empty folder containers are not represented in v1.

Entry count is limited to 10000. Manifest plaintext is limited to 4 MiB; ciphertext
length must be between 18 and 4194320 bytes. JSON field order and whitespace are not
significant. Unknown manifest fields may be ignored; no security-critical behavior
may rely on an ignored field. Duplicate-key JSON is not emitted by this writer;
readers use their JSON parser's last-key semantics and validate the resulting object.

## Payload layout and selective access

Payload records follow the manifest without padding or record headers. For each
entry, split plaintext into 1 MiB chunks, with a shorter final chunk as necessary.
Even a zero-byte file has one chunk (a tag-only record). Each record has plaintext
length plus 16 bytes. Calculate record offsets and ordinals from authenticated
manifest entry sizes and the fixed chunk size. The total calculated container size
MUST exactly equal the actual size: reject truncation and appended bytes.

A reader can seek directly to an entry's records after unlocking the manifest.
Authenticate every selected record before returning that file. Never release a
partially authenticated file as a completed result. Offsets, ordinal AAD, and the
authenticated manifest bind chunks to their container, entry, and position.

## Limits and evolution

This browser implementation accepts at most 256 MiB of plaintext per container
and caps retained file data in the workspace at 256 MiB. These are implementation
memory limits, not a claim of streaming-to-disk support. Header inspection rejects
containers larger than the implementation's bounded maximum before password work.
Only the exact suite settings above are accepted, so attacker-selected KDF counts
cannot request unbounded work. All arithmetic must stay within safe integer limits.

Readers reject any unknown major/minor version, suite, or feature bit. A future
specification may define compatible manifest fields; a change to algorithms,
record layout, mandatory semantics, or header layout requires a new version/suite.
Dispatch by version; do not reinterpret an unsupported version as plaintext.

## Security scope and references

No password recovery exists. An offline container permits offline password guessing.
Independent per-container salts prevent a public shared batch identifier but require
one password derivation per container during a batch unlock. Unlock progress is
shown; password checks are deliberately not made cheap.

File encryption and decryption run in the browser. PDF previews use locally bundled
PDF.js. Optional Google Drive and Dropbox imports load provider scripts on request;
OneDrive uses a locally bundled authentication library. Imports download selected
files into the browser. Provider adapters do not receive encryption passwords or
keys. Users still trust all delivered application code, provider scripts loaded in
the page, and their browser.
The format and implementation require independent review before high-risk use.

Algorithm semantics follow [Web Cryptography AES-GCM and PBKDF2](https://www.w3.org/TR/2017/REC-WebCryptoAPI-20170126/).
The work factor follows the [OWASP PBKDF2-HMAC-SHA-256 guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).
Reproducible interoperability vectors live in `tests/vectors.json`; tests include
empty content, multiple chunks, tampering, invalid manifests, and selective access.
