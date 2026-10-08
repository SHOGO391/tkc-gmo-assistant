import { Store } from './store.js';
import { id } from './domain.js';
export const bankMapping={bankId:'ID',date:'Date',description:'Description',counterparty:'Name',deposit:'Deposit',withdrawal:'Withdrawal',balance:'Balance'};
export const demoBank=`ID,Date,Description,Name,Deposit,Withdrawal,Balance
demo-01,2026/10/01,請求書 DEMO-1 入金,株式会社デモ商事,12000,,112000
demo-02,2026/10/02,請求書 DEMO-2 入金,カ）サンプル,25000,,137000
demo-03,2026/10/03,請求書 DEMO-3 入金,ｶ)ｻﾝﾌﾟﾙ,30000,,167000
demo-04,2026/10/04,委託費 DEMO-4,株式会社別会社,,5000,162000
demo-05,2026/10/04,委託費 DEMO-4,株式会社別会社,,5000,157000
,2026/10/05,同内容の振込,カ）ミカクニン,6000,,163000
,2026/10/05,同内容の振込,カ）ミカクニン,6000,,169000
demo-08,2026/10/06,分割・手数料の確認が必要,カ）サンプル,9970,,178970
demo-09,2026/10/07,不正金額の模擬行,テスト,12.5,,178982
demo-10,2026/10/08,口座間振替 DEMO-10,自己口座,,2000,176970
`;
export const demoMaster=`Code,Name,Kana,Address,LegalId,Invoice
0001,株式会社デモ商事,カ）デモシヨウジ,模擬所在地（実在情報ではありません）,1000000000001,T1000000000001
0002,株式会社別会社,カ）ベツガイシヤ,模擬所在地（実在情報ではありません）,1000000000002,T1000000000002
00000000000000000009,株式会社長いコード,ナガイコード,模擬所在地（実在情報ではありません）,1000000000009,T1000000000009
`;
export function seedDemo(store:Store) {
  // Each demo is an isolated company, so previous practice cannot change a fresh demo.
  const job=store.createJob({company:'DEMO-'+id().slice(0,8),account:'DEMO-GMO-001',start:'2026-10-01',end:'2026-10-31',evidenceKind:'synthetic',closeStatus:'open'});
  store.importBank(job.id,Buffer.from(demoBank),{name:'synthetic-gmo.csv',encoding:'utf-8',headerRow:1,mapping:bankMapping});
  store.importMaster(job.id,Buffer.from(demoMaster),{encoding:'utf-8',headerRow:1,mapping:{code:'Code',name:'Name',kana:'Kana',address:'Address',legalId:'LegalId',invoiceNumber:'Invoice'},evidence:'同梱の模擬取引先一覧（TKCの実出力ではありません）',actor:'demo',acquiredAt:'2026-10-08T00:00:00Z'});
  const tx=store.transactions(job.id)[0];
  store.confirmMatch(job.id,tx.id,{code:'0001',evidence:'模擬請求書 DEMO-1 の法人情報で照合',actor:'demo'});
  store.addRule(job.id,{code:'0001',direction:'in',descriptionEquals:tx.description,debit:'普通預金（模擬口座）',credit:'売掛金（模擬）',tax:'対象外（模擬請求書の回収）',evidence:'模擬の売掛金回収ルール。実務に転用しない',confirmedBy:'demo'});
  return job;
}
