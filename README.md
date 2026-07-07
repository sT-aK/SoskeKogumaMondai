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
3. `husband@example.com` / `wife@example.com` の部分だけを、実際に許可したい2つのGoogleアカウントのメールアドレスに**Firebaseコンソール上で直接**書き換えて公開する。

**重要**: 実際のメールアドレスは、このリポジトリの `firestore.rules` ファイル自体には書き込まないでください（GitHub Pagesやリポジトリからメールアドレスがそのまま見える状態になります）。書き換えるのはFirebaseコンソールの画面上だけにしてください。

### 3. Webアプリを登録し、設定値を取得する

1. Firebaseコンソールの「プロジェクトの設定」→「マイアプリ」→ウェブアプリを追加する。
2. 表示される `firebaseConfig` の値を、このリポジトリの `firebase-config.js` の `firebaseConfig` にコピーする。
3. `firebaseConfig` の値（`apiKey`を含む）はそのままコミットして問題ありません。Firebaseの仕様上、Web向けの`apiKey`はブラウザに公開される前提の識別子であり秘密情報ではないためです。実際のアクセス制御は常にFirestoreルール側のみで行います。

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

- 画面から追加した単元はFirestoreの `units` コレクションに保存されます。`firestore.rules` を更新した場合（`units` の許可追加など）は、Firebaseコンソールのルール編集画面に**再度貼り付けて公開**してください（メールアドレス部分は実際の値のまま維持）。

- `firebase-config.js` のAPIキーはクライアント側に公開される前提の値です（Firebaseの仕様上問題ありません）。実際のアクセス制御は必ず `firestore.rules` 側で行ってください。
- 任意ですが、APIキーの不正利用（クォータの無断使用など）を防ぐため、Google Cloud Consoleの「APIとサービス」→「認証情報」で、このAPIキーに対して「HTTPリファラーの制限」（`https://<ユーザー名>.github.io/*` のみ許可）を設定することを推奨します。
- 許可するメールアドレス自体は、このリポジトリのどのファイルにもコミットしないでください。`firestore.rules`はテンプレートとしてダミーのメールアドレスのままにし、実際の値はFirebaseコンソールのルール編集画面にのみ入力してください。
