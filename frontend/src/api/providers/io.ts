import * as S from '../schemas';
import { BaseProvider, type IpcInvoker, type ResponseValidator } from './types';

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

class IoProviderImpl extends BaseProvider implements IoProvider {
  async writeFrontendLog(content: string): Promise<void> {
    // 呼出側不在の dead method (utils/logger.ts は #556 で window.invoke 直叩き化、
    // 他に直接呼ぶ consumer なし)。Issue #526 の facade 完全性のため残置。
    await this.invokeAndParse('writeFrontendLog', { content }, S.writeFrontendLog);
  }

  async saveQueryToFile(content: string, defaultFileName?: string): Promise<{ filePath: string }> {
    return this.invokeAndParse('saveQueryToFile', { content, defaultFileName }, S.saveQueryToFile);
  }

  async loadQueryFromFile(): Promise<{ filePath: string; content: string }> {
    return this.invokeAndParse('loadQueryFromFile', {}, S.loadQueryFromFile);
  }

  async browseFile(filter?: string): Promise<{ filePath: string }> {
    return this.invokeAndParse('browseFile', { filter }, S.browseFile);
  }

  async getBookmarks(): Promise<Bookmark[]> {
    return this.invokeAndParse('getBookmarks', {}, S.getBookmarks);
  }

  async saveBookmark(id: string, name: string, content: string): Promise<void> {
    await this.invokeAndParse('saveBookmark', { id, name, content }, S.saveBookmark);
  }

  async deleteBookmark(id: string): Promise<void> {
    await this.invokeAndParse('deleteBookmark', { id }, S.deleteBookmark);
  }
}

export function createIoProvider(invoker: IpcInvoker, validator: ResponseValidator): IoProvider {
  return new IoProviderImpl(invoker, validator);
}
