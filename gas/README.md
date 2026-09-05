# TapAttend GAS デプロイ手順

## ファイル

- `Code.gs`: バックエンド（スプレッドシート読み書き）。ソース。
- `appsscript.json`: マニフェスト。ソース。
- `index.html`: `npm run build:gas` の出力。**このファイルは編集しない**（次回ビルドで上書きされる）。

## 初回セットアップ

1. `npm run build:gas` を実行し、`gas/index.html` を生成する
2. https://script.google.com/ で新規プロジェクト作成
3. `Code.gs` の中身を `gas/Code.gs` の内容で置き換える
4. 左の「+」→「HTML」でファイル追加、ファイル名を `index`（拡張子なし）にして `gas/index.html` の内容を貼り付ける
5. GASエディタの関数選択で `setRosterSpreadsheetId` を選び、引数に名簿マスタのスプレッドシートIDを渡して1回だけ実行する
   ```js
   setRosterSpreadsheetId('ここに名簿マスタのスプレッドシートID')
   ```
6. 「デプロイ」→「新しいデプロイ」→ 種類「ウェブアプリ」
   - 次のユーザーとして実行: 自分
   - アクセスできるユーザー: 組織内
7. 発行された `/exec` URL を教員に共有する

## コード更新時

1. `npm run build:gas`
2. GASエディタで `Code.gs` と `index` を新しい内容で上書き
3. 「デプロイ」→「デプロイを管理」→ 既存デプロイの鉛筆アイコンから「新しいバージョン」を選んで更新（URLは変わらない）

## 出欠データスプレッドシートについて

初回アクセス時に自動作成され（「TapAttend出欠データ」）、そのIDはスクリプトプロパティに保存される。
手動で作る必要はない。
