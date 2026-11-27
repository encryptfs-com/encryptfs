# How to encrypt photos and videos before uploading to Google Drive or iCloud

Encrypt your photos and videos on your device before you upload them. Then store the encrypted files in Google Drive or iCloud Drive.

With encryptfs, each encrypted file has the `.efs` extension. You need its password to read the original names and contents.

> Use **iCloud Drive** for .efs files. Do not use iCloud Photos to store encrypted vaults as photos or videos.

![Encrypt the originals on your device. Then upload the .efs vault to cloud storage. Keep your password separate.](/guides/diagrams/vault-upload.svg)

## What you need

- The original photo and video files on your device.
- A browser that supports encryptfs.
- Enough free space for the encrypted copies.
- A Google Drive or iCloud Drive account with enough storage.
- A long password that you do not use elsewhere.

If your media is in a photo library, export the original files first. Keep a separate copy while you test this process.

**There is no password recovery.** Store the password in a password manager. Keep it separate from the encrypted files.

## 1. Encrypt the files in your browser

1. [Open encryptfs](/).
2. Select the **Encrypt** tab.
3. Select **Add files**.
4. Choose the photos and videos that you want to protect.
5. Select the checkboxes for those files.
6. Enter a password.
7. Enter the same password in **Confirm password**.
8. Select **Encrypt selected**.
9. Wait for the encrypted files to appear below.

By default, encryptfs creates one .efs vault for each selected file.

For one vault that contains the whole selection, select **place in one .efs folder** before encryption. Enter a folder name.

The progress bar counts file bytes. Password checks and final disk writes take additional time. The percentage is not a time estimate.

## 2. Download the encrypted copies

If the browser cannot store the encrypted output, encryptfs may offer **Retry to a folder…**. Enter the password again. Then select **Retry to a folder…** and choose a folder with enough free space. Encryptfs saves only the .efs vaults there. Use those vaults in the upload steps.

1. Find the output in **Save encrypted files**.
2. Check the source name beside each output filename.
3. Use the random name or enter a new name.
4. Select **Save .efs file** for each vault or **Save all files in this group**.
5. Check that the vaults are in your browser downloads.

A name such as `family-passports.efs` can reveal information. A random name gives less information about the contents.

Keep this browser tab open until you confirm the downloads. A retry link remains available for two minutes after a download request.

Encryption does not remove the source photos or videos. It creates separate encrypted copies.

## 3. Upload the vaults to Google Drive

1. Open [Google Drive](https://drive.google.com/) in your browser.
2. Sign in to your Google Account.
3. Open the folder where you want to store the vaults.
4. Select **New**.
5. Select **File upload**.
6. Choose the downloaded .efs files.
7. Wait for the upload to finish.

Upload the .efs copies that you downloaded in step 2. Do not select the original photos or videos for this upload.

Google shows these steps in its [file upload instructions](https://support.google.com/drive/answer/2424368?hl=en).

## 4. Or upload the vaults to iCloud Drive

1. Open [iCloud Drive](https://www.icloud.com/iclouddrive/) in your browser.
2. Sign in to your Apple Account.
3. Open the folder where you want to store the vaults.
4. Select the file upload button.
5. Choose the downloaded .efs files.
6. Wait for the upload to finish.

Use the file picker to select the .efs files. Do not select Photo Library.

Apple shows these steps in its [iCloud Drive upload instructions](https://support.apple.com/guide/icloud/upload-and-download-files-mmad632d1df2/icloud).

iCloud Drive stores the vault as a file. The vault has no photo previews or video playback in iCloud Photos.

## 5. Test a restore before you remove any originals

1. Download one .efs vault from Google Drive or iCloud Drive.
2. Open encryptfs in a new tab.
3. Add the downloaded vault.
4. Open the **Decrypt** tab if it is not already open.
5. Enter the password.
6. Select **Unlock filenames**.
7. Select one file that you want to test.
8. If the button says **Decrypt selected**, select it.
9. Check that you can preview the result or open a downloaded copy.

If the button says **Preview on demand**, select it. Check that the video plays. Playback checks only the parts that the player reads.

Test that you can restore your files before you remove originals. For a full restore test, make a complete decrypted copy and open it.

A decrypted download is readable on disk. For a local copy only, use a folder without cloud sync.


## What this method protects

The vault encrypts the file contents and original names. This includes photo metadata that is stored inside the original file.

The cloud service can still see the vault filename and size. Your cloud account and upload records also remain visible to the service.

Read the [format and security guide](/efs/) for the encryption settings and known limits. The current app has not had an independent security review.

## Common questions

### Can I view encrypted photos in the cloud?

Open the .efs vault in encryptfs to read the photos or videos. Cloud photo services cannot read the vault contents.

### Does this protect photos that I uploaded earlier?

No. This process does not change existing cloud copies.

If automatic photo backup is on, original files may already be in the cloud. Check your backup and sync settings separately.

### Does encryption make the files smaller?

No. The .efs format does not compress the media. Encryption adds a small amount of data for file details and checks.

### Can I encrypt a large video?

There is no fixed app file-size cap. Your browser, available disk space, and cloud storage limits still apply.

For playback, see [how to preview a large encrypted video](/guides/play-large-encrypted-video/). Full-file decryption can reach browser memory or storage limits.

### Can I recover a lost password?

No. Neither encryptfs nor the cloud service can recover the vault password for you.

Keep the password safe. Keep a separate backup of important files.
