import {test,expect} from 'playwright/test';
import {demoBank} from '../../src/demo.js';
test('P1 browser workflow: demo, new identity aggregation, approve, pause and reload',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await page.getByRole('button',{name:'模擬データで試す',exact:true}).click();await expect(page.locator('#stat-total')).toHaveText('10');
  await expect(page.locator('#tx-body tr')).toHaveCount(10);
  const rows=page.locator('#tx-body tr');await rows.nth(1).getByRole('checkbox').check();await rows.nth(2).getByRole('checkbox').check();await page.getByRole('button',{name:'新規先を集約',exact:true}).click();
  const values={code:'0003',name:'株式会社模擬新規',nameEvidence:'模擬請求書 2,3',address:'模擬所在地',addressEvidence:'模擬請求書 2,3',legalId:'1000000000003',legalIdEvidence:'模擬法人確認',actor:'browser-tester'};
  for(const [key,value] of Object.entries(values))await page.locator(`#action-form [name=${key}]`).fill(value);
  await page.getByRole('button',{name:'確認内容を保存',exact:true}).click();await expect(page.locator('#stat-tasks')).toHaveText('1');
  await page.getByRole('button',{name:'取引先登録案',exact:true}).click();await expect(page.locator('#task-list')).toContainText('関連明細 2件');await expect(page.locator('#task-list')).toContainText('登録: 未送信');
  await page.getByRole('button',{name:'明細・仕訳案',exact:true}).click();await page.locator('#tx-body tr').first().getByRole('checkbox').check();await page.getByRole('button',{name:'プレビューを承認',exact:true}).click();await page.locator('#action-form [name=actor]').fill('browser-tester');await page.getByRole('button',{name:'確認内容を保存',exact:true}).click();await expect(page.locator('#stat-approved')).toHaveText('1');
  await page.getByRole('button',{name:'中断',exact:true}).click();await expect(page.getByRole('button',{name:'再開',exact:true})).toBeVisible();await page.reload();await expect(page.getByRole('button',{name:'再開',exact:true})).toBeVisible();await expect(page.locator('#stat-approved')).toHaveText('1');await page.getByRole('button',{name:'再開',exact:true}).click();await expect(page.getByRole('button',{name:'中断',exact:true})).toBeVisible();
  await page.screenshot({path:'test-results/preview-desktop.png',fullPage:true});assertEmpty(errors);
});
function assertEmpty(errors:string[]){expect(errors).toEqual([]);}
test('CSV mapping and identical reimport through UI',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'模擬データで試す',exact:true}).click();await expect(page.locator('#stat-total')).toHaveText('10');await page.getByRole('button',{name:'GMO CSVを取り込む',exact:true}).click();
  await page.locator('#csv-file').setInputFiles({name:'same-synthetic.csv',mimeType:'text/csv',buffer:Buffer.from(demoBank)});await page.getByRole('button',{name:'列を読み取る',exact:true}).click();
  for(const [key,value] of Object.entries({date:'Date',description:'Description',deposit:'Deposit',withdrawal:'Withdrawal',bankId:'ID',counterparty:'Name',balance:'Balance'}))await page.locator(`#csv-mapping [name=${key}]`).selectOption(value);
  await page.getByRole('button',{name:'原本を保存して取り込む',exact:true}).click();await expect(page.locator('#notice')).toContainText('明細は増えていません');await expect(page.locator('#stat-total')).toHaveText('10');
});
test('HTTP boundary denies cross origin and writes; direct P1 execute is rejected',async({request,page})=>{
  await page.goto('/');const bootstrap=await request.get('/api/bootstrap'),b=await bootstrap.json();const j=await request.post('/api/demo',{headers:{'x-local-token':b.token},data:{}});const job=await j.json();
  const bad=await request.post(`/api/jobs/${job.id}/execute`,{headers:{'x-local-token':b.token},data:{}});expect(bad.status()).toBe(403);
  const csrf=await request.post('/api/demo',{headers:{'x-local-token':b.token,origin:'https://attacker.invalid'},data:{}});expect(csrf.status()).toBe(403);
  const missing=await request.post('/api/demo',{data:{}});expect(missing.status()).toBe(403);
  const host=await request.get('/api/bootstrap',{headers:{host:'attacker.invalid'}});expect(host.status()).toBe(403);
  const a=await(await request.get(`/api/jobs/${job.id}`)).json();expect(a.operations).toEqual([]);expect(a.byState.done.count).toBe(0);
});
test('Observed browser adapter fails closed for mismatched account/login/screen',async({page})=>{
  const {PlaywrightReadAdapter}=await import('../../src/adapters.js');
  await page.goto('/');await page.evaluate(()=>{document.body.innerHTML='<div id="login">ok</div><div id="company">DEMO</div><div id="account">BANK</div><div id="month">2026-10</div>';});
  const contract={verifiedAt:'2026-10-08',evidence:'synthetic DOM fixture, not TKC',allowedOrigin:'http://127.0.0.1:4319',companySelector:'#company',accountSelector:'#account',authenticatedSelector:'#login',openMonthSelector:'#month'};
  const adapter=new PlaywrightReadAdapter(page,contract),ctx={company:'DEMO',account:'BANK',start:'2026-10-01',end:'2026-10-31',evidenceKind:'synthetic' as const,closeStatus:'open' as const};
  expect((await adapter.observe(ctx)).available).toBe(true);expect((await adapter.observe({...ctx,account:'WRONG'})).available).toBe(false);await page.locator('#login').evaluate(e=>e.remove());expect((await adapter.observe(ctx)).available).toBe(false);expect((await new PlaywrightReadAdapter(page,{...contract,evidence:''}).observe(ctx)).available).toBe(false);
});
