# How to play a large encrypted video without saving a decrypted copy

Use on-demand preview to play a video from an .efs vault. The vault is an encrypted file that contains one or more original files.

## Open the video

1. [Open encryptfs](/).
2. Select **Add files**.
3. Choose the .efs vault.
4. Open the **Decrypt** tab if it is closed.
5. Enter the vault password.
6. Select **Unlock filenames**.
7. Select **Play** beside the video name.

For one large video, select its checkbox. Then select **Preview on demand**.

## Play the video

1. Select the play control in the preview.
2. To move to a different point in the video, use the playback bar.
3. To stop the preview, select **Close preview**.

![The player requests part of the video. Encryptfs decrypts that part from the vault and sends the bytes to the player.](/guides/diagrams/video-preview.svg)

The player requests a byte range. A byte range is a part of the file at a specified position.

Encryptfs checks the integrity of each encrypted chunk that contains the requested bytes. It then sends the requested bytes to the player.

The app does not create a complete decrypted video file during playback. It processes the vault in your browser.

## If the video does not play

On-demand preview is available for MOV, MP4, and WebM files. Your browser must also support the codec that the video uses.

A codec is the method that encodes and decodes the video. Two files with the same extension can use different codecs.

If playback fails, check the message in the preview dialog. If the browser cannot decode the video, try a browser that supports its codec.

To make a vault from your own videos, see [how to encrypt photos and videos before upload](/guides/encrypt-photos-videos-google-drive-icloud/).
