# ☕️ EzoCafe Log 開発カルテ

## 📌 現在のシステム構成
- **フロントエンド**: `index.html` + `main.js` (Vanilla JS)
- **バックエンド**: `worker.js` (Cloudflare Workers)
- **データベース**: Cloudflare D1 (テーブル名: `diaries`, `shops_master`)

## ✨ 実装済みのコア機能
- **画像モデレーション**: Cloudflare Vision AI (`llama-3.2-11b-vision-instruct`) が自撮りや不適切画像を判定し、NGなら画像を破棄（容量節約）。
- **テキストAI抽出＆監視**: Cloudflare Workers AI (`llama-3.1-8b-instruct`) が、本文からタグ（国、品種、席、目的など）を自動抽出。不適切な場合は「🚨共有不可」「🚨要確認」タグを裏で付与。
- **自衛のDX UI**: 画面上(`main.js`)では「🤖」と「🚨」タグを非表示にし、ユーザーには普通の記録アプリに見せる。
- **Exif連携**: `exifr` ライブラリを使用し、画像選択時に撮影日時を自動取得してセット。
- **表示順**: D1から最新順(`ORDER BY visited_at DESC`)で取得。

## 🚀 次のタスク（現在ここ）
- 1画面に詰め込まれた機能を整理するため、**「スマホ風のボトムナビゲーション（下部タブ）」**を導入する。
- まずは「📝 記録タブ」と「📚 履歴タブ」の2画面分割へのリファクタリングを行う。