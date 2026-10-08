# Macでの起動と実機確認への引継ぎ

2026-10-09、利用者からTKCを別のMacのブラウザで操作していると確認しました。ツールもそのMacで起動する構成にします。このリポジトリはP1プレビューと人への引継ぎまでの実装です。起動してもTKCへの自動登録・計上は始まりません。

## 1. プレビューを起動する

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

## 2. Macで模擬検証する

```sh
npm run check
npx playwright install chromium
npm run test:e2e
```

PlaywrightのChromiumは、この模擬画面テスト用です。インストールしても利用中のTKCブラウザやログイン済みプロファイルに接続するわけではありません。2026-10-09にGitHub ActionsのmacOS / Node.js 24でビルド・29件のロジックテスト・5件のブラウザテストが成功しました。[検証記録](acceptance.md)。CIのMacと利用者のMac、実TKCの動作確認は区別します。

## 3. Mac側で実画面を確認する

現在のWindowsセッションには別Macのブラウザが接続されていません。Mac側でブラウザ操作が利用できる環境を用意し、利用者が普段使っているブラウザでTKCへログインします。ブラウザ名・正式製品名・対象会社・口座・期間を画面で確認します。操作環境が既存ブラウザへ接続できるかも最初に確認します。Macのブラウザへ接続するために、このアプリをLANへ公開する必要はありません。

Mac側の担当者・エージェントには、次を渡してください。

> SHOGO391/tkc-gmo-assistantのpreview/p1を開いてください。TKCはこのMacのブラウザで使っています。AGENTS.md、docs/P0-environment.md、docs/decisions.md、docs/next-live-validation.mdを確認し、最初はTKCの読取り確認を進めてください。実画面に基づいて製品名、会社・口座・期間、締め状態、銀行明細、取引先登録、仕訳取込、保存結果の読戻しを確認してください。未確認のセレクタやCSV形式を推測で確定しないでください。目的は取込・計上までの自動操作と、不明な明細の人への引継ぎです。取引先登録と仕訳計上の状態を分け、結果不明では再送しないでください。実機で確認できたことと模擬検証を分けて記録してください。

実画面から操作手順・読込形式・結果照合方法を確認できたら、交換可能なTKCアダプタを実装します。書込み対象が具体化した時点の条件は[実機検証手順](next-live-validation.md)を参照してください。

## 4. 人への引継ぎ

プレビューの「人への引継ぎ」で、理由・確認事項・原本の行・再開条件を確認します。担当者、回答、根拠を保存し、必要ならCSVを出力します。回答だけで登録済み・計上済みにはなりません。[引継ぎの詳細](human-handoff.md)

GMO原本、TKC一覧、DB、ログイン情報、画面証跡はGitHubへ送信しません。Macの実機確認に必要な資料はMac内で保管してください。
