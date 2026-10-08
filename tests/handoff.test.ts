import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import { Store } from '../src/store.js';
import { seedDemo } from '../src/demo.js';
import { buildHandoff, handoffCsv } from '../src/handoff.js';

function fixture(t:any) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'tkc-handoff-'));
  const store=new Store(root);
  t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});
  return {root,store,job:seedDemo(store)};
}
function response(item:any,extra:any={}) {
  return {itemId:item.id,contentHash:item.contentHash,owner:'reviewer',actor:'tester',
    status:'response-recorded',note:'Confirmed source evidence for human review',evidence:'synthetic invoice',...extra};
}
const identity={code:'0003',name:'株式会社模擬新規',nameEvidence:'synthetic invoice',address:'模擬所在地',addressEvidence:'synthetic invoice',legalId:'1000000000003',legalIdEvidence:'synthetic identity',actor:'tester'};

test('Handoff keeps original positions, invalid rows and separate same-day transactions',t=>{
  const {store,job}=fixture(t),a=store.analysis(job.id),report=store.handoff(job.id);
  assert.equal(report.liveExecutionAvailable,false);
  assert(report.items.some(i=>i.kind==='environment'&&i.priority==='urgent'));
  assert(!report.items.some(i=>i.txIds.includes(a.transactions[0].id)));
  for(const n of [3,4,8]) {
    const item=report.items.find(i=>i.id==='transaction:'+a.transactions[n].id)!;
    assert(item);assert.equal(item.sources[0].row,n+2);
    assert.equal(item.sources[0].endRow,n+2);assert.match(item.sources[0].hash,/^[a-f0-9]{64}$/);
  }
  assert.notEqual(report.items.find(i=>i.txIds.includes(a.transactions[3].id))!.id,
    report.items.find(i=>i.txIds.includes(a.transactions[4].id))!.id);
  assert(report.items.every(i=>i.resendAllowed===false));
});

test('One company registration handoff links two transactions with independent journal states',t=>{
  const {store,job}=fixture(t),txs=store.transactions(job.id).slice(1,3);
  store.proposeNew(job.id,{...identity,txIds:txs.map(t=>t.id)});
  const tasks=store.handoff(job.id).items.filter(i=>i.kind==='registration');
  assert.equal(tasks.length,1);assert.deepEqual(tasks[0].txIds,txs.map(t=>t.id));
  assert.equal(tasks[0].registrationState,'not-sent');
  assert.equal(store.analysis(job.id).transactions[1].journalState,'not-sent');
});

test('Responses can be recorded while paused, survive restart and never authorize or complete TKC work',t=>{
  const {store,root,job}=fixture(t),before=store.analysis(job.id),item=store.handoff(job.id).items.find(i=>i.kind==='transaction')!;
  store.pause(job.id,true);store.recordHandoff(job.id,response(item));
  const reopened=new Store(root);
  try {
    const report=reopened.handoff(job.id),a=reopened.analysis(job.id);
    assert.equal(report.paused,true);assert.equal(report.items.find(i=>i.id===item.id)!.response!.owner,'reviewer');
    assert.equal(report.summary.responsesAwaitingReview,1);
    assert.equal(a.byState.done.count,0);assert.equal(a.operations.length,0);
    assert.deepEqual(a.transactions.map(t=>[t.registrationState,t.journalState,t.approved]),before.transactions.map(t=>[t.registrationState,t.journalState,t.approved]));
    assert(a.audit.some(x=>x.action==='handoff.response-recorded'));
  } finally {reopened.close();}
});

test('Stale or cross-job answers are rejected; changed evidence invalidates a response but retains its history',t=>{
  const {store,job}=fixture(t),item=store.handoff(job.id).items.find(i=>i.kind==='transaction')!;
  store.recordHandoff(job.id,response(item));
  const other=seedDemo(store);assert.throws(()=>store.recordHandoff(other.id,response(item)));
  assert.throws(()=>store.recordHandoff(job.id,response(item,{contentHash:'stale'})));
  assert.throws(()=>store.recordHandoff(job.id,response(item,{evidence:''})));
  const tx=store.get('tx',item.txIds[0]);tx.journalState='unknown';store.put('tx',tx);
  const updated=store.handoff(job.id).items.find(i=>i.id===item.id)!;
  assert.notEqual(updated.contentHash,item.contentHash);assert.equal(updated.response,null);assert.equal(updated.history.length,1);
  assert.equal(updated.priority,'urgent');assert.equal(updated.resendAllowed,false);
  assert.throws(()=>store.recordHandoff(job.id,response(item)));
});

test('Unknown results remain in the queue even if a transaction is locally excluded',t=>{
  const {store,job}=fixture(t),a=store.analysis(job.id);
  const tx=store.get('tx',a.transactions[0].id);tx.disposition='excluded';tx.journalState='unknown';store.put('tx',tx);
  const operation={id:'synthetic-operation',state:'unknown',txId:tx.id};
  const report=buildHandoff({...store.analysis(job.id),operations:[operation]});
  const held=report.items.find(i=>i.id==='transaction:'+tx.id)!;
  assert.equal(held.priority,'urgent');assert.equal(held.resendAllowed,false);
  assert.equal(report.items.find(i=>i.id==='operation:synthetic-operation')!.resendAllowed,false);
  assert.equal(buildHandoff({...store.analysis(job.id),operations:[{...operation,state:'confirmed'}]}).items.some(i=>i.kind==='operation'),false);
});

test('CSV preserves multiline evidence and escapes spreadsheet formulas in human responses',t=>{
  const {store,job}=fixture(t),item=store.handoff(job.id).items[0];
  store.recordHandoff(job.id,response(item,{owner:' =HYPERLINK("bad")',note:'line one\nline "two", 三',evidence:'@external'}));
  const csv=handoffCsv(store.handoff(job.id));assert.equal(csv.charCodeAt(0),0xfeff);assert(csv.endsWith('\r\n'));
  const rows=parse(csv,{bom:true}) as string[][],row=rows.find(r=>r[0]===item.id)!;
  assert.equal(row[10],"'=HYPERLINK(\"bad\")");assert.equal(row[12],'line one\nline "two", 三');assert.equal(row[13],"'@external");
  assert.equal(rows.length,store.handoff(job.id).items.length+1);
  const report=store.handoff(job.id);report.items[0].title=' \t=external';
  assert.equal(parse(handoffCsv(report),{bom:true})[1][2],"' \t=external");
});
