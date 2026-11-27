# What Gemini reviewers can see from connected Gmail and Drive

Google says people review some data that consumer Gemini processes from connected apps. This guide covers the Gemini app with a personal Google Account. [Google’s Connected Apps privacy guidance](https://support.google.com/gemini/answer/16836988?hl=en-45)

## When Gemini can use your files

A connected app gives Gemini access to data from another service. The **Google Workspace** connection can give consumer Gemini access to Gmail and Drive.

Google says reviewers can see summaries or excerpts from relevant emails and files. In some cases, a reviewer can see the complete email or file. This applies to some data that Gemini processes through the connection. Storage in Drive alone does not put a file into Gemini’s review process. [Google’s description of human review](https://support.google.com/gemini/answer/16836988?hl=en-45)

![A connected app can give Gemini readable data from Gmail or Drive. Google can send some of the data that Gemini processes to human reviewers.](/guides/diagrams/gemini-human-review.svg)

Google says it takes steps to reduce personal information before service providers review interactions. Google describes exceptions for abuse or harm. Work and school accounts can have different settings and policies. [Google’s privacy guidance for connected apps](https://support.google.com/gemini/answer/16836988?hl=en-45) · [Google’s work and school guidance](https://support.google.com/gemini/answer/14959807?hl=en)

## Disconnect Gmail and Drive from consumer Gemini

1. Open [Gemini](https://gemini.google.com/) on a computer.
2. Select **Settings**.
3. Select **Personal Intelligence**.
4. Select **Connected Apps**.
5. Find **Google Workspace**.
6. Open **More options**.
7. Select **Disconnect**.

If your settings show a switch for the connection, turn it off. [Google’s instructions for Connected Apps](https://support.google.com/gemini/answer/16598406?co=GENIE.Platform%3DDesktop&hl=en)

Disconnecting an app does not remove the data already in Gemini history. Use **Settings** and **History** to find and delete past activity. Google says it can keep reviewed chats for up to three years after you delete your history. [Google’s history instructions](https://support.google.com/gemini/answer/13278892) · [Gemini Apps Privacy Hub](https://support.google.com/gemini/answer/13594961?hl=en&pass=1)

## Encrypt private files before upload

Encryption at rest protects data on storage media. A provider can still give an authorized service access to readable data. [How cloud storage encryption at rest works](/guides/cloud-storage-encryption-at-rest/)

Encryptfs creates an encrypted .efs vault in your browser. Your browser makes the vault key from your password. When you upload the vault to Drive, Google receives the encrypted file. The upload does not give Google the vault password.

1. [Encrypt the file before you upload it](/guides/encrypt-photos-videos-google-drive-icloud/).
2. Upload the .efs vault to Drive.
3. Keep the vault password separate from the upload.
4. Open the vault in encryptfs when you need to read its contents.

A vault protects the copy inside it. It does not change readable copies already in Drive, email, or Gemini history. Pasting decrypted text into Gemini or attaching a decrypted file gives Gemini a readable copy.

Drive can still see the vault’s external name, size, and upload details. Use a long password and keep a separate backup. The app cannot recover a lost vault password. [The .efs format and its limits](/efs/)
