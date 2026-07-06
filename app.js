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
import { firebaseConfig } from './firebase-config.js?v=20260706a';
import { PAGES } from './pages-data.js?v=20260706a';

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
const memoInput = document.getElementById('memo');
const submitBtn = document.getElementById('submit-btn');
const cancelEditBtn = document.getElementById('cancel-edit');
const formError = document.getElementById('form-error');
const filterUnitSelect = document.getElementById('filter-unit');
const filterFromInput = document.getElementById('filter-from');
const filterToInput = document.getElementById('filter-to');
const filterClearBtn = document.getElementById('filter-clear');
const exportCsvBtn = document.getElementById('export-csv');
const trendChartEl = document.getElementById('trend-chart');
const recordsTableBody = document.querySelector('#records-table tbody');
const recordsTableHead = document.querySelector('#records-table thead');
const pagesTableBody = document.querySelector('#pages-table tbody');
const pagesTableHead = document.querySelector('#pages-table thead');
const summaryEl = document.getElementById('summary');
const reviewSuggestSection = document.getElementById('review-suggest');
const reviewSuggestList = document.getElementById('review-suggest-list');

let unsubscribeRecords = null;
let allRecords = [];
let currentUser = null;

// テーブルの並び替え状態。records は日付降順（Firestoreクエリと同じ）を既定にする。
let recordsSort = { key: 'date', dir: 'desc' };
// units は「復習が必要な順（要復習→未挑戦→途中→習得済み）」を既定にする。
let unitsSort = { key: 'status', dir: 'asc' };

const ACCURACY_GOOD = 80;
const ACCURACY_MID = 60;

// 単元ステータスの優先度（小さいほど「復習が必要」で上に来る）。
const STATUS_ORDER = { 要復習: 0, 未挑戦: 1, 途中: 2, 習得済み: 3 };

// 正答率(0〜100 or null)を信号色クラスに変換する。
function accuracyClass(rate) {
  if (rate === null || rate === undefined) return '';
  if (rate >= ACCURACY_GOOD) return 'acc-good';
  if (rate >= ACCURACY_MID) return 'acc-mid';
  return 'acc-bad';
}

// ある単元の集計値をまとめて返す（renderUnitsTable と復習おすすめで共用）。
function computeUnitStats(unitNumber) {
  const records = allRecords.filter(
    (r) => (r.unitNumber ?? r.pageNumber) === unitNumber
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
  return { attemptCount, lastDate, totalCorrect, totalQuestions, accuracy };
}

// 集計値から単元の状況ラベルを判定する。
function unitStatus(stats) {
  if (stats.attemptCount === 0) return '未挑戦';
  if (stats.accuracy === null) return '未挑戦';
  if (stats.accuracy < ACCURACY_MID) return '要復習';
  if (stats.accuracy < ACCURACY_GOOD) return '途中';
  return '習得済み';
}

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
  memoInput.value = record.memo ?? '';
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
    memo: memoInput.value.trim(),
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
filterFromInput.addEventListener('change', renderRecords);
filterToInput.addEventListener('change', renderRecords);
filterClearBtn.addEventListener('click', () => {
  filterUnitSelect.value = '';
  filterFromInput.value = '';
  filterToInput.value = '';
  renderRecords();
});
exportCsvBtn.addEventListener('click', exportRecordsCsv);

// テーブルヘッダのクリックで並び替え（同じ列を再クリックで昇順/降順を反転）。
function handleSortClick(head, sortState, rerender, defaultDir = 'asc') {
  head.addEventListener('click', (e) => {
    const th = e.target.closest('th.sortable');
    if (!th) return;
    const key = th.dataset.sortKey;
    if (sortState.key === key) {
      sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
    } else {
      sortState.key = key;
      sortState.dir = defaultDir;
    }
    rerender();
  });
}
handleSortClick(recordsTableHead, recordsSort, renderRecords, 'desc');
handleSortClick(pagesTableHead, unitsSort, renderRecords, 'asc');

// ヘッダに現在のソート方向（▲/▼）を表示する。
function updateSortIndicators(head, sortState) {
  for (const th of head.querySelectorAll('th.sortable')) {
    const base = th.dataset.label || th.textContent.replace(/[\s▲▼]+$/, '');
    th.dataset.label = base;
    if (th.dataset.sortKey === sortState.key) {
      th.textContent = `${base} ${sortState.dir === 'asc' ? '▲' : '▼'}`;
      th.classList.add('sorted');
    } else {
      th.textContent = base;
      th.classList.remove('sorted');
    }
  }
}

// CSV用に1フィールドをエスケープする。
function csvField(value) {
  const s = value === null || value === undefined ? '' : String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// 現在の絞り込み・並び替えを反映した記録をCSVで書き出す。
function exportRecordsCsv() {
  const rows = sortRecords(getFilteredRecords());
  const header = ['日付', '単元番号', '単元名', 'ページ', '問題数', '正解数', '正答率', 'メモ', '記録者'];
  const lines = [header.map(csvField).join(',')];
  for (const r of rows) {
    const unitNumber = r.unitNumber ?? r.pageNumber;
    const unit = PAGES_BY_NUMBER.get(unitNumber);
    const accuracy = recordAccuracy(r);
    lines.push([
      r.date,
      unitNumber,
      unit ? unit.title : '',
      r.pageNumber,
      r.totalCount,
      r.correctCount,
      accuracy === null ? '' : `${accuracy}%`,
      r.memo || '',
      r.createdByName || '',
    ].map(csvField).join(','));
  }
  // BOM付きUTF-8でExcelの文字化けを防ぐ。
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `解答記録_${toDateStr(new Date())}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

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

function recordAccuracy(record) {
  return record.totalCount > 0
    ? Math.round((record.correctCount / record.totalCount) * 1000) / 10
    : null;
}

function getFilteredRecords() {
  const filterValue = filterUnitSelect.value;
  const from = filterFromInput.value;
  const to = filterToInput.value;
  return allRecords.filter((r) => {
    if (filterValue && (r.unitNumber ?? r.pageNumber) !== Number(filterValue)) {
      return false;
    }
    if (from && r.date < from) return false;
    if (to && r.date > to) return false;
    return true;
  });
}

function sortRecords(records) {
  const { key, dir } = recordsSort;
  const factor = dir === 'asc' ? 1 : -1;
  const sorted = [...records];
  sorted.sort((a, b) => {
    let av;
    let bv;
    if (key === 'unit') {
      av = (PAGES_BY_NUMBER.get(a.unitNumber ?? a.pageNumber) || {}).title || '';
      bv = (PAGES_BY_NUMBER.get(b.unitNumber ?? b.pageNumber) || {}).title || '';
      return av.localeCompare(bv, 'ja') * factor;
    }
    if (key === 'accuracy') {
      av = recordAccuracy(a);
      bv = recordAccuracy(b);
      av = av === null ? -1 : av;
      bv = bv === null ? -1 : bv;
    } else if (key === 'pageNumber') {
      av = a.pageNumber;
      bv = b.pageNumber;
    } else {
      // date
      av = a.date;
      bv = b.date;
    }
    if (av < bv) return -1 * factor;
    if (av > bv) return 1 * factor;
    return 0;
  });
  return sorted;
}

function renderRecords() {
  const filtered = getFilteredRecords();
  const rows = sortRecords(filtered);

  renderTrendChart(filtered);

  recordsTableBody.innerHTML = '';
  for (const record of rows) {
    const unitNumber = record.unitNumber ?? record.pageNumber;
    const unit = PAGES_BY_NUMBER.get(unitNumber);
    const accuracy = recordAccuracy(record);

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
    tdAccuracy.className = accuracyClass(accuracy);

    const tdMemo = document.createElement('td');
    tdMemo.className = 'memo-cell';
    tdMemo.textContent = record.memo || '';

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

    tr.append(tdDate, tdUnit, tdPage, tdScore, tdAccuracy, tdMemo, tdBy, tdActions);
    recordsTableBody.appendChild(tr);
  }

  updateSortIndicators(recordsTableHead, recordsSort);
  renderUnitsTable();
  renderSummary();
  renderReviewSuggest();
}

// 折れ線グラフ（依存ライブラリなしのインラインSVG）。
// 単一単元に絞り込み、かつ2件以上あるときだけ、正答率の推移を表示する。
function renderTrendChart(filtered) {
  const singleUnit = filterUnitSelect.value !== '';
  const points = [...filtered]
    .filter((r) => recordAccuracy(r) !== null)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map((r) => ({ date: r.date, accuracy: recordAccuracy(r) }));

  if (!singleUnit || points.length < 2) {
    trendChartEl.hidden = true;
    trendChartEl.innerHTML = '';
    return;
  }

  const W = 640;
  const H = 180;
  const padX = 40;
  const padY = 24;
  const innerW = W - padX * 2;
  const innerH = H - padY * 2;
  const n = points.length;
  const x = (i) => padX + (n === 1 ? innerW / 2 : (innerW * i) / (n - 1));
  const y = (v) => padY + innerH * (1 - v / 100);

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'trend-svg');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', '正答率の推移');

  // 目盛り線（0/50/100%）。
  for (const v of [0, 50, 100]) {
    const line = document.createElementNS(svgNS, 'line');
    line.setAttribute('x1', padX);
    line.setAttribute('x2', W - padX);
    line.setAttribute('y1', y(v));
    line.setAttribute('y2', y(v));
    line.setAttribute('class', 'trend-grid');
    svg.appendChild(line);
    const label = document.createElementNS(svgNS, 'text');
    label.setAttribute('x', padX - 6);
    label.setAttribute('y', y(v) + 4);
    label.setAttribute('text-anchor', 'end');
    label.setAttribute('class', 'trend-axis');
    label.textContent = `${v}`;
    svg.appendChild(label);
  }

  const poly = document.createElementNS(svgNS, 'polyline');
  poly.setAttribute('class', 'trend-line');
  poly.setAttribute('points', points.map((p, i) => `${x(i)},${y(p.accuracy)}`).join(' '));
  svg.appendChild(poly);

  points.forEach((p, i) => {
    const circle = document.createElementNS(svgNS, 'circle');
    circle.setAttribute('cx', x(i));
    circle.setAttribute('cy', y(p.accuracy));
    circle.setAttribute('r', 4);
    circle.setAttribute('class', 'trend-dot');
    const title = document.createElementNS(svgNS, 'title');
    title.textContent = `${p.date}　${p.accuracy}%`;
    circle.appendChild(title);
    svg.appendChild(circle);
  });

  trendChartEl.innerHTML = '';
  trendChartEl.appendChild(svg);
  trendChartEl.hidden = false;
}

function sortUnitRows(rows) {
  const { key, dir } = unitsSort;
  const factor = dir === 'asc' ? 1 : -1;
  const sorted = [...rows];
  sorted.sort((a, b) => {
    let av;
    let bv;
    if (key === 'status') {
      av = STATUS_ORDER[a.status];
      bv = STATUS_ORDER[b.status];
    } else if (key === 'title') {
      return a.title.localeCompare(b.title, 'ja') * factor;
    } else if (key === 'lastDate') {
      av = a.lastDate || '';
      bv = b.lastDate || '';
    } else if (key === 'accuracy') {
      av = a.accuracy === null ? -1 : a.accuracy;
      bv = b.accuracy === null ? -1 : b.accuracy;
    } else {
      // number / attemptCount
      av = a[key];
      bv = b[key];
    }
    if (av < bv) return -1 * factor;
    if (av > bv) return 1 * factor;
    // 同順位は単元番号で安定化。
    return a.number - b.number;
  });
  return sorted;
}

function renderUnitsTable() {
  const rows = PAGES.map((unit) => {
    const stats = computeUnitStats(unit.number);
    return {
      number: unit.number,
      title: unit.title,
      status: unitStatus(stats),
      attemptCount: stats.attemptCount,
      lastDate: stats.lastDate,
      accuracy: stats.accuracy,
    };
  });

  pagesTableBody.innerHTML = '';
  for (const row of sortUnitRows(rows)) {
    const tr = document.createElement('tr');
    tr.className = `unit-${statusClassSuffix(row.status)}`;

    const tdNumber = document.createElement('td');
    tdNumber.textContent = row.number;
    const tdTitle = document.createElement('td');
    tdTitle.textContent = row.title;
    const tdStatus = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = `status-badge status-${statusClassSuffix(row.status)}`;
    badge.textContent = row.status;
    tdStatus.appendChild(badge);
    const tdAttempts = document.createElement('td');
    tdAttempts.textContent = row.attemptCount;
    const tdLastDate = document.createElement('td');
    tdLastDate.textContent = row.lastDate || '-';
    const tdAccuracy = document.createElement('td');
    tdAccuracy.textContent = row.accuracy === null ? '-' : `${row.accuracy}%`;
    tdAccuracy.className = accuracyClass(row.accuracy);

    tr.append(tdNumber, tdTitle, tdStatus, tdAttempts, tdLastDate, tdAccuracy);
    pagesTableBody.appendChild(tr);
  }

  updateSortIndicators(pagesTableHead, unitsSort);
}

function statusClassSuffix(status) {
  switch (status) {
    case '要復習': return 'review';
    case '未挑戦': return 'untried';
    case '途中': return 'progress';
    default: return 'mastered';
  }
}

// ローカルタイムでの YYYY-MM-DD 文字列を返す。
function toDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// 記録日（重複排除）から、最新学習日を起点に連続している日数を数える。
// 今日または昨日を含むときだけ「継続中」とみなす。
function computeStreak(dateStrings) {
  const days = [...new Set(dateStrings)].sort().reverse();
  if (days.length === 0) return 0;
  const today = toDateStr(new Date());
  const yesterday = toDateStr(new Date(Date.now() - 86400000));
  if (days[0] !== today && days[0] !== yesterday) return 0;

  let streak = 1;
  let cursor = new Date(days[0] + 'T00:00:00');
  for (let i = 1; i < days.length; i += 1) {
    cursor = new Date(cursor.getTime() - 86400000);
    if (days[i] === toDateStr(cursor)) {
      streak += 1;
    } else {
      break;
    }
  }
  return streak;
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

  const streak = computeStreak(allRecords.map((r) => r.date));

  // 今週（月曜起点）と今月の挑戦回数。
  const now = new Date();
  const monday = new Date(now);
  const offset = (now.getDay() + 6) % 7; // 月曜=0
  monday.setDate(now.getDate() - offset);
  const weekStart = toDateStr(monday);
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const weekCount = allRecords.filter((r) => r.date >= weekStart).length;
  const monthCount = allRecords.filter((r) => r.date >= monthStart).length;

  summaryEl.innerHTML = '';
  const items = [
    `全${PAGES.length}単元中 ${attemptedUnits}単元に挑戦済み`,
    `合計挑戦回数: ${attemptCount}回`,
    `全体正答率: ${overallAccuracy === null ? '-' : overallAccuracy + '%'}`,
    `連続学習: ${streak > 0 ? streak + '日' : '記録なし'}`,
    `今週: ${weekCount}回 / 今月: ${monthCount}回`,
  ];
  for (const text of items) {
    const span = document.createElement('span');
    span.textContent = text;
    summaryEl.appendChild(span);
  }
}

// 復習おすすめ: 習得済みを除き、正答率の低さと最終日からの経過日数でスコア化して上位を表示。
function renderReviewSuggest() {
  const today = new Date();
  const scored = PAGES.map((unit) => {
    const stats = computeUnitStats(unit.number);
    const status = unitStatus(stats);
    let score;
    if (stats.attemptCount === 0) {
      // 未挑戦: 中程度の優先度（低正答率の要復習より下、習得済みより上）。
      score = 120;
    } else {
      const daysSince = stats.lastDate
        ? Math.floor((today - new Date(stats.lastDate + 'T00:00:00')) / 86400000)
        : 0;
      score = (100 - (stats.accuracy ?? 0)) + Math.min(daysSince, 60);
    }
    return { unit, stats, status, score };
  }).filter((s) => s.status !== '習得済み');

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 5);

  reviewSuggestList.innerHTML = '';
  if (top.length === 0) {
    reviewSuggestSection.hidden = true;
    return;
  }
  reviewSuggestSection.hidden = false;

  for (const item of top) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `suggest-chip unit-${statusClassSuffix(item.status)}`;

    const title = document.createElement('span');
    title.className = 'suggest-title';
    title.textContent = `${item.unit.number}　${item.unit.title}`;

    const meta = document.createElement('span');
    meta.className = 'suggest-meta';
    const acc = item.stats.accuracy === null ? '-' : `${item.stats.accuracy}%`;
    const last = item.stats.lastDate ? `最終 ${item.stats.lastDate}` : '未挑戦';
    meta.textContent = `${item.status}・正答率 ${acc}・${last}`;

    chip.append(title, meta);
    // クリックでこの単元を絞り込み表示し、追加フォームの単元も合わせる。
    chip.addEventListener('click', () => {
      filterUnitSelect.value = String(item.unit.number);
      unitSelect.value = String(item.unit.number);
      renderRecords();
      document.getElementById('records-table').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    reviewSuggestList.appendChild(chip);
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
