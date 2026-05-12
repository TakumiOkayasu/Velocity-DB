import * as S from '../schemas';
import { BaseProvider, type IpcInvoker, type ResponseValidator } from './types';

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

class SearchProviderImpl extends BaseProvider implements SearchProvider {
  async searchObjects(
    connectionId: string,
    pattern: string,
    options?: SearchObjectOptions
  ): Promise<SearchObjectResult[]> {
    return this.invokeAndParse(
      'searchObjects',
      { connectionId, pattern, ...options },
      S.searchObjects
    );
  }

  async quickSearch(connectionId: string, prefix: string, limit = 20): Promise<string[]> {
    return this.invokeAndParse('quickSearch', { connectionId, prefix, limit }, S.quickSearch);
  }
}

export function createSearchProvider(
  invoker: IpcInvoker,
  validator: ResponseValidator
): SearchProvider {
  return new SearchProviderImpl(invoker, validator);
}
