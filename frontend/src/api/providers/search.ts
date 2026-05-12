import * as S from '../schemas';
import type { BridgeLogger, IpcInvoker, ResponseValidator } from './types';

// ============================================================================
// 検索結果 (searchObjects)
// ============================================================================

export interface SearchObjectResult {
  objectType: string;
  schemaName: string;
  objectName: string;
  parentName: string;
}

export interface SearchObjectOptions {
  searchTables?: boolean;
  searchViews?: boolean;
  searchProcedures?: boolean;
  searchFunctions?: boolean;
  searchColumns?: boolean;
  caseSensitive?: boolean;
  maxResults?: number;
}

// ============================================================================
// Provider IF
// ============================================================================

export interface SearchProvider {
  searchObjects(
    connectionId: string,
    pattern: string,
    options?: SearchObjectOptions
  ): Promise<SearchObjectResult[]>;
  quickSearch(connectionId: string, prefix: string, limit?: number): Promise<string[]>;
}

class SearchProviderImpl implements SearchProvider {
  constructor(
    private readonly invoker: IpcInvoker,
    // 共通シグネチャ維持 (#517 軸③): 現状未使用だが将来 log.info 等を実利用するため
    private readonly logger: BridgeLogger,
    private readonly validator: ResponseValidator
  ) {
    void this.logger; // TS6138 抑制: 共通シグネチャ維持のため未使用受け取りを許可
  }

  async searchObjects(
    connectionId: string,
    pattern: string,
    options?: SearchObjectOptions
  ): Promise<SearchObjectResult[]> {
    const raw = await this.invoker.invoke('searchObjects', {
      connectionId,
      pattern,
      ...options,
    });
    return this.validator.parse(S.searchObjects, raw);
  }

  async quickSearch(connectionId: string, prefix: string, limit = 20): Promise<string[]> {
    const raw = await this.invoker.invoke('quickSearch', { connectionId, prefix, limit });
    return this.validator.parse(S.quickSearch, raw);
  }
}

export function createSearchProvider(
  invoker: IpcInvoker,
  logger: BridgeLogger,
  validator: ResponseValidator
): SearchProvider {
  return new SearchProviderImpl(invoker, logger, validator);
}
