import path from 'node:path';
import fs from 'node:fs';
import { Store } from './store.js';
import { seedDemo } from './demo.js';
import { UnconnectedTkcAdapter, executePlan } from './adapters.js';
import { handoffCsv } from './handoff.js';
import { privateDirectory, copyPrivateFile, copyPrivateOriginals } from './private-files.js';
const [command,...args]=process.argv.slice(2);
const store=new Store(process.env.DATA_DIR??'data');
try {
  let result:any;
  switch(command){
    case 'demo': result=seedDemo(store);break;
    case 'get_job_status': result=store.analysis(args[0]);break;
    case 'handoff_job': result=store.handoff(args[0]);break;
    case 'export_handoff': {
      if(!args[1])throw new Error('Specify a NEW local output file');
      fs.writeFileSync(args[1],handoffCsv(store.handoff(args[0])),{encoding:'utf8',flag:'wx',mode:0o600});
      result={file:path.resolve(args[1]),mode:'human-handoff',liveExecutionAvailable:false};break;
    }
    case 'pause_job': result=store.pause(args[0],true);break;
    case 'resume_job': store.observe(args[0],await new UnconnectedTkcAdapter().observe());result=store.pause(args[0],false);break;
    case 'reconcile_job': result=store.observe(args[0],await new UnconnectedTkcAdapter().observe());break;
    case 'plan_job': result=store.plan(args[0],JSON.parse(fs.readFileSync(args[1],'utf-8')));break;
    case 'execute_plan': executePlan();break;
    case 'backup': result={directory:await store.backup(args[0]??path.join('backups',new Date().toISOString().replace(/[:.]/g,'-')))};break;
    case 'restore': {
      const source=path.resolve(args[0]??''),destination=path.resolve(args[1]??'');
      if(!args[0]||!args[1]||fs.existsSync(destination)||destination===store.root||destination.startsWith(store.root+path.sep))throw new Error('Use an existing backup and a NEW directory outside active data');
      const manifest=JSON.parse(fs.readFileSync(path.join(source,'manifest.json'),'utf-8'));
      const {hash}=await import('./domain.js');
      if(manifest.version!==1||hash(fs.readFileSync(path.join(source,'app.sqlite')))!==manifest.databaseHash)throw new Error('Backup database hash mismatch');
      for(const item of manifest.originalHashes){if(!/^[a-f0-9]{64}\.csv$/.test(item.file)||hash(fs.readFileSync(path.join(source,'originals',item.file)))!==item.hash)throw new Error('Original hash mismatch');}
      privateDirectory(destination);copyPrivateFile(path.join(source,'app.sqlite'),path.join(destination,'app.sqlite'));copyPrivateOriginals(path.join(source,'originals'),path.join(destination,'originals'));
      const restored=new Store(destination);try{for(const j of restored.jobs()){restored.pause(j.id,true);restored.observe(j.id,{available:false,observedAt:new Date().toISOString(),reason:'復元後です。未確定結果は再送せずTKCで照合してください'});}}finally{restored.close();}result={directory:destination,paused:true};break;
    }
    default: result={commands:['demo','get_job_status <job-id>','handoff_job <job-id>','export_handoff <job-id> <new-output.csv>','plan_job <job-id> <approval.json>','pause_job <job-id>','resume_job <job-id>','reconcile_job <job-id>','execute_plan (P1 rejects)','backup [destination]','restore <backup> <new-directory>']};
  }
  console.log(JSON.stringify(result,null,2));
}catch(e){console.error(e instanceof Error?e.message:'Failed');process.exitCode=1;}finally{store.close();}
