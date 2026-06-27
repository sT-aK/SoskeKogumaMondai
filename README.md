# 問題管理

何月何日にどのページを解いて、何問中何問正解したかを記録するための、夫婦2人専用の問題管理サービスです。

- サーバーは使わず、GitHub Pagesで配信する静的サイト + Firebase（Authentication / Firestore）だけで動作します。
- Googleアカウントでログインし、許可された2つのメールアドレスのみ利用できます。
- 記録は1つの共有データとして、どちらがログインしても同じ一覧・統計を見られます。

## セットアップ手順

### 1. Firebaseプロジェクトを作成する

1. https://console.firebase.google.com/ にアクセスし、新しいプロジェクトを作成する。
2. 「Authentication」→「Sign-in method」で **Google** を有効化する。
3. 「Firestore Database」→「データベースの作成」で、本番環境モードでデータベースを作成する（リージョンは任意、`asia-northeast1` など）。

### 2. Firestoreのセキュリティルールを設定する

1. Firebaseコンソールの「Firestore Database」→「ルール」を開く。
2. このリポジトリの `firestore.rules` の内容を貼り付ける。
3. `husband@example.com` / `wife@example.com` を、実際に許可したい2つのGoogleアカウントのメールアドレスに書き換えて公開する。

### 3. Webアプリを登録し、設定値を取得する

1. Firebaseコンソールの「プロジェクトの設定」→「マイアプリ」→ウェブアプリを追加する。
2. 表示される `firebaseConfig` の値を、このリポジトリの `firebase-config.js` の `firebaseConfig` にコピーする。
3. `firebase-config.js` の `ALLOWED_EMAILS` にも、`firestore.rules` と同じ2つのメールアドレスを設定する（こちらはUI表示用の簡易チェックで、実際のアクセス制御はFirestoreルール側が行います）。

### 4. 認証の承認済みドメインを追加する

1. Firebaseコンソールの「Authentication」→「Settings」→「承認済みドメイン」を開く。
2. GitHub Pagesで公開するドメイン（例: `<ユーザー名>.github.io`）を追加する。

### 5. GitHub Pagesを有効化する

1. このリポジトリの「Settings」→「Pages」を開く。
2. 「Source」を「Deploy from a branch」、ブランチを公開したいブランチ、フォルダを `/ (root)` に設定する。
3. 数分後に表示されるURLにアクセスすると、ログイン画面が表示されます。

## ファイル構成

- `index.html` / `style.css` / `app.js`: 画面本体
- `pages-data.js`: 問題集のページ一覧（マスタデータ）
- `firebase-config.js`: Firebaseの接続情報・許可アカウント（要編集）
- `firestore.rules`: Firestoreのセキュリティルール（Firebaseコンソールに貼り付けて使用）

## 注意

- `firebase-config.js` のAPIキーはクライアント側に公開される前提の値です（Firebaseの仕様上問題ありません）。実際のアクセス制御は必ず `firestore.rules` 側で行ってください。
