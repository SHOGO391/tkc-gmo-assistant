import type { Page } from 'playwright';
import type { JobContext } from './domain.js';

export interface AdapterObservation {
  available: boolean; observedAt: string; company?: string; account?: string;
  authenticated?: boolean; closeStatus?: 'open' | 'closed' | 'unknown';
  evidence?: string; reason?: string;
}
// P1 exposes observations only. Write methods are deliberately absent from this contract.
export interface TkcReadAdapter { observe(context: JobContext): Promise<AdapterObservation> }
export class UnconnectedTkcAdapter implements TkcReadAdapter {
  async observe(): Promise<AdapterObservation> {
    return { available: false, observedAt: new Date().toISOString(), reason: '実画面・既存仕訳・保存結果は未接続です' };
  }
}
export interface ObservedScreenContract {
  verifiedAt: string; evidence: string; allowedOrigin: string;
  companySelector: string; accountSelector: string; authenticatedSelector: string;
  openMonthSelector: string;
}
// Selectors MUST be provided from an observed screen. There are no bundled TKC selectors.
export class PlaywrightReadAdapter implements TkcReadAdapter {
  constructor(private page: Page, private contract: ObservedScreenContract) {}
  async observe(context: JobContext): Promise<AdapterObservation> {
    const observedAt = new Date().toISOString();
    const c = this.contract;
    try {
      if (!c.verifiedAt || !c.evidence || new URL(this.page.url()).origin !== c.allowedOrigin) {
        return { available: false, observedAt, reason: '未確認の画面または許可外のURLです' };
      }
      const authenticated = await this.page.locator(c.authenticatedSelector).count() === 1;
      const company = (await this.page.locator(c.companySelector).innerText({ timeout: 1500 })).trim();
      const account = (await this.page.locator(c.accountSelector).innerText({ timeout: 1500 })).trim();
      const openMonth = (await this.page.locator(c.openMonthSelector).innerText({ timeout: 1500 })).trim();
      if (!authenticated || company !== context.company || account !== context.account || openMonth !== context.start.slice(0, 7)) {
        return { available: false, authenticated, company, account, observedAt, reason: 'ログイン・会社・口座・締め状態の確認が一致しません' };
      }
      return { available: true, authenticated, company, account, observedAt, closeStatus: 'open', evidence: c.evidence };
    } catch { return { available: false, observedAt, reason: '画面構造または権限を確認できません' }; }
  }
}
export function executePlan(): never { throw new Error('P1プレビュー版ではTKC書込みを実装していません'); }
