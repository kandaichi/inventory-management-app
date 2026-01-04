# Inventory Management App

このアプリは、在庫管理を目的としたWebアプリケーションです。React（Vite）とFirebaseを利用して構築されています。

## 主な機能
- 在庫アイテムの追加、編集、削除
- 在庫リストの表示
- Firebaseによるデータ永続化
- Tailwind CSSによるスタイリング

## 技術スタック
- React (Vite)
- TypeScript
- Firebase
- Tailwind CSS

## セットアップ方法

1. **リポジトリのクローン**
   ```bash
   git clone <このリポジトリのURL>
   cd inventory_management_app
   ```

2. **依存パッケージのインストール**
   ```bash
   npm install
   ```

3. **Firebaseの設定**
   - `src/firebase.ts` または `src/firebase.js` を編集し、Firebaseプロジェクトの設定を記入してください。

4. **開発サーバーの起動**
   ```bash
   npm run dev
   ```
   ブラウザで `http://localhost:5173` を開いてアプリを確認できます。

## ディレクトリ構成

```
├── src/
│   ├── App.tsx / App.js
│   ├── firebase.ts / firebase.js
│   ├── main.tsx / main.js
│   ├── index.css
│   └── components/
│       └── Logo.tsx / Logo.js
├── index.html
├── package.json
├── tailwind.config.js
├── postcss.config.js
├── vite.config.ts
└── tsconfig.json
```

## ライセンス
MIT License
