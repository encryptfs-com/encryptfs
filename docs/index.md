---
title: Why encryptfs exists
---

# Why encryptfs exists

Cloud storage helps you keep and share files. Providers usually encrypt files at rest. Their authorized services can still read files to provide features such as search or AI assistance.

Access can also come from an attacker or from people who review data:

- In 2023, an attacker used a Microsoft signing key to get access to Exchange Online mailboxes. This incident affected email. [U.S. Cyber Safety Review Board report](https://www.cisa.gov/sites/default/files/2024-04/CSRB_Review_of_the_Summer_2023_MEO_Intrusion_Final_508c.pdf)
- Dropbox says a small number of staff can read file contents for specific tasks. These include technical work, legal requirements, and policy enforcement. [Dropbox file access policy](https://help.dropbox.com/security/file-access)
- Google says human reviewers can see some data that consumer Gemini processes from connected apps. This can include excerpts or complete emails and files. [Google Connected Apps privacy guidance](https://support.google.com/gemini/answer/16836988?hl=en-45)

## Encrypt before you upload

encryptfs makes a password-protected `.efs` file on your device. The cloud service receives the encrypted copy when you upload it. Keep the password separate. Use encryptfs to decrypt and view supported files in your browser.

The service can still see the external vault name and size. Readable copies elsewhere stay readable. There is no password recovery. The format and app still need an independent security review.

- [Open encryptfs](https://encryptfs.com/)
- [Read the .efs format specification](./specification/)
- [Read the guides](https://encryptfs.com/guides/)
