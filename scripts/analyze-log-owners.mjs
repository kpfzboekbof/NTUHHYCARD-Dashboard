#!/usr/bin/env node
/**
 * 從 REDCap 稽核日誌（content=log）逆推「誰實際在填哪張表單／哪個欄位」。
 *
 * 現行 dashboard 的負責人是人工在 /assign 頁指定的（owner-store）。這支腳本反過來
 * 看「過去實際登錄行為」，用編輯次數歸納出事實上的負責人，用來核對人工指派是否
 * 還符合現況（例如交接後沒更新）。
 *
 * 用法：
 *   REDCAP_TOKEN=xxx node scripts/analyze-log-owners.mjs [--months 24] [--recent 6] \
 *       [--out data/log-owners.json] [--md data/log-owners.md]
 *
 * 產出：
 *   - JSON：完整彙總（表單層級、欄位層級、每月時間軸）
 *   - Markdown：可直接讀的報告
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const REDCAP_URL = process.env.REDCAP_URL || 'https://redcap.ntuh.gov.tw/api/';
const REDCAP_TOKEN = process.env.REDCAP_TOKEN || '';

/* ── 參數 ───────────────────────────────────────────────── */

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const MONTHS = parseInt(arg('months', '24'));       // 回看總區間
const RECENT_MONTHS = parseInt(arg('recent', '6')); // 「近期」判定區間
const OUT_JSON = arg('out', 'data/log-owners.json');
const OUT_MD = arg('md', 'data/log-owners.md');
// 表單／欄位要有這麼多次編輯才下負責人結論，否則只列出資料不足
const MIN_EVENTS = parseInt(arg('minEvents', '20'));
// 單一人佔比達此門檻視為唯一負責人，否則視為共同負責
const DOMINANT_SHARE = parseFloat(arg('dominantShare', '0.6'));

if (!REDCAP_TOKEN) {
  console.error('缺少 REDCAP_TOKEN 環境變數。用法：REDCAP_TOKEN=xxx node scripts/analyze-log-owners.mjs');
  process.exit(1);
}

/* ── REDCap API ─────────────────────────────────────────── */

async function redcapPost(body) {
  const form = new URLSearchParams();
  form.append('token', REDCAP_TOKEN);
  form.append('returnFormat', 'json');
  for (const [k, v] of Object.entries(body)) form.append(k, v);

  const res = await fetch(REDCAP_URL, {
    method: 'POST',
    body: form,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  if (!res.ok) throw new Error(`REDCap API ${res.status} ${res.statusText}`);
  return res;
}

/** field_name → form_name。欄位歸屬以 REDCap metadata 為準，不用檔名猜。 */
async function fetchFieldToForm() {
  const res = await redcapPost({ content: 'metadata', format: 'json' });
  const meta = await res.json();
  const map = new Map();
  for (const f of meta) map.set(f.field_name, f.form_name);
  return map;
}

async function fetchUsers() {
  const res = await redcapPost({ content: 'user', format: 'json' });
  const users = await res.json();
  const map = new Map();
  for (const u of users) {
    map.set(u.username, `${u.lastname ?? ''}${u.firstname ?? ''}`.trim() || u.username);
  }
  return map;
}

/**
 * 日誌一次抓整段容易超時／被截斷，改成逐月視窗抓取再合併。
 */
async function fetchLogWindow(begin, end) {
  const fmt = d => d.toISOString().slice(0, 16).replace('T', ' ');
  const res = await redcapPost({
    content: 'log',
    format: 'json',
    logtype: 'record',
    beginTime: fmt(begin),
    endTime: fmt(end),
  });
  const text = await res.text();
  if (!text || text.trim().length < 3) return [];
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`日誌回應無法解析（${fmt(begin)} ~ ${fmt(end)}）：${text.slice(0, 200)}`);
  }
}

async function fetchAllLogs(months) {
  const now = new Date();
  // 對齊到月初再往前推，否則 setMonth 在月底會溢位（1/31 + 1 月 = 3/2），
  // 視窗長度會漂移、進度標示也會跳掉月份
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, 1));

  const all = [];
  let cursor = start;
  while (cursor < now) {
    const next = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
    const end = next < now ? next : now;
    const batch = await fetchLogWindow(cursor, end);
    // 單月可達上萬筆，all.push(...batch) 會爆 call stack，逐筆推入
    for (const entry of batch) all.push(entry);
    process.stderr.write(`  ${cursor.toISOString().slice(0, 7)}: ${batch.length} 筆\n`);
    cursor = next;
  }
  return all;
}

/* ── 日誌解析 ───────────────────────────────────────────── */

// 這個 REDCap 是繁中介面，action 寫成「更新紀錄 7073」「建立紀錄 (import) 812」，
// 不是英文的 "Update record"；兩種語系都收，避免換語系就整份統計歸零。
const RECORD_ACTION = /(update|create|save)\s+record|更新紀錄|建立紀錄|儲存紀錄/i;

// 括號標記代表非人工輸入：API 上傳、CSV 匯入、REDCap 自動計算欄位。
// 這些是資料管線寫的，不能算成「誰負責填這張表」。
const AUTOMATED_ACTION = /\((API|import|Auto calculation)\)/i;

// REDCap 以「SYSTEM (某帳號)」記錄背景規則跑出來的異動，掛的是規則建立者的帳號，
// 不是他本人在填表；不排掉的話會變成編輯量第二名的「人」。
const SYSTEM_USER = /^SYSTEM\b/i;

/**
 * details 形如：
 *   study_id = '1234', er_arrival = '0', airway_core___1 = '1', ntuh_nhi_core_complete = '2'
 * 取出所有被寫入的欄位名。checkbox 的 field___1 收斂回 field。
 */
function parseChangedFields(details) {
  if (!details) return [];
  const fields = new Set();
  const re = /([A-Za-z][A-Za-z0-9_]*)\s*(?:\(\d+\))?\s*=\s*'/g;
  let m;
  while ((m = re.exec(details)) !== null) {
    const base = m[1].replace(/___.*$/, '');
    fields.add(base);
  }
  return Array.from(fields);
}

/*
 * dashboard 的 /assign 頁把 ntuh_nhi_core、ntuh_nhi_outcome 各拆成幾張「虛擬表單」
 * 分開指派負責人，但 REDCap 日誌只知道實體表單。這裡照 src/config/forms.ts 的欄位
 * 定義把日誌事件拆回虛擬表單，報告才對得上 /assign 上的列。
 * 欄位有異動時需與 src/config/forms.ts 同步。
 */
const CORE_ASSISTANT_FIELDS = new Set([
  'place_core', 'witnessed_core', 'bystander_core', 'pad_core',
  'manual_core', 'mcc_core', 'aed_core', 'airway_core', 'bosmin_core',
  'emt_core', 'emtp_core', 'prehos_rosc_core',
]);
const OUTCOME_ASSISTANT_FIELDS = new Set([
  'ini_dnr', 'mid_dnr', 'defibrillation', 'ever_rosc', 'any_rosc',
  'duration', 'sur_icu', 'sur_dis', 'back_ed', 'back_opd', 'back_ward', 'cost',
]);

function virtualForm(form, field) {
  if (form === 'ntuh_nhi_core') {
    return CORE_ASSISTANT_FIELDS.has(field) ? 'ntuh_nhi_core_assistant' : 'ntuh_nhi_core_doctor';
  }
  if (form === 'ntuh_nhi_outcome') {
    if (field === 'etiology_final') return 'ntuh_nhi_outcome_etiology';
    return OUTCOME_ASSISTANT_FIELDS.has(field) ? 'ntuh_nhi_outcome_assistant' : 'ntuh_nhi_outcome_doctor';
  }
  return form;
}

/** /assign 頁列出的表單；用來找出「設定裡有、但日誌完全沒動靜」的表單 */
const CONFIGURED_FORMS = [
  'ntuh_nhi_patient', 'ntuh_nhi_basic_info_38971b', 'ntuh_nhi_predisease',
  'ntuh_nhi_preohca_hos_use', 'ntuh_nhi_core_assistant', 'ntuh_nhi_core_doctor',
  'ntuh_nhi_core_cpr', 'h14trauma_ohca_transfusion', 'ntuh_nhi_lab_ed',
  'ntuh_nhi_lab_icu', 'ntuh_nhi_postarrest_care', 'ntuh_nhi_examcheck',
  'ntuh_exam_cag', 'ntuh_exam_ucg', 'ntuh_exam_abd_echo', 'ntuh_exam_pes',
  'ntuh_exam_colon', 'ntuh_nhi_op', 'ntuh_exam_patho', 'ntuh_exam_lft_2',
  'ntuh_exam_eeg', 'ntuh_exam_holtertreadmill', 'ntuh_nhi_etiology',
  'ntuh_nhi_outcome_assistant', 'ntuh_nhi_outcome_doctor', 'ntuh_nhi_outcome_etiology',
  'ntuh_nhi_discharge', 'h6_validation_add', 'h12_ed_manage_short_outcome',
  'ntuh_nhi_environment', 'h20_mtdna',
];

/** 這些欄位每次存檔都會被帶到，對「誰負責」沒有鑑別度 */
const NOISE_FIELDS = new Set([
  'study_id', 'record_id', 'redcap_repeat_instrument', 'redcap_repeat_instance',
  'redcap_event_name', 'redcap_data_access_group',
]);

function monthKey(ts) {
  // REDCap 時戳格式 YYYY-MM-DD HH:MM
  return String(ts).slice(0, 7);
}

/* ── 彙總 ───────────────────────────────────────────────── */

function newBucket() {
  return {
    events: 0,
    records: new Set(),
    byUser: new Map(),      // username → { events, records:Set, first, last }
    byUserRecent: new Map(),// 同上，只算近 RECENT_MONTHS
    months: new Map(),      // 'YYYY-MM' → Map(username → events)
  };
}

function touch(bucket, username, record, ts, isRecent) {
  bucket.events++;
  if (record) bucket.records.add(record);

  for (const [map, active] of [[bucket.byUser, true], [bucket.byUserRecent, isRecent]]) {
    if (!active) continue;
    let u = map.get(username);
    if (!u) {
      u = { events: 0, records: new Set(), first: ts, last: ts };
      map.set(username, u);
    }
    u.events++;
    if (record) u.records.add(record);
    if (ts < u.first) u.first = ts;
    if (ts > u.last) u.last = ts;
  }

  const mk = monthKey(ts);
  let m = bucket.months.get(mk);
  if (!m) { m = new Map(); bucket.months.set(mk, m); }
  m.set(username, (m.get(username) || 0) + 1);
}

/** 由使用者分佈導出負責人結論 */
function conclude(byUser, totalEvents, nameOf) {
  const ranked = Array.from(byUser.entries())
    .map(([username, u]) => ({
      username,
      name: nameOf(username),
      events: u.events,
      records: u.records.size,
      share: totalEvents > 0 ? u.events / totalEvents : 0,
      first: u.first,
      last: u.last,
    }))
    .sort((a, b) => b.events - a.events);

  if (ranked.length === 0) {
    return { verdict: 'no-data', owners: [], ranked };
  }
  if (totalEvents < MIN_EVENTS) {
    return { verdict: 'insufficient', owners: ranked.slice(0, 3).map(r => r.name), ranked };
  }
  if (ranked[0].share >= DOMINANT_SHARE) {
    return { verdict: 'sole', owners: [ranked[0].name], ranked };
  }
  // 共同負責：取累計佔比達 80% 的前幾人
  const owners = [];
  let acc = 0;
  for (const r of ranked) {
    owners.push(r.name);
    acc += r.share;
    if (acc >= 0.8) break;
  }
  return { verdict: 'shared', owners, ranked };
}

function summarize(bucket, nameOf) {
  const overall = conclude(bucket.byUser, bucket.events, nameOf);
  const recentEvents = Array.from(bucket.byUserRecent.values()).reduce((s, u) => s + u.events, 0);
  const recent = conclude(bucket.byUserRecent, recentEvents, nameOf);

  // 交接偵測：整體首位與近期首位不同，且近期有足夠資料
  const handover =
    recent.ranked.length > 0 &&
    overall.ranked.length > 0 &&
    recent.ranked[0].username !== overall.ranked[0].username &&
    recentEvents >= MIN_EVENTS;

  return {
    events: bucket.events,
    records: bucket.records.size,
    recentEvents,
    overall,
    recent,
    handover,
    timeline: Array.from(bucket.months.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, users]) => ({
        month,
        top: Array.from(users.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([username, events]) => ({ name: nameOf(username), events })),
      })),
  };
}

/* ── 報告 ───────────────────────────────────────────────── */

const VERDICT_LABEL = {
  sole: '單一負責',
  shared: '共同負責',
  insufficient: '資料不足',
  'no-data': '無紀錄',
};

/**
 * 表單有歷史編輯、但近期完全沒人動時，只寫「無紀錄」會被誤讀成這張表沒人填過。
 * 這種情況標成停用並改用全期結論。
 */
function display(item) {
  const stale = item.recent.verdict === 'no-data' && item.overall.verdict !== 'no-data';
  if (stale) {
    return { label: `近期無異動（全期${VERDICT_LABEL[item.overall.verdict]}）`, owners: item.overall.owners };
  }
  return { label: VERDICT_LABEL[item.recent.verdict], owners: item.recent.owners };
}

function fmtRanked(ranked, limit = 4) {
  return ranked.slice(0, limit)
    .map(r => `${r.name} ${(r.share * 100).toFixed(0)}%（${r.events}）`)
    .join('、') || '—';
}

function buildMarkdown(result) {
  const L = [];
  L.push('# REDCap 登錄行為推得的負責人');
  L.push('');
  L.push(`- 產生時間：${result.generatedAt}`);
  L.push(`- 回看區間：近 ${result.params.months} 個月（近期定義為最後 ${result.params.recentMonths} 個月）`);
  L.push(`- 日誌筆數：${result.totals.logEntries}（人工資料異動 ${result.totals.recordEvents} 筆；另有 ${result.totals.automatedEvents} 筆 API／匯入／自動計算已排除）`);
  L.push(`- 判定門檻：至少 ${result.params.minEvents} 次編輯才下結論；單一人佔比 ≥ ${(result.params.dominantShare * 100).toFixed(0)}% 視為單一負責`);
  L.push('');

  L.push('## 表單層級');
  L.push('');
  L.push('| 表單 | 判定 | 近期負責人 | 全期負責人 | 編輯次數 | 觸及病歷數 | 近期分佈 |');
  L.push('|---|---|---|---|---:|---:|---|');
  for (const f of result.forms) {
    const flag = f.handover ? ' ⚠️交接' : '';
    const d = display(f);
    L.push(`| ${f.form} | ${d.label}${flag} | ${d.owners.join('、') || '—'} | ${f.overall.owners.join('、') || '—'} | ${f.events} | ${f.records} | ${fmtRanked(f.recent.ranked)} |`);
  }
  L.push('');

  const handovers = result.forms.filter(f => f.handover);
  if (handovers.length) {
    L.push('## ⚠️ 疑似交接（全期主要登錄者 ≠ 近期主要登錄者）');
    L.push('');
    for (const f of handovers) {
      L.push(`- **${f.form}**：全期 ${f.overall.ranked[0].name} → 近期 ${f.recent.ranked[0].name}`);
    }
    L.push('');
  }

  L.push('## 欄位層級（各表單內編輯量前 10 的欄位）');
  L.push('');
  for (const group of result.fieldsByForm) {
    L.push(`### ${group.form}`);
    L.push('');
    L.push('| 欄位 | 判定 | 近期負責人 | 編輯次數 | 近期分佈 |');
    L.push('|---|---|---|---:|---|');
    for (const f of group.fields) {
      const d = display(f);
      L.push(`| \`${f.field}\` | ${d.label} | ${d.owners.join('、') || '—'} | ${f.events} | ${fmtRanked(f.recent.ranked, 3)} |`);
    }
    L.push('');
  }

  if (result.silentForms.length) {
    L.push('## 設定裡有、但日誌查無人工登錄的表單');
    L.push('');
    L.push(`近 ${result.params.months} 個月內沒有任何人工異動，無法從行為推負責人，需人工確認是否仍在收案：`);
    L.push('');
    for (const f of result.silentForms) L.push(`- ${f}`);
    L.push('');
  }

  L.push('## 人員總覽');
  L.push('');
  L.push('| 人員 | 帳號 | 編輯次數 | 觸及病歷數 | 主要表單 | 最後登錄 |');
  L.push('|---|---|---:|---:|---|---|');
  for (const p of result.people) {
    L.push(`| ${p.name} | ${p.accounts.join('、')} | ${p.events} | ${p.records} | ${p.topForms.map(f => `${f.form}(${f.events})`).join('、')} | ${p.last} |`);
  }
  L.push('');
  return L.join('\n');
}

/* ── 主流程 ─────────────────────────────────────────────── */

async function main() {
  process.stderr.write('取得 REDCap metadata 與使用者清單…\n');
  const [fieldToForm, userNames] = await Promise.all([fetchFieldToForm(), fetchUsers()]);

  // 帳號 → 身分（有對到使用者清單就用姓名，否則沿用帳號；退出專案的舊成員不在清單裡）
  const aliases = new Map(); // 身分 → Set(帳號)
  const identityOf = rawUser => {
    const id = userNames.get(rawUser) || rawUser;
    if (!aliases.has(id)) aliases.set(id, new Set());
    aliases.get(id).add(rawUser);
    return id;
  };
  // 收斂後 key 已經是姓名本身
  const nameOf = identity => identity;

  process.stderr.write(`抓取近 ${MONTHS} 個月的稽核日誌…\n`);
  const rawLogs = await fetchAllLogs(MONTHS);

  const recentCutoff = new Date();
  recentCutoff.setMonth(recentCutoff.getMonth() - RECENT_MONTHS);
  const recentCutoffStr = recentCutoff.toISOString().slice(0, 16).replace('T', ' ');

  const formBuckets = new Map();
  const fieldBuckets = new Map();  // `${form}::${field}`
  const peopleBuckets = new Map(); // 身分 → { events, records:Set, forms:Map, last }

  let recordEvents = 0;
  let automatedEvents = 0;
  const unmappedFields = new Map();

  for (const entry of rawLogs) {
    const action = entry.action || '';
    if (!RECORD_ACTION.test(action)) continue;
    if (AUTOMATED_ACTION.test(action)) { automatedEvents++; continue; }
    const rawUser = entry.username;
    if (!rawUser || rawUser === '[survey respondent]') continue;
    if (SYSTEM_USER.test(rawUser)) { automatedEvents++; continue; }
    // 同一個人可能有兩個帳號（例：熊墨樺 = g07470 + mohua0820），統一收斂到姓名，
    // 否則同一人的編輯量會被拆成兩份、誰都達不到單一負責門檻
    const username = identityOf(rawUser);

    const ts = entry.timestamp || '';
    const isRecent = ts >= recentCutoffStr;
    const record = entry.record || '';

    const fields = parseChangedFields(entry.details).filter(f => !NOISE_FIELDS.has(f));
    if (fields.length === 0) continue;
    recordEvents++;

    // 一次存檔可能同時動到多張表單 —— 每張表單各記一次
    const formsTouched = new Set();
    for (const field of fields) {
      let form = fieldToForm.get(field);
      if (!form && field.endsWith('_complete')) {
        // *_complete 不在 metadata 裡，但表單名就寫在欄位名上
        form = field.replace(/_complete$/, '');
      }
      if (!form) {
        unmappedFields.set(field, (unmappedFields.get(field) || 0) + 1);
        continue;
      }
      form = virtualForm(form, field);
      formsTouched.add(form);

      if (field.endsWith('_complete')) continue; // 完成狀態不算欄位層級的登錄行為

      const key = `${form}::${field}`;
      if (!fieldBuckets.has(key)) fieldBuckets.set(key, newBucket());
      touch(fieldBuckets.get(key), username, record, ts, isRecent);
    }

    for (const form of formsTouched) {
      if (!formBuckets.has(form)) formBuckets.set(form, newBucket());
      touch(formBuckets.get(form), username, record, ts, isRecent);

      let p = peopleBuckets.get(username);
      if (!p) { p = { events: 0, records: new Set(), forms: new Map(), last: ts }; peopleBuckets.set(username, p); }
      p.forms.set(form, (p.forms.get(form) || 0) + 1);
    }

    const p = peopleBuckets.get(username);
    if (p) {
      p.events++;
      if (record) p.records.add(record);
      if (ts > p.last) p.last = ts;
    }
  }

  const forms = Array.from(formBuckets.entries())
    .map(([form, bucket]) => ({ form, ...summarize(bucket, nameOf) }))
    .sort((a, b) => b.events - a.events);

  // 欄位依所屬表單分組，每組取編輯量前 10
  const grouped = new Map();
  for (const [key, bucket] of fieldBuckets.entries()) {
    const [form, field] = key.split('::');
    if (!grouped.has(form)) grouped.set(form, []);
    grouped.get(form).push({ field, ...summarize(bucket, nameOf) });
  }
  const fieldsByForm = Array.from(grouped.entries())
    .map(([form, fields]) => ({
      form,
      fields: fields.sort((a, b) => b.events - a.events).slice(0, 10),
    }))
    .sort((a, b) =>
      (forms.find(f => f.form === b.form)?.events || 0) - (forms.find(f => f.form === a.form)?.events || 0));

  const people = Array.from(peopleBuckets.entries())
    .map(([identity, p]) => ({
      // 收斂後的身分，可能對應多個 REDCap 帳號
      name: identity,
      accounts: Array.from(aliases.get(identity) || [identity]),
      events: p.events,
      records: p.records.size,
      last: p.last,
      topForms: Array.from(p.forms.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([form, events]) => ({ form, events })),
    }))
    .sort((a, b) => b.events - a.events);

  const result = {
    generatedAt: new Date().toISOString(),
    params: { months: MONTHS, recentMonths: RECENT_MONTHS, minEvents: MIN_EVENTS, dominantShare: DOMINANT_SHARE },
    totals: { logEntries: rawLogs.length, recordEvents, automatedEvents },
    forms,
    // /assign 上有這張表、但日誌完全沒有人工異動 —— 這類最可能就是「未指派」的來源
    silentForms: CONFIGURED_FORMS.filter(name => !formBuckets.has(name)),
    fieldsByForm,
    people,
    unmappedFields: Array.from(unmappedFields.entries())
      .sort((a, b) => b[1] - a[1]).slice(0, 30)
      .map(([field, count]) => ({ field, count })),
  };

  const jsonPath = resolve(process.cwd(), OUT_JSON);
  const mdPath = resolve(process.cwd(), OUT_MD);
  mkdirSync(dirname(jsonPath), { recursive: true });
  mkdirSync(dirname(mdPath), { recursive: true });
  writeFileSync(jsonPath, JSON.stringify(result, (k, v) => (v instanceof Set ? Array.from(v) : v), 2), 'utf-8');
  writeFileSync(mdPath, buildMarkdown(result), 'utf-8');

  process.stderr.write(`\n完成：${jsonPath}\n      ${mdPath}\n`);
  process.stderr.write(`表單 ${forms.length} 張、欄位 ${fieldBuckets.size} 個、人員 ${people.length} 位\n`);
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
