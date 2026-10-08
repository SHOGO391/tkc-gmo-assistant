import { canonicalJson, InputError } from './domain.js';

/** P2のための純粋な照合判定。ネットワーク送信やDBの完了更新は行わない。 */
export function reconcileOperation(intent: Record<string,unknown>, results: Record<string,unknown>[], coverage: 'verified'|'unknown') {
  if(coverage!=='verified')return {state:'unknown',retryAllowed:false,reason:'照合対象の網羅性が未確認'};
  const matches=results.filter(r=>canonicalJson(r)===canonicalJson(intent));
  if(matches.length===1)return {state:'confirmed',retryAllowed:false,reason:'計画の全項目に一致する結果が1件'};
  return {state:'unknown',retryAllowed:false,reason:matches.length?'一致結果が複数':'一致する結果が未取得。不存在と判断して再送しない'};
}
export function assertNoResend(state:string) { if(['intent','sent','unknown','confirmed'].includes(state))throw new InputError('結果照合が完了するまで書込みを再送できません'); }
