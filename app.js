import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';
import {
  getFirestore,
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';
import { PAGES } from './pages-data.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

const PAGES_BY_NUMBER = new Map(PAGES.map((p) => [p.number, p]));

const authArea = document.getElementById('auth-area');
const appRoot = document.getElementById('app');
const signedOutCard = document.getElementById('signed-out');

const form = document.getElementById('record-form');
const recordIdInput = document.getElementById('record-id');
const dateInput = document.getElementById('date');
const unitSelect = document.getElementById('unit');
const pageNumberInput = document.getElementById('page-number');
const totalInput = document.getElementById('total');
const correctInput = document.getElementById('correct');
const submitBtn = document.getElementById('submit-btn');
const cancelEditBtn = document.getElementById('cancel-edit');
const formError = document.getElementById('form-error');
const filterUnitSelect = document.getElementById('filter-unit');
const recordsTableBody = document.querySelector('#records-table tbody');
const pagesTableBody = document.querySelector('#pages-table tbody');
const summaryEl = document.getElementById('summary');

let unsubscribeRecords = null;
let allRecords = [];
let currentUser = null;

function populateUnitSelects() {
  for (const select of [unitSelect, filterUnitSelect]) {
    const keepValue = select.value;
    while (select.options.length > (select === filterUnitSelect ? 1 : 0)) {
      select.remove(select.options.length - 1);
    }
    for (const page of PAGES) {
      const opt = document.createElement('option');
      opt.value = String(page.number);
      opt.textContent = `${page.number}　${page.title}`;
      select.appendChild(opt);
    }
    select.value = keepValue;
  }
}

function renderAuthArea() {
  authArea.innerHTML = '';
  if (currentUser) {
    const img = document.createElement('img');
    img.src = currentUser.photoURL || '';
    img.alt = '';
    const name = document.createElement('span');
    name.textContent = currentUser.displayName || currentUser.email;
    const logoutBtn = document.createElement('button');
    logoutBtn.className = 'secondary';
    logoutBtn.textContent = 'ログアウト';
    logoutBtn.addEventListener('click', () => signOut(auth));
    authArea.append(img, name, logoutBtn);
  } else {
    const loginBtn = document.createElement('button');
    loginBtn.textContent = 'Googleでログイン';
    loginBtn.addEventListener('click', () => {
      signInWithPopup(auth, provider).catch((err) => {
        alert(`ログインに失敗しました: ${err.message}`);
      });
    });
    authArea.appendChild(loginBtn);
  }
}

function resetForm() {
  form.reset();
  recordIdInput.value = '';
  submitBtn.textContent = '追加';
  cancelEditBtn.hidden = true;
  formError.textContent = '';
  dateInput.value = new Date().toISOString().slice(0, 10);
}

function startEdit(record) {
  recordIdInput.value = record.id;
  dateInput.value = record.date;
  unitSelect.value = String(record.unitNumber ?? record.pageNumber);
  pageNumberInput.value = String(record.pageNumber);
  totalInput.value = String(record.totalCount);
  correctInput.value = String(record.correctCount);
  submitBtn.textContent = '更新';
  cancelEditBtn.hidden = false;
  formError.textContent = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function validateForm() {
  const date = dateInput.value;
  const unitNumber = Number(unitSelect.value);
  const pageNumber = Number(pageNumberInput.value);
  const totalCount = Number(totalInput.value);
  const correctCount = Number(correctInput.value);

  if (!date) return '日付を指定してください。';
  if (!PAGES_BY_NUMBER.has(unitNumber)) return '単元名を指定してください。';
  if (!Number.isInteger(pageNumber) || pageNumber <= 0) {
    return 'ページは1以上の整数で指定してください。';
  }
  if (!Number.isInteger(totalCount) || totalCount <= 0) {
    return '問題数は1以上の整数で指定してください。';
  }
  if (!Number.isInteger(correctCount) || correctCount < 0) {
    return '正解数は0以上の整数で指定してください。';
  }
  if (correctCount > totalCount) return '正解数が問題数を超えています。';
  return null;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const error = validateForm();
  if (error) {
    formError.textContent = error;
    return;
  }
  formError.textContent = '';

  const payload = {
    date: dateInput.value,
    unitNumber: Number(unitSelect.value),
    pageNumber: Number(pageNumberInput.value),
    totalCount: Number(totalInput.value),
    correctCount: Number(correctInput.value),
  };

  try {
    const id = recordIdInput.value;
    if (id) {
      await updateDoc(doc(db, 'records', id), payload);
    } else {
      await addDoc(collection(db, 'records'), {
        ...payload,
        createdByEmail: currentUser.email,
        createdByName: currentUser.displayName || currentUser.email,
        createdAt: serverTimestamp(),
      });
    }
    resetForm();
  } catch (err) {
    formError.textContent = `保存に失敗しました: ${err.message}`;
  }
});

cancelEditBtn.addEventListener('click', resetForm);

filterUnitSelect.addEventListener('change', renderRecords);

// 単元を選んだとき、ページ欄が空ならその単元の開始ページを初期値として補完する。
unitSelect.addEventListener('change', () => {
  if (!pageNumberInput.value) {
    pageNumberInput.value = unitSelect.value;
  }
});

async function deleteRecord(id) {
  if (!confirm('この記録を削除しますか？')) return;
  try {
    await deleteDoc(doc(db, 'records', id));
  } catch (err) {
    alert(`削除に失敗しました: ${err.message}`);
  }
}

function renderRecords() {
  const filterValue = filterUnitSelect.value;
  const filtered = filterValue
    ? allRecords.filter((r) => (r.unitNumber ?? r.pageNumber) === Number(filterValue))
    : allRecords;

  recordsTableBody.innerHTML = '';
  for (const record of filtered) {
    const unitNumber = record.unitNumber ?? record.pageNumber;
    const unit = PAGES_BY_NUMBER.get(unitNumber);
    const accuracy = record.totalCount > 0
      ? Math.round((record.correctCount / record.totalCount) * 1000) / 10
      : null;

    const tr = document.createElement('tr');

    const tdDate = document.createElement('td');
    tdDate.textContent = record.date;

    const tdUnit = document.createElement('td');
    tdUnit.textContent = unit ? unit.title : '(不明な単元)';

    const tdPage = document.createElement('td');
    tdPage.textContent = record.pageNumber;

    const tdScore = document.createElement('td');
    tdScore.textContent = `${record.correctCount} / ${record.totalCount}`;

    const tdAccuracy = document.createElement('td');
    tdAccuracy.textContent = accuracy === null ? '-' : `${accuracy}%`;

    const tdBy = document.createElement('td');
    tdBy.textContent = record.createdByName || '';

    const tdActions = document.createElement('td');
    const editBtn = document.createElement('button');
    editBtn.className = 'link';
    editBtn.textContent = '編集';
    editBtn.addEventListener('click', () => startEdit(record));
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'link danger';
    deleteBtn.textContent = '削除';
    deleteBtn.addEventListener('click', () => deleteRecord(record.id));
    tdActions.append(editBtn, deleteBtn);

    tr.append(tdDate, tdUnit, tdPage, tdScore, tdAccuracy, tdBy, tdActions);
    recordsTableBody.appendChild(tr);
  }

  renderUnitsTable();
  renderSummary();
}

function renderUnitsTable() {
  pagesTableBody.innerHTML = '';
  for (const unit of PAGES) {
    const records = allRecords.filter(
      (r) => (r.unitNumber ?? r.pageNumber) === unit.number
    );
    const attemptCount = records.length;
    const lastDate = records.reduce(
      (latest, r) => (!latest || r.date > latest ? r.date : latest),
      null
    );
    const totalCorrect = records.reduce((sum, r) => sum + r.correctCount, 0);
    const totalQuestions = records.reduce((sum, r) => sum + r.totalCount, 0);
    const accuracy = totalQuestions > 0
      ? Math.round((totalCorrect / totalQuestions) * 1000) / 10
      : null;

    const tr = document.createElement('tr');
    const tdNumber = document.createElement('td');
    tdNumber.textContent = unit.number;
    const tdTitle = document.createElement('td');
    tdTitle.textContent = unit.title;
    const tdAttempts = document.createElement('td');
    tdAttempts.textContent = attemptCount;
    const tdLastDate = document.createElement('td');
    tdLastDate.textContent = lastDate || '-';
    const tdAccuracy = document.createElement('td');
    tdAccuracy.textContent = accuracy === null ? '-' : `${accuracy}%`;

    tr.append(tdNumber, tdTitle, tdAttempts, tdLastDate, tdAccuracy);
    pagesTableBody.appendChild(tr);
  }
}

function renderSummary() {
  const attemptedUnits = new Set(
    allRecords.map((r) => r.unitNumber ?? r.pageNumber)
  ).size;
  const attemptCount = allRecords.length;
  const totalCorrect = allRecords.reduce((sum, r) => sum + r.correctCount, 0);
  const totalQuestions = allRecords.reduce((sum, r) => sum + r.totalCount, 0);
  const overallAccuracy = totalQuestions > 0
    ? Math.round((totalCorrect / totalQuestions) * 1000) / 10
    : null;

  summaryEl.innerHTML = '';
  const items = [
    `全${PAGES.length}単元中 ${attemptedUnits}単元に挑戦済み`,
    `合計挑戦回数: ${attemptCount}回`,
    `全体正答率: ${overallAccuracy === null ? '-' : overallAccuracy + '%'}`,
  ];
  for (const text of items) {
    const span = document.createElement('span');
    span.textContent = text;
    summaryEl.appendChild(span);
  }
}

function subscribeToRecords() {
  if (unsubscribeRecords) {
    unsubscribeRecords();
    unsubscribeRecords = null;
  }
  const q = query(collection(db, 'records'), orderBy('date', 'desc'));
  unsubscribeRecords = onSnapshot(
    q,
    (snapshot) => {
      appRoot.hidden = false;
      signedOutCard.hidden = true;
      allRecords = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderRecords();
    },
    async (err) => {
      if (err.code === 'permission-denied') {
        alert('このアカウントには利用権限がありません。');
        await signOut(auth);
        return;
      }
      console.error(err);
      alert(`記録の取得に失敗しました: ${err.message}`);
    }
  );
}

onAuthStateChanged(auth, (user) => {
  currentUser = user;
  renderAuthArea();

  if (user) {
    // 権限があるかどうかはFirestoreへの最初のアクセスで判定する（subscribeToRecords内のonSnapshotエラー参照）。
    signedOutCard.hidden = true;
    subscribeToRecords();
  } else {
    appRoot.hidden = true;
    signedOutCard.hidden = false;
    if (unsubscribeRecords) {
      unsubscribeRecords();
      unsubscribeRecords = null;
    }
    allRecords = [];
  }
});

populateUnitSelects();
resetForm();
