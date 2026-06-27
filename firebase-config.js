// Firebaseコンソール > プロジェクトの設定 > マイアプリ で取得した値をここに貼り付けてください。
// 詳しい手順は README.md を参照してください。
export const firebaseConfig = {
  apiKey: 'YOUR_API_KEY',
  authDomain: 'YOUR_PROJECT_ID.firebaseapp.com',
  projectId: 'YOUR_PROJECT_ID',
  storageBucket: 'YOUR_PROJECT_ID.appspot.com',
  messagingSenderId: 'YOUR_SENDER_ID',
  appId: 'YOUR_APP_ID',
};

// アクセスを許可する2人のGoogleアカウントのメールアドレス。
// ここでの制限はUI表示用の簡易チェックです。実際のアクセス制御は
// Firestoreのセキュリティルール（firestore.rules）側で行われます。
// 両方のファイルに同じメールアドレスを設定してください。
export const ALLOWED_EMAILS = [
  'husband@example.com',
  'wife@example.com',
];
