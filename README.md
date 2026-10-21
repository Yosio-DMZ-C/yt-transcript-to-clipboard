# YT Transcript to Clipboard

**One click to copy available YouTube transcripts with video title, channel and URL.**

YouTube動画ページで拡張機能のアイコンをクリックすると、文字起こしをクリップボードへコピーします。文字起こしパネルを手で開く必要はありません。

## Features / 機能

- Copies available transcripts directly to the clipboard / 字幕をワンクリックでコピー
- Includes video title, channel, URL and optionally publication date / 動画情報も付加
- Cleans up subtitle line breaks / 字幕の途中改行を整形
- Optional timestamps via right-click menu (off by default) / 右クリックでタイムスタンプON/OFF（初期OFF）
- Japanese / English extension UI / 日英対応
- No developer server, ads or analytics / 独自サーバー・広告・アクセス解析なし

The extension depends on YouTube's current interface and accessible captions. It may not work with every video. It is an independent, unofficial tool and is not affiliated with YouTube or Google.

本拡張機能はYouTube非公式のツールです。字幕のない動画やYouTube側の仕様変更時には動作しない場合があります。

## Install locally / ローカルインストール

1. Download this repository as ZIP and extract it. / リポジトリをZIP保存・解凍
2. Open `chrome://extensions` in Chrome. / Chromeの拡張機能画面を開く
3. Enable **Developer mode**. / **デベロッパーモード**をON
4. Select **Load unpacked**, then the extracted repository folder containing `manifest.json`. / 「パッケージ化されていない拡張機能を読み込む」を選択
5. Open a YouTube video and click the extension icon. / 動画ページでアイコンを押す

The `docs/` folder is documentation for GitHub Pages; it is **not included** in the Chrome Web Store extension package.

## How it works / 動作

Only when you click the extension icon, packaged `background.js` retrieves an accessible transcript from YouTube or opens the YouTube transcript panel as a fallback. The extension then copies the text on your device. The timestamp preference is stored locally. The extension does not send content to a developer-controlled server.

アイコンをクリックすると、その動画の字幕を取得し、端末内のクリップボードにコピーします。設定保存はタイムスタンプON/OFFのみです。

## Privacy policy / プライバシーポリシー

- [Japanese + English privacy policy / 日英プライバシーポリシー](https://yosio-dmz-c.github.io/yt-transcript-to-clipboard/)
- Source: [`docs/index.html`](docs/index.html)

> The policy URL will become public after GitHub Pages is enabled in Settings → Pages → Deploy from a branch → `main` → `/docs`.

## Contact / お問い合わせ

[GitHub Issues](https://github.com/Yosio-DMZ-C/yt-transcript-to-clipboard/issues)

## Version

Chrome extension `1.0.0`. This public source uses the same JavaScript, manifest, locale resources and icons as the supplied v1.0.0 Chrome Web Store ZIP.

## Licensing / ライセンス

Licensed under the [MIT License](LICENSE). Free to reuse and modify, including commercially, with attribution. / MITライセンスで公開しています。著作権表示を維持すれば再利用・改変・商用利用ができます。