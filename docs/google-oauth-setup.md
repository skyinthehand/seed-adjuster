# Google OAuth クライアント登録手順

このツールはGoogle Sheets APIをブラウザから直接呼び出す(サーバー側でのトークン保管は行わない。research.md #4)。そのために、OAuthクライアントIDを1つだけ登録する。

**重要**: このGoogle Cloudプロジェクトには**課金を有効化しない**こと(research.md #0)。課金を有効化しない限り、このプロジェクト経由で費用が発生することはない。

## 手順

1. [Google Cloud Console](https://console.cloud.google.com/) で新しいプロジェクトを作成する(既存プロジェクトを流用しない — 他の用途と混在させると誤って課金を有効化するリスクが上がる)。
2. 「APIとサービス」→「認証情報」→「OAuth同意画面」を設定する。
   - User Type: 外部(External)
   - スコープ: `https://www.googleapis.com/auth/spreadsheets`(シート読み書き)、必要に応じて `https://www.googleapis.com/auth/drive.file`(専用スプレッドシートの自動作成用、FR-012a)
3. 「認証情報を作成」→「OAuthクライアントID」→アプリケーションの種類は「ウェブアプリケーション」を選択する。
4. 「承認済みのJavaScript生成元」に、GitHub Pagesの公開オリジン(例: `https://<org>.github.io`)を追加する。ローカル開発用に `http://localhost:5173` も追加してよい。
5. 発行された **クライアントID** を控える(クライアントシークレットは使用しない — クライアントサイドのトークンクライアントのみを使う。research.md #4)。
6. 「APIとサービス」→「有効なAPI」で Google Sheets API と Google Drive API(専用シート自動作成を使う場合)を有効化する。
7. **課金(Billing)は有効化しない。** このプロジェクトに支払い方法を一切登録しないこと。

## フロントエンドへの設定

`frontend/.env.example` の `VITE_GOOGLE_OAUTH_CLIENT_ID` に、上記で発行されたクライアントIDを設定する(実際の値は `.env.local` などGit管理外のファイルに置く)。
