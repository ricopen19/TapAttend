#!/bin/sh
# GASの Code.gs / index.html を1つずつ確実にクリップボード経由でコピーする。
# クリップボードは1つしかないので、必ず「コピー→GASに貼り付け→Enter」の順で進める。
set -e

if [ ! -t 0 ]; then
  echo "エラー: このスクリプトは対話実行が前提です（Enterで貼り付けを待つ）。" >&2
  echo "非対話（パイプ入力・自動化）で実行すると、貼り付ける前に次のファイルでクリップボードが上書きされます。" >&2
  echo "ターミナルで直接 npm run copy:gas を実行してください。" >&2
  exit 1
fi

cd "$(dirname "$0")/.."

npm run build:gas

cat gas/Code.gs | pbcopy
echo "1/2: Code.gs をコピーしました。GASエディタの Code.gs に貼り付けたら Enter を押してください。"
read -r _

cat gas/index.html | pbcopy
echo "2/2: index.html をコピーしました。GASエディタの index に貼り付けたら Enter を押してください。"
read -r _

echo "完了。デプロイを管理→既存デプロイの鉛筆アイコン→新しいバージョン→デプロイ、を忘れずに。"
