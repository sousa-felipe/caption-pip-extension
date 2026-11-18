<h1 align="center">
  <img src="src/img/icons/icon48.png" alt="Caption Pip" width="40" height="40" align="absmiddle">
  Caption Pip Extension
</h1>

## Installation

1. Get the code: [Latest Release](https://github.com/sousa-felipe/caption-pip-extension/releases/latest)
2. Open `chrome://extensions` (or `edge://extensions`, `brave://extensions`).
3. Turn on **Developer mode**.
4. Click **Load unpacked**.
5. Select the **extracted folder** with `manifest.json`.

## How to use

Open a video, then press **`Alt`** + **`Shift`** + **`P`** (or use the *Caption pip* **button** on upper right corner).

If the captions are not found, press **`Alt`** + **`Shift`** + **`S`** (or use the *Pick caption* **button**) then click the caption text.

> [!NOTE]
> If the buttons cover a control of the video player, right click them and choose **Hide buttons**. They stay hidden until your cursor leaves the upper right corner of the video, then show up again on hover.

## How it works

The extension draws the video and the captions together on a canvas, then streams that canvas to your browser's built-in Picture-in-Picture window.

> [!IMPORTANT]
> When a video is DRM-protected or its frames can't be drawn due to CORS restrictions, the extension moves the `<video>` itself into a [Document Picture-in-Picture](https://developer.chrome.com/docs/web-platform/document-picture-in-picture) window that mimics Chromium's built-in player and overlays the captions.

> [!WARNING]
> If Document Picture-in-Picture isn't supported, no captions are found, or an error occurs, your browser's native Picture-in-Picture opens instead, without captions.

## Release History

[Releases Page](https://github.com/sousa-felipe/caption-pip-extension/releases)

## License

Released under the [MIT License](LICENSE.txt).

## About

Caption Pip is an independent project. Does not record your screen, collect or sell your data.

Free. Open-source. For users by users. No donations sought.
