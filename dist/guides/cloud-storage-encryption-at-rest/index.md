# What cloud storage encryption at rest protects

Encryption at rest protects data while a system stores it. Google Drive and Dropbox encrypt files on their storage systems. [Google Drive documentation](https://support.google.com/drive/answer/10519333?hl=en-AU). [Dropbox storage documentation](https://help.dropbox.com/security/physical-location-data-storage).

## Who can use the keys?

An encryption key is a value that a system uses to encrypt or decrypt data. With provider-managed encryption, the provider controls the keys or the service that uses them.

A stolen copy of storage can still be encrypted. An attacker does not automatically get the keys with that copy.

If an attacker gains access to an authorized account or service, that account or service can give the attacker readable data. The attacker can get this access without a copy of the encryption keys.

Google Drive offers a separate client-side encryption feature for eligible work or school accounts. Dropbox also offers end-to-end encryption for eligible team folders. [Google Drive client-side encryption](https://support.google.com/drive/answer/10519333?hl=en-AU). [Dropbox encrypted team folders](https://help.dropbox.com/security/encrypted-team-folders).

![With provider-managed encryption, the provider can decrypt stored data. With an .efs vault, your browser makes the key from your password and the provider receives the vault.](/guides/diagrams/cloud-encryption.svg)

## What providers and investigators reported

- **Dropbox personnel access.** Dropbox says a small number of personnel can access standard file contents in limited cases. These cases include legal requirements, technical work, and policy enforcement. [Dropbox file access policy](https://help.dropbox.com/security/file-access).
- **Dropbox sign-in error, 2011.** Dropbox reported a software error that let some people sign in without the correct account password. The report does not describe loss of storage keys. [Dropbox incident report](https://blog.dropbox.com/topics/company/yesterdays-authentication-bug).
- **Microsoft Hotmail access, 2012.** Microsoft said its investigators read a user's Hotmail content during an investigation. In 2014, Microsoft announced a change to its policy for similar cases. This case involved email. [Microsoft account of the investigation](https://blogs.microsoft.com/on-the-issues/2014/03/28/were-listening-additional-steps-to-protect-your-privacy/).
- **Microsoft Exchange Online intrusion, 2023.** An attacker used a Microsoft signing key to gain access to mailboxes. A signing key can let a service verify a sign-in token. This incident involved email and sign-in controls. [Cyber Safety Review Board report](https://www.cisa.gov/sites/default/files/2024-04/CSRB_Review_of_the_Summer_2023_MEO_Intrusion_Final_508c.pdf).

For an example of authorized app access, see [what Gemini reviewers can see from connected Gmail and Drive](/guides/gemini-connected-apps-human-review/).

## Encrypt the file before upload

Client-side encryption means that your device encrypts the file before you send it to another system.

Encryptfs creates an .efs vault in your browser. It uses your password to make a key. The cloud provider receives the encrypted vault when you upload it.

1. [Open encryptfs](/).
2. Add the files that you want to protect.
3. Encrypt them with a long password that you use only for these vaults.
4. Upload the .efs vaults to your cloud storage.
5. Keep the password in a password manager.
6. Download one vault and test that you can open it.

For the full procedure, see [how to encrypt files before upload](/guides/encrypt-photos-videos-google-drive-icloud/).

## What an .efs vault protects

The vault encrypts the original names and file contents. The provider can still see the vault name, its size, and information about the upload.

Someone who obtains a vault can try passwords on their own device. Use a long password that is difficult to guess.

A vault cannot protect files on a device that an attacker controls. An attacker who can change the app can capture your password.

The app cannot recover a lost vault password. Keep a separate backup to protect against deletion or loss.

Read the [format and security guide](/efs/) for more information. The format and implementation still need an independent security review.
