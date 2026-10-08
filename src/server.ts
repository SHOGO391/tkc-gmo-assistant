import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Store } from './store.js';
import { InputError, readCsv } from './domain.js';
import { UnconnectedTkcAdapter, type TkcReadAdapter } from './adapters.js';
import { seedDemo } from './demo.js';
import { handoffCsv } from './handoff.js';

export function createApp(store:Store,adapter:TkcReadAdapter=new UnconnectedTkcAdapter()) {
  const app=express();const token=randomBytes(32).toString('hex');
  app.disable('x-powered-by');
  app.use((req,res,next)=>{
    const port=req.socket.localPort;
    const allowed=[`127.0.0.1:${port}`,`localhost:${port}`];
    if(!allowed.includes(req.headers.host??'')) {res.status(403).json({error:'許可されていない接続先です'});return;}
    res.set({'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Cache-Control':'no-store','Referrer-Policy':'no-referrer'});
    const origin=req.headers.origin;
    if(origin&&!allowed.some(h=>origin===`http://${h}`)){res.status(403).json({error:'別サイトからの操作は許可されません'});return;}
    if(!['GET','HEAD'].includes(req.method)){
      const supplied=req.headers['x-local-token'];
      if(!req.is('application/json')||typeof supplied!=='string'||supplied.length!==token.length||!timingSafeEqual(Buffer.from(supplied),Buffer.from(token))){res.status(403).json({error:'ローカル操作の確認情報がありません'});return;}
    }
    next();
  });
  app.use(express.json({limit:'15mb'}));
  const bytes=(v:any)=>{if(typeof v.base64!=='string'||!v.base64||!/^[A-Za-z0-9+/]*={0,2}$/.test(v.base64))throw new InputError('CSVファイルが必要です');const b=Buffer.from(v.base64,'base64');if(!b.length||b.length>10*1024*1024)throw new InputError('CSVは1バイトから10MBです');return b;};
  const key=(v:unknown)=>String(v);
  app.get('/api/bootstrap',(_req,res)=>res.json({token,mode:'P1 preview',jobs:store.jobs()}));
  app.get('/api/jobs',(_req,res)=>res.json(store.jobs()));
  app.post('/api/jobs',(req,res)=>res.json(store.createJob(req.body)));
  app.post('/api/demo',(_req,res)=>res.json(seedDemo(store)));
  app.post('/api/csv/inspect',(req,res)=>{const parsed=readCsv(bytes(req.body),req.body.encoding,req.body.headerRow);res.json({headers:parsed.headers,sample:parsed.rows.slice(0,5),rowCount:parsed.rows.length});});
  app.get('/api/jobs/:jobId',(req,res)=>res.json(store.analysis(key(req.params.jobId))));
  app.get('/api/jobs/:jobId/report',(req,res)=>{res.set('Content-Disposition','attachment; filename="preview-report.json"');res.json(store.analysis(key(req.params.jobId)));});
  app.get('/api/jobs/:jobId/handoff',(req,res)=>res.json(store.handoff(key(req.params.jobId))));
  app.get('/api/jobs/:jobId/handoff.csv',(req,res)=>{res.set({'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="human-handoff.csv"'});res.send(handoffCsv(store.handoff(key(req.params.jobId))));});
  app.post('/api/jobs/:jobId/handoff',(req,res)=>res.json(store.recordHandoff(key(req.params.jobId),req.body)));
  app.get('/api/jobs/:jobId/master/original',(req,res)=>{res.set({'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="master-original.csv"'});res.send(store.masterOriginal(key(req.params.jobId)));});
  app.get('/api/jobs/:jobId/sources/:sourceId/original',(req,res)=>{res.set({'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="original.csv"'});res.send(store.original(key(req.params.jobId),key(req.params.sourceId)));});
  app.post('/api/jobs/:jobId/bank',(req,res)=>res.json(store.importBank(key(req.params.jobId),bytes(req.body),req.body)));
  app.post('/api/jobs/:jobId/master',(req,res)=>res.json(store.importMaster(key(req.params.jobId),bytes(req.body),req.body)));
  app.post('/api/jobs/:jobId/match',(req,res)=>res.json(store.confirmMatch(key(req.params.jobId),req.body.txId,req.body)));
  app.post('/api/jobs/:jobId/new-counterparty',(req,res)=>res.json(store.proposeNew(key(req.params.jobId),req.body)));
  app.post('/api/jobs/:jobId/decision',(req,res)=>res.json(store.decide(key(req.params.jobId),req.body.txId,req.body)));
  app.post('/api/jobs/:jobId/rules',(req,res)=>res.json(store.addRule(key(req.params.jobId),req.body)));
  app.post('/api/jobs/:jobId/plans',(req,res)=>res.json(store.plan(key(req.params.jobId),req.body)));
  app.get('/api/plans/:planId',(req,res)=>res.json(store.planStatus(key(req.params.planId))));
  app.post('/api/jobs/:jobId/pause',(req,res)=>res.json(store.pause(key(req.params.jobId),true)));
  app.post('/api/jobs/:jobId/resume',async(req,res)=>{
    const jobId=key(req.params.jobId);const j=store.get('jobs',jobId);
    store.observe(jobId,await adapter.observe(j.context));res.json(store.pause(jobId,false));
  });
  app.post('/api/jobs/:jobId/observe',async(req,res)=>res.json(store.observe(key(req.params.jobId),await adapter.observe(store.get('jobs',key(req.params.jobId)).context))));
  app.post('/api/jobs/:jobId/execute',(_req,res)=>res.status(403).json({error:'P1はTKC書込み0件のプレビュー専用です'}));
  const moduleDir=path.dirname(fileURLToPath(import.meta.url));
  const webRoot=path.resolve(moduleDir,fs.existsSync(path.resolve(moduleDir,'../package.json'))?'../web':'../../web');
  app.use(express.static(webRoot));
  app.use((_req,res)=>res.status(404).json({error:'対象が見つかりません'}));
  app.use((err:any,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{const expected=err instanceof InputError;res.status(expected?400:500).json({error:expected?err.message:'処理を完了できませんでした。入力形式とローカル環境を確認してください'});});
  return app;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const store=new Store(process.env.DATA_DIR??'data');
  const port=Number(process.env.PORT??4317);if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid PORT');
  const server=createApp(store).listen(port,'127.0.0.1',()=>console.log(`P1 preview: http://127.0.0.1:${port}`));
  const stop=()=>server.close(()=>{store.close();process.exit(0);});process.on('SIGINT',stop);process.on('SIGTERM',stop);
}
