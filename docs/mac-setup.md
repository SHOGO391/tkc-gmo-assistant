# Macでの起動と実機確認への引継ぎ

2026-10-09、利用者からTKCを別のMacのブラウザで操作していると確認しました。ツールもそのMacで起動する構成にします。このリポジトリはP1プレビューと人への引継ぎまでの実装です。起動してもTKCへの自動登録・計上は始まりません。

## 1. 配布ZIPからプレビューを起動する

GitHub Actionsの成功した実行を開き、Artifactsの `tkc-gmo-assistant-mac` を取得します。外側のArtifact ZIPと、その中の `tkc-gmo-assistant-mac.zip` を展開し、`tkc-gmo-assistant/Start-Mac.command` をダブルクリックしてください。初回はインターネットが必要です。画面に起動URLが出ると、既定ブラウザでローカルのプレビューが開きます。TKCへの接続・登録・計上は行いません。

- コンパイル済みコードを同梱しています。Git、Python、TypeScriptの導入は不要です。
- Node.js 24以上とnpmがあれば使用します。なければ公式のNode.js 24.21.0を取得し、固定のSHA-256を照合してから使います。Apple Silicon / Intelの配布物を分けています。[公式配布物](https://nodejs.org/en/download/archive/v24.21.0)
- Node.jsは `~/Library/Application Support/TKC GMO Preview/runtime/`、業務データは同階層の `data/` に保存します。アプリのZIPを更新しても、この保存先は継続利用できます。システムのNode.jsやmacOSの権限設定は変更しません。
- ターミナルを開いたまま使い、止めるときはControl+Cを押します。

起動前の確認だけを行う場合は、展開したフォルダで次を実行します。

```sh
./Start-Mac.command --check
```

JSONの `previewReady: true` はローカルの起動準備が整ったことを示します。`liveTkcConnection: "unverified"`、`liveWritesEnabled: false` は実TKCが未確認で書込み機能がないことを示します。診断では業務DB・CSVを開きません。任意の模擬テスト用ブラウザが未導入でも、プレビューは使用できます。ポート使用中や実データの内容まで診断する機能ではありません。

開発側でZIPを作成するには `npm run bundle:mac` を使います。出力先はGit対象外の `private/tkc-gmo-assistant-mac.zip` とSHA-256ファイルです。許可したコード・ドキュメントだけを梱包し、DB・CSV・画面証跡・認証情報は入れません。ZIPの内部マニフェストでも各ファイルのハッシュを記録します。

## 2. Gitからプレビューを起動する

Macのターミナルで実行します。Node.js 24以上、npm、Git、非公開リポジトリへのアクセス権が必要です。Node.jsのmacOS配布は[公式ダウンロード](https://nodejs.org/en/download)から確認できます。

```sh
node --version
npm --version
git clone https://github.com/SHOGO391/tkc-gmo-assistant.git
cd tkc-gmo-assistant
npm ci
npm run dev
```

ブラウザで `http://127.0.0.1:4317` を開き、「模擬データで試す」を押します。Windowsで表示していたlocalhostはWindows内のアプリで、Macのlocalhostとは別です。GitHubにはコードのみがあるため、既存のWindows側ジョブはMacには移りません。

すでにこのリポジトリを取得している場合は、作業中の変更を確認してから更新してください。現在の既定ブランチは `preview/p1` です。

既定の保存先はプロジェクト内の `data/` です。Mac上の別の保存先を使う場合は、起動時に指定します。`.env` は自動で読み込みません。

```sh
DATA_DIR="$HOME/tkc-gmo-local-data" npm run dev
```

サーバーを止めるにはターミナルでControl+Cを押します。再度同じ保存先で起動すると、中断状態や回答を保持したまま再開できます。

## 3. Macで模擬検証する

```sh
npm run check
npx playwright install chromium
npm run test:e2e
```

PlaywrightのChromiumは、この模擬画面テスト用です。インストールしても利用中のTKCブラウザやログイン済みプロファイルに接続するわけではありません。2026-10-09にGitHub ActionsのmacOS / Node.js 24でビルド・29件のロジックテスト・5件のブラウザテストが成功しました。[検証記録](acceptance.md)。CIのMacと利用者のMac、実TKCの動作確認は区別します。

## 4. Mac側で実画面を確認する

現在のWindowsセッションには別Macのブラウザが接続されていません。Mac側でブラウザ操作が利用できる環境を用意し、利用者が普段使っているブラウザでTKCへログインします。ブラウザ名・正式製品名・対象会社・口座・期間を画面で確認します。操作環境が既存ブラウザへ接続できるかも最初に確認します。Macのブラウザへ接続するために、このアプリをLANへ公開する必要はありません。

2026-10-09に[OpenAI公式のRemote connections](https://learn.chatgpt.com/docs/remote-connections)と[Chrome extension](https://learn.chatgpt.com/docs/chrome-extension)を確認しました。接続は次の順序です。

1. TKCを使うMacのCodexデスクトップで、同じアカウント・ワークスペースにログインします。**Settings → Connections → Control this Mac or PC → Set up / Add** から、そのMacを接続先に登録します。機能は段階的な提供のため、表示されるかMac側で確認が必要です。
2. Mac側の **Settings → Computer Use** からブラウザ操作に必要なプラグインとChatGPT拡張を設定します。拡張はTKCを開いているブラウザのプロファイルに入れます。公式の対応一覧はChrome、Edge、Brave、Opera、Vivaldiです。利用者のブラウザがどれかは未確認です。
3. Windows側で利用可能なら **Settings → Connections → Control other devices** から登録したMacを選択します。接続後、そのホストでブラウザを取得できることを確認します。利用できない場合はMac側のCodexでこのリポジトリを開いて作業を引き継ぎます。

このWindowsでの調査では、登録済みMac、Mac向けSSH設定、Macのブラウザ操作先は見つかりませんでした。利用できるハンドオフ先もlocalだけでした。Plugin Managementの検索でも、既存Macのブラウザ接続を代替する手段は確認できませんでした。Mac側の接続登録をコードで代行したり、こちらから未登録のMacを操作することはできません。SSH接続だけでもブラウザ操作の接続確認にはなりません。

Playwrightのテストブラウザや `@Browser` の別セッションでは、普段TKCへログインしているブラウザの観察を代替できません。実画面を取得してから、観察に基づくアダプタを実装します。

Mac側の担当者・エージェントには、次を渡してください。

> SHOGO391/tkc-gmo-assistantのpreview/p1を開いてください。TKCはこのMacのブラウザで使っています。AGENTS.md、docs/P0-environment.md、docs/decisions.md、docs/next-live-validation.mdを確認し、最初はTKCの読取り確認を進めてください。実画面に基づいて製品名、会社・口座・期間、締め状態、銀行明細、取引先登録、仕訳取込、保存結果の読戻しを確認してください。未確認のセレクタやCSV形式を推測で確定しないでください。目的は取込・計上までの自動操作と、不明な明細の人への引継ぎです。取引先登録と仕訳計上の状態を分け、結果不明では再送しないでください。実機で確認できたことと模擬検証を分けて記録してください。

実画面から操作手順・読込形式・結果照合方法を確認できたら、交換可能なTKCアダプタを実装します。書込み対象が具体化した時点の条件は[実機検証手順](next-live-validation.md)を参照してください。

## 5. 人への引継ぎ

プレビューの「人への引継ぎ」で、理由・確認事項・原本の行・再開条件を確認します。担当者、回答、根拠を保存し、必要ならCSVを出力します。回答だけで登録済み・計上済みにはなりません。[引継ぎの詳細](human-handoff.md)

GMO原本、TKC一覧、DB、ログイン情報、画面証跡はGitHubへ送信しません。Macの実機確認に必要な資料はMac内で保管してください。
