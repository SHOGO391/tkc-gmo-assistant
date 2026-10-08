import { DatabaseSync, backup } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { InputError, hash, canonicalJson, id, now, norm, required, validateContext, readCsv, checkMapping, normalizeRow, type CsvMapping, type Encoding, type JobContext, type Rule } from './domain.js';

type Json = Record<string, any>;
export class Store {
  db: DatabaseSync;
  root: string;
  constructor(root: string) {
    this.root = path.resolve(root);
    fs.mkdirSync(path.join(this.root, 'originals'), { recursive: true });
    this.db = new DatabaseSync(path.join(this.root, 'app.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id), hash TEXT NOT NULL, data TEXT NOT NULL, UNIQUE(job_id,hash));
      CREATE TABLE IF NOT EXISTS tx(id TEXT PRIMARY KEY, scope TEXT NOT NULL, bank_id TEXT, fingerprint TEXT, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS tx_bank ON tx(scope,bank_id);
      CREATE INDEX IF NOT EXISTS tx_fingerprint ON tx(scope,fingerprint);
      CREATE TABLE IF NOT EXISTS sightings(source_id TEXT NOT NULL REFERENCES sources(id), row_number INTEGER NOT NULL, tx_id TEXT NOT NULL REFERENCES tx(id), data TEXT NOT NULL, PRIMARY KEY(source_id,row_number));
      CREATE TABLE IF NOT EXISTS masters(id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id), data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, scope TEXT NOT NULL, identity TEXT NOT NULL, data TEXT NOT NULL, UNIQUE(scope,identity));
      CREATE TABLE IF NOT EXISTS aliases(id TEXT PRIMARY KEY, scope TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS rules(id TEXT PRIMARY KEY, scope TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS plans(id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id), data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id), tx_id TEXT REFERENCES tx(id), data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS audit(seq INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL REFERENCES jobs(id), at TEXT NOT NULL, action TEXT NOT NULL, data TEXT NOT NULL);
      PRAGMA user_version=1;`);
  }
  close() { this.db.close(); }
  row(sql: string, ...args: any[]): any { return this.db.prepare(sql).get(...args); }
  rows(sql: string, ...args: any[]): any[] { return this.db.prepare(sql).all(...args); }
  run(sql: string, ...args: any[]) { return this.db.prepare(sql).run(...args); }
  atomic<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  get(table: string, key: string): Json {
    if (!['jobs','tx','sources','tasks','plans','operations'].includes(table)) throw new Error('Invalid table');
    const row = this.row(`SELECT data FROM ${table} WHERE id=?`, key);
    if (!row) throw new InputError('対象が見つかりません');
    return JSON.parse(row.data);
  }
  put(table: string, obj: Json) {
    if (!['jobs','tx','tasks','plans','operations'].includes(table)) throw new Error('Invalid table');
    this.run(`UPDATE ${table} SET data=? WHERE id=?`, JSON.stringify(obj), obj.id);
  }
  audit(jobId: string, action: string, data: Json = {}) { this.run('INSERT INTO audit(job_id,at,action,data) VALUES(?,?,?,?)', jobId, now(), action, JSON.stringify(data)); }
  scope(c: JobContext) { return JSON.stringify([c.company,c.account,c.evidenceKind]); }
  companyScope(c: JobContext) { return JSON.stringify([c.company,c.evidenceKind]); }
  createJob(v: any): Json {
    const context = validateContext(v);
    const job = { id: id(), context, createdAt: now(), paused: false, phase: 'preview', observed: null, externalJournalCoverage: 'unknown' };
    return this.atomic(() => { this.run('INSERT INTO jobs VALUES(?,?)', job.id, JSON.stringify(job)); this.audit(job.id,'job.created',{ context }); return job; });
  }
  jobs() { return this.rows('SELECT data FROM jobs ORDER BY rowid DESC').map(r => JSON.parse(r.data)); }
  mutable(jobId: string): Json { const j = this.get('jobs',jobId); if (j.paused) throw new InputError('中断中です。再開してから変更してください'); return j; }
  keepOriginal(bytes: Buffer) {
    const digest = hash(bytes), filename = path.join(this.root,'originals',digest+'.csv');
    if (fs.existsSync(filename)) { if (hash(fs.readFileSync(filename)) !== digest) throw new Error('原本のハッシュが一致しません'); }
    else fs.writeFileSync(filename,bytes,{ flag:'wx', mode:0o600 });
    return digest;
  }
  importBank(jobId: string, bytes: Buffer, v: { name: string; encoding: Encoding; headerRow: number; mapping: CsvMapping }) {
    const job = this.mutable(jobId), c: JobContext = job.context;
    const parsed = readCsv(bytes,v.encoding,v.headerRow); checkMapping(parsed.headers,v.mapping as any,['date','description','deposit','withdrawal']);
    const digest = this.keepOriginal(bytes);
    return this.atomic(() => {
      const prior = this.row('SELECT id,data FROM sources WHERE job_id=? AND hash=?',jobId,digest);
      if (prior) {
        const old = JSON.parse(prior.data);
        if (canonicalJson(old.mapping) !== canonicalJson(v.mapping) || old.encoding !== v.encoding || old.headerRow !== v.headerRow) throw new InputError('同じ原本の読取り条件が変更されています。既存取込みを確認してください');
        this.audit(jobId,'source.repeated',{ sourceId: prior.id, hash:digest }); return { sourceId:prior.id, repeated:true, created:0, reused:old.rows };
      }
      const source = { id:id(), jobId, hash:digest, name:required(v.name,'ファイル名'), encoding:v.encoding, headerRow:v.headerRow, mapping:v.mapping, acquiredAt:now(), scope:c, rows:parsed.rows.length };
      const identicalSources=this.rows('SELECT data FROM sources WHERE hash=?',digest).map(r=>JSON.parse(r.data)).filter(s=>this.scope(s.scope)===this.scope(c)&&s.scope.start===c.start&&s.scope.end===c.end);
      if(identicalSources.some(s=>canonicalJson(s.mapping)!==canonicalJson(v.mapping)||s.encoding!==v.encoding||s.headerRow!==v.headerRow))throw new InputError('他のジョブで同じ原本を異なる読取り条件で取り込んでいます');
      this.run('INSERT INTO sources VALUES(?,?,?,?)',source.id,jobId,digest,JSON.stringify(source));
      let created=0,reused=0;
      for (const raw of parsed.rows) {
        const normalized = normalizeRow(raw.values,v.mapping,c.start,c.end);
        let tx: Json | undefined;
        if(identicalSources.length){const sighting=this.row('SELECT tx.data FROM sightings s JOIN tx ON tx.id=s.tx_id WHERE s.source_id=? AND s.row_number=?',identicalSources[0].id,raw.line);if(sighting)tx=JSON.parse(sighting.data);}
        if (!tx && normalized.bankId && !normalized.error) {
          const priorId = this.rows('SELECT data FROM tx WHERE scope=? AND bank_id=?',this.scope(c),normalized.bankId).map(r=>JSON.parse(r.data));
          tx = priorId.find(p => !p.error && ['date','direction','amount','description','name','balance'].every(k=>p[k]===(normalized as any)[k]));
          if (priorId.length && !tx) {
            for (const priorTx of priorId) { if (!priorTx.flags.includes('bank-id-conflict')) priorTx.flags.push('bank-id-conflict'); this.put('tx',priorTx); }
          }
        }
        if (tx) reused++;
        else {
          const flags: string[]=[];
          if (normalized.error) flags.push('invalid-row');
          if (normalized.bankId && this.row('SELECT id FROM tx WHERE scope=? AND bank_id=?',this.scope(c),normalized.bankId)) flags.push('bank-id-conflict');
          if (!normalized.bankId && normalized.fingerprint) {
            const same = this.rows('SELECT data FROM tx WHERE scope=? AND fingerprint=?',this.scope(c),normalized.fingerprint).map(r=>JSON.parse(r.data));
            if (same.length) { flags.push('indistinguishable'); for (const p of same) { if (!p.flags.includes('indistinguishable')) p.flags.push('indistinguishable'); this.put('tx',p); } }
          }
          tx = { id:id(), scope:c, ...normalized, flags, acknowledgements:{}, match:null, approvals:{}, disposition:'review', journalState:'not-sent', registrationTaskId:null, createdAt:now() };
          this.run('INSERT INTO tx VALUES(?,?,?,?,?)',tx.id,this.scope(c),tx.bankId,tx.fingerprint,JSON.stringify(tx)); created++;
        }
        this.run('INSERT INTO sightings VALUES(?,?,?,?)',source.id,raw.line,tx.id,JSON.stringify({ raw:raw.values, rowNumber:raw.line, endLine:raw.endLine, normalized }));
      }
      this.audit(jobId,'source.imported',{ sourceId:source.id, hash:digest, created,reused, rowCount:parsed.rows.length });
      return { sourceId:source.id,repeated:false,created,reused };
    });
  }
  importMaster(jobId: string, bytes: Buffer, v: any) {
    this.mutable(jobId);
    const parsed=readCsv(bytes,v.encoding,v.headerRow);
    checkMapping(parsed.headers,v.mapping,['code','name']);
    const evidence=required(v.evidence,'取引先一覧の取得元'), actor=required(v.actor,'確認者');
    const acquiredAt=required(v.acquiredAt,'一覧の取得日時');
    if (!Number.isFinite(Date.parse(acquiredAt))) throw new InputError('一覧の取得日時が不正です');
    const entries: Json[]=[]; const codes=new Set<string>();
    for (const row of parsed.rows) {
      if (row.values.__csv_error) throw new InputError(`取引先一覧 ${row.line}行: 列数が一致しません`);
      const m=v.mapping, get=(k:string)=>m[k]?row.values[m[k]].trim():'';
      const code=required(get('code'),'取引先コード'), name=required(get('name'),'正式名称');
      if (codes.has(code)) throw new InputError(`取引先コードが重複しています: ${code}`);
      codes.add(code); entries.push({code,name,kana:get('kana'),address:get('address'),invoiceNumber:get('invoiceNumber'),legalId:get('legalId')});
    }
    const digest=this.keepOriginal(bytes);
    const master={id:id(),jobId,hash:digest,entries,evidence,actor,acquiredAt, importedAt:now(), mapping:v.mapping,encoding:v.encoding,headerRow:v.headerRow};
    return this.atomic(()=>{ this.run('INSERT INTO masters VALUES(?,?,?)',master.id,jobId,JSON.stringify(master)); this.audit(jobId,'master.imported',{masterId:master.id,hash:digest,count:entries.length,evidence,acquiredAt,actor}); return master; });
  }
  master(jobId:string): Json|null { const row=this.row('SELECT data FROM masters WHERE job_id=? ORDER BY rowid DESC LIMIT 1',jobId); return row?JSON.parse(row.data):null; }
  transactions(jobId:string):Json[] {
    this.get('jobs',jobId);
    return this.rows('SELECT DISTINCT tx.data FROM tx JOIN sightings s ON s.tx_id=tx.id JOIN sources f ON f.id=s.source_id WHERE f.job_id=? ORDER BY tx.rowid',jobId).map(r=>JSON.parse(r.data));
  }
  txInJob(jobId:string,txId:string):Json { const tx=this.transactions(jobId).find(t=>t.id===txId); if (!tx) throw new InputError('このジョブの明細ではありません'); return tx; }
  tasks(jobId:string) {
    const taskIds=new Set(this.transactions(jobId).map(t=>t.registrationTaskId).filter(Boolean));
    return [...taskIds].map(t=>this.get('tasks',t));
  }
  currentMatch(job:Json,tx:Json,master:Json|null):Json|null {
    if (!master) return null;
    const entries=master.entries;
    if (tx.match) {
      const entry=entries.find((e:Json)=>e.code===tx.match.code);
      if (entry && tx.match.entryHash===hash(JSON.stringify(entry))) return tx.match;
    }
    const aliases=this.rows('SELECT data FROM aliases WHERE scope=?',this.scope(job.context)).map(r=>JSON.parse(r.data));
    const matches=aliases.filter(a=>a.name===tx.name && a.direction===tx.direction && a.description===tx.description && entries.some((e:Json)=>e.code===a.code && hash(JSON.stringify(e))===a.entryHash));
    if (new Set(matches.map(a=>a.code)).size===1) return {...matches[0],source:'confirmed-alias'};
    return null;
  }
  analysis(jobId:string) {
    const job=this.get('jobs',jobId), master=this.master(jobId), tasks=this.tasks(jobId);
    const rules=this.rows('SELECT data FROM rules WHERE scope=?',this.scope(job.context)).map(r=>JSON.parse(r.data));
    const txs:Json[]=this.transactions(jobId).map(tx=>{
      const match=this.currentMatch(job,tx,master);
      const task=tasks.find(t=>t.id===tx.registrationTaskId);
      const code=match?.code ?? task?.code ?? null;
      const candidates=(master?.entries??[]).filter((e:Json)=>norm(e.name)===norm(tx.name) || (e.kana && norm(e.kana)===norm(tx.name))).map((e:Json)=>({...e,reason: norm(e.name)===norm(tx.name)?'名称の正規化が一致（確認が必要）':'カナが一致（法人確定の根拠にはできません）'}));
      const applicable=rules.filter(r=>r.code===code && r.direction===tx.direction && r.descriptionEquals===tx.description && r.bankAccount===job.context.account && (r.amount===undefined || r.amount===tx.amount));
      const rule=applicable.length===1?applicable[0]:null;
      const proposal=rule?{lines:[{debit:rule.debit,credit:rule.credit,amount:tx.amount,tax:rule.tax,counterpartyCode:code}],ruleId:rule.id,ruleVersion:rule.version,evidence:rule.evidence,confirmedBy:rule.confirmedBy}:null;
      const issues:string[]=[];
      if (tx.error) issues.push(tx.error);
      for (const flag of tx.flags) if (!tx.acknowledgements[flag]) issues.push(flag==='indistinguishable'?'IDのない同一内容の明細。別取引か重複か確認してください':flag==='bank-id-conflict'?'同じ銀行IDに異なる内容があります':'不正なCSV行');
      if (!master) issues.push('TKC取引先一覧が未取得');
      if (!code) issues.push(candidates.length?'既存取引先の候補を確認してください':'新規取引先の正式名称・所在地・識別子と出典が必要');
      if(task && master?.entries.some((e:Json)=>e.code===task.code||e.legalId===task.identity))issues.push('登録案のコードまたは法人番号が最新一覧に存在します。既存先との照合が必要です');
      if (!proposal) issues.push(applicable.length>1?'複数の仕訳ルールが競合しています':'確認済みの仕訳ルールがありません（手数料・分割等も要確認）');
      if (job.context.closeStatus!=='open') issues.push('対象月の締め状態が未確認、または締め済み');
      if (tx.journalState==='unknown') issues.push('仕訳の保存結果が不明です。再送せず照合してください');
      const rowHash=hash(JSON.stringify({context:job.context,tx:{date:tx.date,direction:tx.direction,amount:tx.amount,description:tx.description,name:tx.name,error:tx.error,flags:tx.flags,ack:tx.acknowledgements,disposition:tx.disposition,journalState:tx.journalState},match,task:task?{id:task.id,code:task.code,identity:task.identity,fields:task.fields,registrationState:task.registrationState}:null,issues,proposal}));
      const approved=tx.approvals[jobId]?.hash===rowHash;
      const status=tx.disposition==='excluded'?'excluded':tx.journalState==='done'?'done':tx.journalState==='unknown'?'unknown':approved?'approved':'review';
      const approvalInvalidated=Boolean(tx.approvals[jobId]&&!approved);
      return {...tx,match,code,candidates,registrationState:task?.registrationState??(match?'existing':'unresolved'),proposal,issues,rowHash,approved,status,approvalInvalidated,approvalReason:approvalInvalidated?'承認時の値・根拠・状態と異なります。変更履歴を確認し、この行を再承認してください':null};
    });
    const totals=(rows:Json[])=>({count:rows.length,in:rows.filter(t=>t.direction==='in').reduce((a,t)=>a+(t.amount??0),0),out:rows.filter(t=>t.direction==='out').reduce((a,t)=>a+(t.amount??0),0)});
    const byState=Object.fromEntries(['review','approved','excluded','unknown','done'].map(s=>[s,totals(txs.filter(t=>t.status===s))]));
    const sourceTotals=this.rows('SELECT s.data,s.source_id,s.row_number,s.tx_id FROM sightings s JOIN sources f ON f.id=s.source_id WHERE f.job_id=?',jobId).map(r=>({...JSON.parse(r.data),sourceId:r.source_id,txId:r.tx_id}));
    const balances=txs.filter(t=>t.balance!==null&&!t.error).map(t=>({txId:t.id,date:t.date,balance:t.balance}));
    return {job,master,tasks,transactions:txs,sources:this.rows('SELECT data FROM sources WHERE job_id=?',jobId).map(r=>JSON.parse(r.data)),sightings:sourceTotals,sourceTotals:totals(sourceTotals.map(s=>s.normalized??{})),invalidRowCount:txs.filter(t=>t.error).length,amountCoverage:txs.some(t=>t.error)?'partial-with-invalid-rows':'parsed-rows',audit:this.rows('SELECT * FROM audit WHERE job_id=? ORDER BY seq DESC LIMIT 200',jobId).map(r=>({...r,data:JSON.parse(r.data)})),rules,operations:this.rows('SELECT data FROM operations WHERE job_id=?',jobId).map(r=>JSON.parse(r.data)),totals:totals(txs),byState,sourceRowCount:sourceTotals.length,duplicateSightings:sourceTotals.length-txs.length,balances,completion:'preview-only',externalJournalCoverage:'unknown',balanceReconciliation:'not-verified',pending:txs.filter(t=>!['done','excluded'].includes(t.status)).length};
  }
  confirmMatch(jobId:string,txId:string,v:any) {
    const job=this.mutable(jobId),tx=this.txInJob(jobId,txId),master=this.master(jobId);
    if(tx.error||tx.journalState!=='not-sent')throw new InputError('不正・送信済みの明細は元データまたは保存結果の照合が必要です');
    const entry=master?.entries.find((e:Json)=>e.code===v.code); if (!entry) throw new InputError('取得したTKC一覧に存在しないコードです');
    const match={code:entry.code,entryHash:hash(JSON.stringify(entry)),evidence:required(v.evidence,'法人を確認した根拠'),actor:required(v.actor,'確認者'),at:now(),source:'manual'};
    return this.atomic(()=>{ tx.match=match;tx.registrationTaskId=null;this.put('tx',tx); if(v.remember===true) {
      const alias={id:id(),...match,name:tx.name,description:tx.description,direction:tx.direction};
      this.run('INSERT INTO aliases VALUES(?,?,?)',alias.id,this.scope(job.context),JSON.stringify(alias));
    } this.audit(jobId,'match.confirmed',{txId,...match,remember:v.remember===true}); return match; });
  }
  proposeNew(jobId:string,v:any) {
    const job=this.mutable(jobId),master=this.master(jobId); if(!master) throw new InputError('取引先一覧を取得してから登録案を作ってください');
    if(!Array.isArray(v.txIds)||!v.txIds.length) throw new InputError('関連する明細を選択してください');
    const txs=[...new Set<string>(v.txIds)].map(t=>this.txInJob(jobId,t));
    if(txs.some(t=>t.error||t.journalState!=='not-sent'||this.currentMatch(job,t,master))) throw new InputError('不正・既存照合済み・送信済みの明細には新規登録案を作れません');
    const code=required(v.code,'登録候補コード'),actor=required(v.actor,'確認者');
    const fields:Json={};
    for(const key of ['name','address','legalId']) fields[key]={value:required(v[key],key),evidence:required(v[key+'Evidence'],key+'の出典')};
    if(!/^\d{13}$/.test(fields.legalId.value)) throw new InputError('法人番号は13桁の文字列で指定してください。未確認なら候補を保留してください');
    if(v.invoiceNumber) { if(!/^T\d{13}$/.test(v.invoiceNumber)) throw new InputError('登録番号はTと13桁の文字列です'); fields.invoiceNumber={value:v.invoiceNumber,evidence:required(v.invoiceNumberEvidence,'登録番号の出典')}; }
    const identity=fields.legalId.value,scope=this.companyScope(job.context);
    if(master.entries.some((e:Json)=>e.code===code||e.legalId===identity)) throw new InputError('既存コードまたは法人番号です。既存取引先を確認してください');
    const oldRow=this.row('SELECT data FROM tasks WHERE scope=? AND identity=?',scope,identity); const old=oldRow?JSON.parse(oldRow.data):null;
    if(this.rows('SELECT data FROM tasks WHERE scope=?',scope).map(r=>JSON.parse(r.data)).some(t=>t.code===code&&t.identity!==identity)) throw new InputError('登録候補コードが競合しています');
    if(old&&(old.code!==code||JSON.stringify(old.fields)!==JSON.stringify(fields))) throw new InputError('同じ法人番号の既存登録案とコードまたは根拠が異なります');
    const task=old??{id:id(),identity,code,fields,actor,at:now(),registrationState:'not-sent'};
    return this.atomic(()=>{ if(!old)this.run('INSERT INTO tasks VALUES(?,?,?,?)',task.id,scope,identity,JSON.stringify(task)); for(const tx of txs){tx.registrationTaskId=task.id;tx.match=null;this.put('tx',tx);} this.audit(jobId,'registration.proposed',{taskId:task.id,txIds:txs.map(t=>t.id),actor}); return task; });
  }
  decide(jobId:string,txId:string,v:any) {
    this.mutable(jobId);const tx=this.txInJob(jobId,txId),evidence=required(v.evidence,'判断の根拠'),actor=required(v.actor,'確認者');
    if(tx.journalState!=='not-sent') throw new InputError('送信後の明細は照合が必要です');
    return this.atomic(()=>{ if(v.disposition){if(!['review','excluded'].includes(v.disposition))throw new InputError('不正な状態です');tx.disposition=v.disposition;tx.dispositionEvidence={evidence,actor,at:now()};} if(v.flag){if(!tx.flags.includes(v.flag)||v.flag==='invalid-row'||v.flag==='bank-id-conflict')throw new InputError('この問題は取込み元の確認が必要です');tx.acknowledgements[v.flag]={evidence,actor,at:now()};} this.put('tx',tx);this.audit(jobId,'tx.decided',{txId,...v,evidence,actor});return tx;});
  }
  addRule(jobId:string,v:any) {
    const job=this.mutable(jobId),code=required(v.code,'取引先コード');
    if(!this.analysis(jobId).transactions.some(t=>t.code===code))throw new InputError('確認済みの取引先コードを指定してください');
    if(!['in','out'].includes(v.direction))throw new InputError('入出金区分が不正です');
    if(v.amount!==undefined&&(!Number.isSafeInteger(v.amount)||v.amount<=0))throw new InputError('金額条件は正の整数です');
    const r:Rule={id:id(),code,direction:v.direction,descriptionEquals:required(v.descriptionEquals,'完全一致する摘要'),debit:required(v.debit,'借方科目'),credit:required(v.credit,'貸方科目'),bankAccount:job.context.account,tax:required(v.tax,'税区分'),version:id(),evidence:required(v.evidence,'科目・税区分の根拠'),confirmedBy:required(v.confirmedBy,'確認者'),...(v.amount===undefined?{}:{amount:v.amount})};
    if(r.debit===r.credit)throw new InputError('借方と貸方が同じです');
    return this.atomic(()=>{this.run('INSERT INTO rules VALUES(?,?,?)',r.id,this.scope(job.context),JSON.stringify(r));this.audit(jobId,'rule.confirmed',r);return r;});
  }
  plan(jobId:string,v:any) {
    this.mutable(jobId);const a=this.analysis(jobId); const actor=required(v.actor,'承認者');
    if(!Array.isArray(v.txIds)||!v.txIds.length)throw new InputError('承認する明細を選択してください');
    const rows=[...new Set<string>(v.txIds)].map(t=>{const tx=a.transactions.find(x=>x.id===t);if(!tx)throw new InputError('明細が見つかりません');if(tx.issues.length||tx.disposition==='excluded'||tx.journalState!=='not-sent')throw new InputError('要確認事項が残っています。承認できません');return tx;});
    const plan={id:id(),jobId,context:a.job.context,createdAt:now(),actor,mode:'preview-only',rows:rows.map(t=>({txId:t.id,rowHash:t.rowHash,bankId:t.bankId,date:t.date,amount:t.amount,direction:t.direction,description:t.description,bankAccount:a.job.context.account,code:t.code,proposal:t.proposal,registrationTaskId:t.registrationTaskId})),externalChecks:{screen:'unknown',pastJournals:'unknown',receivedBankRows:'unknown',concurrency:'unknown'}};
    const planWithHash={...plan,hash:hash(JSON.stringify(plan))};
    return this.atomic(()=>{this.run('INSERT INTO plans VALUES(?,?,?)',plan.id,jobId,JSON.stringify(planWithHash));for(const t of rows){const raw=this.get('tx',t.id);raw.approvals[jobId]={hash:t.rowHash,planId:plan.id,actor,at:plan.createdAt};this.put('tx',raw);}this.audit(jobId,'plan.approved',{planId:plan.id,hash:planWithHash.hash,actor,count:rows.length,mode:'preview-only'});return planWithHash;});
  }
  planStatus(planId:string) { const p=this.get('plans',planId),a=this.analysis(p.jobId);return {...p,rows:p.rows.map((r:Json)=>({...r,valid:a.transactions.find(t=>t.id===r.txId)?.rowHash===r.rowHash}))}; }
  pause(jobId:string,paused:boolean) { return this.atomic(()=>{const job=this.get('jobs',jobId);job.paused=paused;this.put('jobs',job);this.audit(jobId,paused?'job.paused':'job.resumed',{unknownOperations:this.rows('SELECT data FROM operations WHERE job_id=?',jobId).map(r=>JSON.parse(r.data)).filter(o=>o.state==='unknown').length});return job;}); }
  observe(jobId:string,observation:Json) { return this.atomic(()=>{const j=this.get('jobs',jobId);j.observed=observation;this.put('jobs',j);this.audit(jobId,'adapter.observed',observation);return observation;}); }
  original(jobId:string,sourceId:string):Buffer { const s=this.get('sources',sourceId);if(s.jobId!==jobId)throw new InputError('別ジョブの原本です');const bytes=fs.readFileSync(path.join(this.root,'originals',s.hash+'.csv'));if(hash(bytes)!==s.hash)throw new Error('原本破損を検出しました');return bytes; }
  masterOriginal(jobId:string):Buffer { const m=this.master(jobId);if(!m)throw new InputError('取引先一覧は未取得です');const bytes=fs.readFileSync(path.join(this.root,'originals',m.hash+'.csv'));if(hash(bytes)!==m.hash)throw new Error('一覧原本破損を検出しました');return bytes; }
  async backup(destination:string) { const dir=path.resolve(destination);if(dir===this.root||dir.startsWith(this.root+path.sep))throw new InputError('データディレクトリ外を指定してください');if(fs.existsSync(dir))throw new InputError('新しいバックアップ先を指定してください');fs.mkdirSync(dir,{recursive:true});const target=path.join(dir,'app.sqlite');await backup(this.db,target);fs.cpSync(path.join(this.root,'originals'),path.join(dir,'originals'),{recursive:true,errorOnExist:true,force:false});fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({version:1,at:now(),databaseHash:hash(fs.readFileSync(target)),originalHashes:fs.readdirSync(path.join(dir,'originals')).map(f=>({file:f,hash:hash(fs.readFileSync(path.join(dir,'originals',f)))}))},null,2));return dir; }
}
