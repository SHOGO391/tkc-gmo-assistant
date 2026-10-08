import { canonicalJson, hash } from './domain.js';

type Json = Record<string, any>;
export interface HandoffItem {
  id: string; kind: 'environment' | 'transaction' | 'registration' | 'operation';
  title: string; priority: 'normal' | 'urgent'; reasons: string[];
  txIds: string[]; sources: Json[]; registrationState: string; journalState: string;
  lastConfirmedStep: string; questions: string[]; resumeConditions: string[];
  resendAllowed: false; contentHash: string; detail: Json;
  response: Json | null; history: Json[];
}

/** Produces a human handoff from current evidence. A human response never marks TKC work done. */
export function buildHandoff(a: Json, notes: Json[] = []) {
  const items: HandoffItem[] = [];
  const sources = (txIds: string[]) => a.sightings.filter((s: Json) => txIds.includes(s.txId)).map((s: Json) => ({
    sourceId: s.sourceId, file: a.sources.find((f: Json) => f.id === s.sourceId)?.name,
    hash: a.sources.find((f: Json) => f.id === s.sourceId)?.hash,
    row: s.rowNumber, endRow: s.endLine, txId: s.txId,
  }));
  const add = (item: Omit<HandoffItem, 'contentHash' | 'response' | 'history' | 'resendAllowed'>) => {
    const contentHash = hash(canonicalJson({ context: a.job.context, ...item }));
    const history = notes.filter(n => n.itemId === item.id);
    const response = history.filter(n => n.contentHash === contentHash).at(-1) ?? null;
    items.push({ ...item, resendAllowed: false, contentHash, response, history });
  };
  const environmentReasons: string[] = [];
  if (!a.job.observed?.available) environmentReasons.push(a.job.observed?.reason ?? 'TKCの実画面に未接続');
  if (a.externalJournalCoverage !== 'verified') environmentReasons.push('既存仕訳・受信明細の取得範囲が未確認');
  if (a.job.context.closeStatus !== 'open') environmentReasons.push('対象月が未締めであることを確認できない');
  if (environmentReasons.length) add({
    id: 'environment:' + a.job.id, kind: 'environment', title: 'TKC接続と計上前の確認', priority: 'urgent',
    reasons: environmentReasons, txIds: [], sources: [], registrationState: '未確認', journalState: '未確認',
    lastConfirmedStep: 'ローカルの原本・仕訳案まで。TKCでの確認は未完了',
    questions: ['利用中の製品・版と操作できるブラウザまたはPCは何か', '対象会社・口座・月・権限・未締め状態を実画面で確認できるか', '既存仕訳と受信明細を漏れなく取得し、保存結果を読戻せるか'],
    resumeConditions: ['観察した画面に基づいてアダプタを接続する', '計上対象と取得範囲を確定して既存データを照合する'],
    detail: { context: a.job.context, observation: a.job.observed, externalJournalCoverage: a.externalJournalCoverage },
  });
  for (const tx of a.transactions) {
    const uncertain = ['intent', 'sent', 'unknown'].includes(tx.journalState) || ['intent', 'sent', 'unknown'].includes(tx.registrationState);
    if (!uncertain && ['done', 'excluded'].includes(tx.status)) continue;
    const reasons = [...tx.issues, ...(tx.approvalReason ? [tx.approvalReason] : [])];
    if (!reasons.length && !uncertain) continue;
    if (uncertain && !reasons.some(r => r.includes('再送'))) reasons.push('保存結果を確定できないため再送禁止。TKCで照合が必要');
    const questions = [];
    if (tx.error || tx.flags.some((f: string) => !tx.acknowledgements[f])) questions.push('原本の行・銀行ID・金額を確認し、重複か別取引かを根拠付きで判断する');
    if (!tx.code) questions.push('請求書等で取引先を特定し、既存先を確認するか新規登録案を作る。カナだけでは確定しない');
    if (!tx.proposal) questions.push('科目・税区分・取引先・手数料・分割を確認し、根拠付きの仕訳ルールを設定する');
    if (tx.approvalInvalidated) questions.push('変更された内容と根拠を見直し、この行を再承認する');
    if (uncertain) questions.push('取引先一覧と仕訳一覧で保存結果の全項目を照合する。0件や取得失敗を不存在と判断しない');
    add({
      id: 'transaction:' + tx.id, kind: 'transaction', title: `${tx.date ?? '日付未確認'} / ${tx.description}`, priority: uncertain ? 'urgent' : 'normal',
      reasons, txIds: [tx.id], sources: sources([tx.id]), registrationState: tx.registrationState, journalState: tx.journalState,
      lastConfirmedStep: uncertain ? '保存結果が不明。完了を確認できていない' : tx.approved ? '仕訳プレビューの承認まで' : tx.code ? '取引先の照合または登録案まで' : 'CSV原本の取込みまで',
      questions, resumeConditions: uncertain ? ['実TKCの保存結果を計画の全項目と照合する', '未確定の書込みを再送しない'] : ['対応する明細・取引先・ルールの確認を反映する', '要確認事項がなくなった内容を改めてプレビュー承認する'],
      detail: { date: tx.date, bankId: tx.bankId, amount: tx.amount, direction: tx.direction, description: tx.description, name: tx.name, counterpartyCode: tx.code, proposal: tx.proposal, rowHash: tx.rowHash },
    });
  }
  for (const task of a.tasks) {
    if (task.registrationState === 'done') continue;
    const txIds = a.transactions.filter((t: Json) => t.registrationTaskId === task.id).map((t: Json) => t.id);
    const uncertain = ['intent', 'sent', 'unknown'].includes(task.registrationState);
    add({
      id: 'registration:' + task.id, kind: 'registration', title: '取引先登録 / ' + task.fields.name.value, priority: uncertain ? 'urgent' : 'normal',
      reasons: [uncertain ? '登録結果が不明。登録を再送せずマスタを照合する' : '登録案を作成済み。実TKCへの登録は未実施'],
      txIds, sources: sources(txIds), registrationState: task.registrationState, journalState: '関連明細ごとに管理',
      lastConfirmedStep: '法人の識別子と出典に基づく登録案の集約まで',
      questions: ['実画面の必須項目と最新マスタのコード・法人番号の重複を確認する', '登録結果を再取得し、実際のコード・正式名称等を照合する'],
      resumeConditions: ['観察した登録操作と読戻し方法を確認する', '確認済みの登録結果を関連明細で共有し、仕訳計上は別に確認する'],
      detail: { taskId: task.id, candidateCode: task.code, fields: task.fields },
    });
  }
  for (const operation of a.operations) {
    if (operation.state === 'confirmed') continue;
    const txIds = operation.txId ? [operation.txId] : [];
    add({
      id: 'operation:' + operation.id, kind: 'operation', title: '操作結果の照合 / ' + operation.id, priority: 'urgent',
      reasons: ['外部操作の結果が確定していない。自動再送は禁止'], txIds, sources: sources(txIds),
      registrationState: '操作の種類と関連登録案を照合', journalState: '操作の種類と関連明細を照合',
      lastConfirmedStep: '保存した操作意図・履歴まで。保存成功は未確認',
      questions: ['操作IDと意図を確認し、TKCから取得した結果を全項目で比較する', '取得範囲・取得成否・一致件数と保存結果の根拠を残す'],
      resumeConditions: ['一意に一致した読戻し結果によってのみ完了を確定する', '不明・0件・複数一致では再送せず担当者へ引き継ぐ'],
      detail: { operation },
    });
  }
  items.sort((a, b) => Number(b.priority === 'urgent') - Number(a.priority === 'urgent'));
  return { jobId: a.job.id, generatedAt: new Date().toISOString(), context: a.job.context, paused: a.job.paused,
    mode: 'preview-with-human-handoff', liveExecutionAvailable: false, completion: a.completion,
    summary: { items: items.length, urgent: items.filter(i => i.priority === 'urgent').length,
      responsesAwaitingReview: items.filter(i => i.response?.status === 'response-recorded').length },
    items, notes, notice: '回答の記録だけでは登録・計上完了になりません。再開時は最新データと保存結果を再確認します。' };
}

/** Spreadsheet formula prefixes are escaped even if preceded by whitespace. */
export function handoffCsv(report: ReturnType<typeof buildHandoff>) {
  const cell = (value: unknown) => {
    let s = String(value ?? '');
    if (/^[\s\uFEFF]*[=+@-]/u.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  };
  const header = ['ID', '優先度', '対象', '止まった理由', '原本位置', '登録状態', '仕訳状態', '最後に確認できた段階', '人が確認する項目', '再開条件', '担当者', '回答状態', '回答', '回答の根拠', '内容ハッシュ'];
  const rows = report.items.map(i => [i.id, i.priority, i.title, i.reasons.join('\n'), i.sources.map(s => `${s.file}:${s.row}-${s.endRow} SHA256=${s.hash}`).join('\n'), i.registrationState, i.journalState, i.lastConfirmedStep, i.questions.join('\n'), i.resumeConditions.join('\n'), i.response?.owner, i.response?.status, i.response?.note, i.response?.evidence, i.contentHash]);
  return '\uFEFF' + [header, ...rows].map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
