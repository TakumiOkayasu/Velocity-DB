import * as S from '../schemas';
import type { BridgeLogger, IpcInvoker, ResponseValidator } from './types';

// ============================================================================
// Bookmark (getBookmarks)
// ============================================================================

export interface Bookmark {
  id: string;
  name: string;
  content: string;
}

// ============================================================================
// Provider IF
// ============================================================================

export interface IoProvider {
  writeFrontendLog(content: string): Promise<void>;
  saveQueryToFile(content: string, defaultFileName?: string): Promise<{ filePath: string }>;
  loadQueryFromFile(): Promise<{ filePath: string; content: string }>;
  browseFile(filter?: string): Promise<{ filePath: string }>;
  getBookmarks(): Promise<Bookmark[]>;
  saveBookmark(id: string, name: string, content: string): Promise<void>;
  deleteBookmark(id: string): Promise<void>;
}

class IoProviderImpl implements IoProvider {
  constructor(
    private readonly invoker: IpcInvoker,
    // 共通シグネチャ維持 (#517 軸③): 現状未使用だが将来 log.info 等を実利用するため
    private readonly logger: BridgeLogger,
    private readonly validator: ResponseValidator
  ) {
    void this.logger; // TS6138 抑制: 共通シグネチャ維持のため未使用受け取りを許可
  }

  async writeFrontendLog(content: string): Promise<void> {
    // 呼出側不在の dead method (utils/logger.ts は #556 で window.invoke 直叩き化、
    // 他に直接呼ぶ consumer なし)。Issue #526 の facade 完全性のため残置。
    // 将来 logger 以外から構造化ログ送出が必要になった際の入口として機能する。
    // schema は zVoid のため parse を省略 (transaction.ts と同方針)。
    await this.invoker.invoke('writeFrontendLog', { content });
  }

  async saveQueryToFile(content: string, defaultFileName?: string): Promise<{ filePath: string }> {
    const raw = await this.invoker.invoke('saveQueryToFile', { content, defaultFileName });
    return this.validator.parse(S.saveQueryToFile, raw);
  }

  async loadQueryFromFile(): Promise<{ filePath: string; content: string }> {
    const raw = await this.invoker.invoke('loadQueryFromFile', {});
    return this.validator.parse(S.loadQueryFromFile, raw);
  }

  async browseFile(filter?: string): Promise<{ filePath: string }> {
    const raw = await this.invoker.invoke('browseFile', { filter });
    return this.validator.parse(S.browseFile, raw);
  }

  async getBookmarks(): Promise<Bookmark[]> {
    const raw = await this.invoker.invoke('getBookmarks', {});
    return this.validator.parse(S.getBookmarks, raw);
  }

  async saveBookmark(id: string, name: string, content: string): Promise<void> {
    // S.saveBookmark は zVoid のため parse を省略
    await this.invoker.invoke('saveBookmark', { id, name, content });
  }

  async deleteBookmark(id: string): Promise<void> {
    // S.deleteBookmark は zVoid のため parse を省略
    await this.invoker.invoke('deleteBookmark', { id });
  }
}

export function createIoProvider(
  invoker: IpcInvoker,
  logger: BridgeLogger,
  validator: ResponseValidator
): IoProvider {
  return new IoProviderImpl(invoker, logger, validator);
}
