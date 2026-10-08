const $=id=>document.getElementById(id);
let token='',jobId='',data=null,selected=new Set(),csvType='bank',csvBytes='',csvName='',activeTab='transactions';
const money=v=>v===null?'—':new Intl.NumberFormat('ja-JP').format(v)+'円';
const labels={review:'確認待ち',approved:'プレビュー承認',excluded:'アプリ内で保留・対象外',unknown:'保存結果不明',done:'計上完了','not-sent':'未送信',existing:'既存先',unresolved:'未確認'};
function el(tag,text,className){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n;}
function notice(message,error=false){$('notice').textContent=message;$('notice').className='notice'+(error?' error':'');document.querySelectorAll('.form-error').forEach(n=>n.remove());const dialog=document.querySelector('dialog[open]');if(error&&dialog){const p=el('p',message,'form-error');p.setAttribute('role','alert');dialog.querySelector('.dialog-actions').before(p);}}
async function api(url,body){const r=await fetch(url,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json','X-Local-Token':token},...(body===undefined?{}:{body:JSON.stringify(body)})});const v=await r.json();if(!r.ok)throw new Error(v.error||'処理を完了できません');return v;}
function safely(fn){return async e=>{e?.preventDefault();try{await fn(e);}catch(err){notice(err.message,true);}};}
function jobUrl(action=''){return '/api/jobs/'+jobId+(action?'/'+action:'');}
async function refreshJobs(){const jobs=await api('/api/jobs');$('job-list').replaceChildren(...jobs.map(j=>{const b=el('button',`${j.context.company}\n${j.context.start.slice(0,7)} · ${j.context.evidenceKind==='real'?'実データ':'模擬'}`,'job-item'+(j.id===jobId?' active':''));b.onclick=safely(()=>load(j.id));return b;}));}
async function load(id){jobId=id;selected.clear();$('select-all').checked=false;data=await api(jobUrl());await refreshJobs();render();}
function tab(name){activeTab=name;for(const panel of document.querySelectorAll('.tab-panel'))panel.hidden=panel.id!==name;for(const nav of document.querySelectorAll('[data-tab]'))nav.classList.toggle('active',nav.dataset.tab===name);}
function render(){
  $('empty').hidden=true;$('workspace').hidden=false;const c=data.job.context;
  $('context-company').textContent=c.company+' / '+c.account;$('context-period').textContent=c.start+' → '+c.end;
  $('context-kind').textContent=(c.evidenceKind==='real'?'実データ':'模擬データ')+' · '+({open:'未締め（利用者確認）',unknown:'締め未確認',closed:'締め済み'}[c.closeStatus]);
  document.querySelector('.context').classList.toggle('paused',data.job.paused);$('pause').textContent=data.job.paused?'再開':'中断';
  $('observation').textContent=(data.job.paused?'中断中。変更操作は停止しています。 ':'')+(data.job.observed?data.job.observed.reason||'観察済み: '+data.job.observed.evidence:'実画面・過去の仕訳・受信明細・残高照合は未確認です。')+' プレビュー承認ではTKCへの登録・計上を行いません。';
  $('stat-total').textContent=data.totals.count;$('source-count').textContent=`原本${data.sources.length}ファイル / ${data.sourceRowCount}行 / 重複照合で再利用${data.duplicateSightings}行`;
  $('stat-review').textContent=data.byState.review.count+data.byState.unknown.count;$('stat-tasks').textContent=data.tasks.length;$('stat-approved').textContent=data.byState.approved.count;
  $('report').href=jobUrl('report');$('report').setAttribute('download','preview-report.json');
  renderTransactions();renderTasks();renderHistory();
  $('state-totals').replaceChildren(...Object.entries(data.byState).map(([s,t])=>el('span',`${labels[s]} ${t.count}件 / 入${money(t.in)} / 出${money(t.out)}`,'state-row')));
  tab(activeTab);
}
function renderTransactions(){
  const filter=$('filter').value,txs=data.transactions.filter(t=>filter==='all'||t.status===filter);
  $('tx-body').replaceChildren(...txs.map(t=>{
    const tr=el('tr');tr.dataset.txId=t.id;const checkbox=el('input');checkbox.type='checkbox';checkbox.setAttribute('aria-label',`${t.description}を選択`);checkbox.checked=selected.has(t.id);checkbox.onchange=()=>{checkbox.checked?selected.add(t.id):selected.delete(t.id);selection();};
    const cell=el('td');cell.append(checkbox);tr.append(cell);
    const date=el('td',t.date||'日付エラー');date.append(el('small',t.bankId||'銀行IDなし'));for(const s of data.sightings.filter(s=>s.txId===t.id))date.append(el('small',`${data.sources.find(f=>f.id===s.sourceId)?.name||'原本'} ${s.rowNumber}行`));tr.append(date);
    const desc=el('td',t.description);desc.append(el('small',t.name));tr.append(desc);
    const amount=el('td',`${t.direction==='in'?'＋':t.direction==='out'?'−':''}${money(t.amount)}`,'amount '+t.direction);tr.append(amount);
    const match=el('td',t.code||'取引先未確認');match.append(el('small',labels[t.registrationState]||t.registrationState));if(t.candidates.length)match.append(el('small',`${t.candidates.length}件の候補: ${t.candidates.map(c=>c.name).join(' / ')}`));tr.append(match);
    const prop=el('td',t.proposal?`${t.proposal.lines[0].debit} / ${t.proposal.lines[0].credit}`:'ルール未確認');if(t.proposal)prop.append(el('small',t.proposal.lines[0].tax),el('small',t.proposal.evidence));prop.append(el('small','計上: '+(labels[t.journalState]||t.journalState)));tr.append(prop);
    const state=el('td');state.append(el('span',labels[t.status],'badge '+t.status));for(const issue of [...t.issues,...(t.approvalReason?[t.approvalReason]:[])])state.append(el('p',issue,'issue'));tr.append(state);return tr;
  }));
  if(!txs.length){const tr=el('tr'),td=el('td','この状態の明細はありません');td.colSpan=7;tr.append(td);$('tx-body').append(tr);}
  $('totals').textContent=`${data.totals.count}件 · 入金 ${money(data.totals.in)} · 出金 ${money(data.totals.out)} · 不正行 ${data.invalidRowCount}件${data.invalidRowCount?'（不正行を含むため金額集計は不完全）':''} · 未計上 ${data.pending}件 · プレビューのみ`;
  selection();
}
function selection(){$('selection-count').textContent=selected.size+'件選択';for(const name of ['match','rule','decision'])$(name).disabled=selected.size!==1;for(const name of ['new-counterparty','approve'])$(name).disabled=selected.size===0;}
function renderTasks(){
  $('task-list').replaceChildren(...data.tasks.map(task=>{const card=el('article',undefined,'task-card');card.append(el('h3',`${task.code} · ${task.fields.name.value}`),el('span','登録: '+(labels[task.registrationState]||task.registrationState),'badge'));const dl=el('dl');for(const [k,f] of Object.entries(task.fields)){dl.append(el('dt',({name:'正式名称',address:'所在地',legalId:'法人番号',invoiceNumber:'登録番号'}[k]||k)),el('dd',f.value+' / 出典: '+f.evidence));}card.append(dl,el('p',`関連明細 ${data.transactions.filter(t=>t.registrationTaskId===task.id).length}件 · 確認者 ${task.actor}`));return card;}));
  if(!data.tasks.length)$('task-list').append(el('div','明細を選択し、法人情報と出典を確認すると登録案をまとめられます。','task-card'));
}
function renderHistory(){
  $('source-list').replaceChildren(...data.sources.map(s=>{const card=el('div',undefined,'source-card');card.append(el('strong',`${s.name} · ${s.rows}行 · ${s.encoding}`),el('small',' SHA-256: '+s.hash));const a=el('a',' 原本を保存 ↓','text-link');a.href=jobUrl(`sources/${s.id}/original`);card.append(a);return card;}));
  if(data.master){const m=data.master,card=el('div',undefined,'source-card');card.append(el('strong',`取引先一覧 ${m.entries.length}件`),el('p',`出典: ${m.evidence} / 取得日時: ${m.acquiredAt} / 確認者: ${m.actor}`));const a=el('a','一覧の原本を保存 ↓','text-link');a.href=jobUrl('master/original');card.append(a);$('source-list').append(card);}
  $('history-list').replaceChildren(...data.audit.map(a=>{const row=el('div',undefined,'history-row');row.append(el('span',new Date(a.at).toLocaleString('ja-JP')),el('strong',a.action),el('code',JSON.stringify(a.data)));return row;}));
}
function field(name,label,value='',options){const lab=el('label',label),input=el(options?'select':'input');input.name=name;input.required=true;if(options)for(const [v,t] of options){const op=el('option',t);op.value=v;input.append(op);}input.value=value;lab.append(input);$('action-fields').append(lab);return input;}
let actionHandler=null;
function action(title,description,setup,handler){$('action-title').textContent=title;$('action-description').textContent=description;$('action-fields').replaceChildren();setup();actionHandler=handler;$('action-dialog').showModal();}
function chosen(){return data.transactions.filter(t=>selected.has(t.id));}
for(const b of document.querySelectorAll('[data-close]'))b.onclick=()=>b.closest('dialog').close();
for(const nav of document.querySelectorAll('[data-tab]'))nav.onclick=()=>tab(nav.dataset.tab);
const demo=safely(async()=>{const j=await api('/api/demo',{});await load(j.id);notice('模擬データ10件を作成しました。実データの検証とは分けて扱います。');});$('demo').onclick=demo;$('empty-demo').onclick=demo;
$('create-job').onclick=()=>$('job-dialog').showModal();
$('job-form').onsubmit=safely(async e=>{const j=await api('/api/jobs',Object.fromEntries(new FormData(e.target)));$('job-dialog').close();await load(j.id);notice('処理ジョブを作成しました。');});
$('filter').onchange=renderTransactions;
$('select-all').onchange=()=>{for(const t of data.transactions.filter(t=>$('filter').value==='all'||t.status===$('filter').value))$('select-all').checked?selected.add(t.id):selected.delete(t.id);renderTransactions();};
function openCsv(type){csvType=type;csvBytes='';$('csv-form').reset();$('csv-title').textContent=type==='bank'?'GMO入出金CSVの取込み':'TKC取引先一覧の取込み';$('csv-preview').replaceChildren();$('csv-mapping').replaceChildren();$('csv-submit').disabled=true;$('master-evidence').hidden=type!=='master';$('csv-dialog').showModal();}
$('import-bank').onclick=()=>openCsv('bank');$('import-master').onclick=()=>openCsv('master');
for(const n of ['csv-file','csv-encoding','csv-header'])$(n).onchange=()=>{$('csv-submit').disabled=true;csvBytes='';$('csv-mapping').replaceChildren();};
$('inspect-csv').onclick=safely(async()=>{
  const file=$('csv-file').files[0];if(!file)throw new Error('CSVファイルを選択してください');if(file.size>10*1024*1024)throw new Error('CSVは10MBまでです');csvName=file.name;const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));csvBytes=btoa(binary);
  const p=await api('/api/csv/inspect',{base64:csvBytes,encoding:$('csv-encoding').value,headerRow:Number($('csv-header').value)});$('csv-preview').replaceChildren(el('p',`${p.rowCount}行。先頭5行を表示します。文字化けと列の対応を確認してください。`));const table=el('table'),head=el('tr');for(const h of p.headers)head.append(el('th',h));table.append(head);for(const row of p.sample){const tr=el('tr');for(const h of p.headers)tr.append(el('td',row.values[h]));table.append(tr);}const wrap=el('div',undefined,'preview-data');wrap.append(table);$('csv-preview').append(wrap);
  const fields=csvType==='bank'?[['date','日付',true],['description','摘要',true],['deposit','入金額',true],['withdrawal','出金額',true],['bankId','銀行明細ID'],['counterparty','名義'],['balance','残高'],['currency','通貨（JPYのみ）']]:[['code','取引先コード',true],['name','正式名称',true],['kana','カナ'],['address','所在地'],['legalId','法人番号'],['invoiceNumber','インボイス登録番号']];
  $('csv-mapping').replaceChildren(...fields.map(([k,title,needed])=>{const lab=el('label',title+(needed?' *':'')),select=el('select');select.name=k;select.required=Boolean(needed);const empty=el('option','未指定');empty.value='';select.append(empty);for(const h of p.headers){const option=el('option',h);option.value=h;select.append(option);}lab.append(select);return lab;}));$('csv-submit').disabled=false;
});
$('csv-form').onsubmit=safely(async()=>{const mapping={};for(const s of $('csv-mapping').querySelectorAll('select'))if(s.value)mapping[s.name]=s.value;const body={name:csvName,base64:csvBytes,encoding:$('csv-encoding').value,headerRow:Number($('csv-header').value),mapping};if(csvType==='master')Object.assign(body,{evidence:$('master-source').value,actor:$('master-actor').value,acquiredAt:$('master-date').value?new Date($('master-date').value).toISOString():''});const result=await api(jobUrl(csvType),body);$('csv-dialog').close();await load(jobId);notice(result.repeated?'同じ原本の再取込みを記録しました。明細は増えていません。':'原本と取込み結果を保存しました。');});
$('match').onclick=()=>{const t=chosen()[0];action('既存取引先の確認','請求書等の法人情報で確認してください。名称・カナの一致だけでは確定しません。',()=>{field('code','TKC取引先',t.code||'',[['','選択してください'],...(data.master?.entries||[]).map(e=>[e.code,e.code+' · '+e.name])]);field('evidence','法人を確認した根拠');field('actor','確認者');const lab=el('label',undefined,'checkbox-label'),cb=el('input');cb.type='checkbox';cb.name='remember';lab.append(cb,document.createTextNode('同じ口座・名義・区分・摘要の確認済み対応を保存'));$('action-fields').append(lab);},v=>api(jobUrl('match'),{...v,remember:v.remember==='on',txId:t.id}));};
$('new-counterparty').onclick=()=>{const txs=chosen();action('新規取引先を集約',`${txs.length}件の明細を、確認済みの同じ法人に紐付けます。法人番号が未確認の個人・任意団体はこの版では保留してください。`,()=>{for(const [n,l] of [['code','登録候補コード（文字列）'],['name','正式名称'],['nameEvidence','正式名称の出典'],['address','所在地'],['addressEvidence','所在地の出典'],['legalId','法人番号（13桁）'],['legalIdEvidence','法人番号の出典'],['invoiceNumber','インボイス登録番号（任意）'],['invoiceNumberEvidence','登録番号の出典（入力時は必須）'],['actor','確認者']]){const f=field(n,l);if(n.startsWith('invoice'))f.required=false;}},v=>api(jobUrl('new-counterparty'),{...v,txIds:txs.map(t=>t.id)}));};
$('rule').onclick=()=>{const t=chosen()[0];action('確認済み仕訳ルール','1明細1仕訳のプレビューです。借方・貸方・税区分は過去の仕訳や証憑等の根拠を指定してください。分割・手数料等は要確認のままにします。',()=>{field('code','取引先コード',t.code||'');field('direction','入出金区分',t.direction||'in',[['in','入金'],['out','出金']]);field('descriptionEquals','完全一致する摘要',t.description);field('amount','金額条件（任意）').required=false;field('debit','借方科目');field('credit','貸方科目');field('tax','税区分');field('evidence','科目・税区分の根拠');field('confirmedBy','確認者');},v=>api(jobUrl('rules'),{...v,amount:v.amount?Number(v.amount):undefined}));};
$('decision').onclick=()=>{const t=chosen()[0];action('要確認事項の判断','アプリ内の保留・対象外です。TKCの「計上対象外」には変更しません。同内容の明細を別取引と判断する場合は証拠を残してください。',()=>{field('choice','判断','review',[['review','確認待ちへ戻す'],['excluded','アプリ内で保留・対象外'],...t.flags.filter(f=>f==='indistinguishable').map(f=>[f,'同内容でも別取引と確認'])]);field('evidence','判断の根拠');field('actor','確認者');},v=>api(jobUrl('decision'),{txId:t.id,evidence:v.evidence,actor:v.actor,...(v.choice==='indistinguishable'?{flag:v.choice}:{disposition:v.choice})}));};
$('approve').onclick=()=>{const txs=chosen();action('プレビューを承認',`${txs.length}件の計画・根拠・内容ハッシュを保存します。TKCへの送信は行いません。変更すると該当明細の承認は無効になります。`,()=>field('actor','承認者'),v=>api(jobUrl('plans'),{...v,txIds:txs.map(t=>t.id)}));};
$('action-form').onsubmit=safely(async e=>{await actionHandler(Object.fromEntries(new FormData(e.target)));$('action-dialog').close();await load(jobId);notice('確認内容と操作履歴を保存しました。TKCには書き込んでいません。');});
$('pause').onclick=safely(async()=>{const paused=data.job.paused;await api(jobUrl(paused?'resume':'pause'),{});await load(jobId);notice(paused?'ローカル処理を再開しました。TKCの未確認事項は残っています。':'中断しました。原本・明細・確認内容は保存されています。');});
$('observe').onclick=safely(async()=>{await api(jobUrl('observe'),{});await load(jobId);notice('接続状況を記録しました。');});
safely(async()=>{const boot=await api('/api/bootstrap');token=boot.token;await refreshJobs();if(boot.jobs.length)await load(boot.jobs[0].id);})();
