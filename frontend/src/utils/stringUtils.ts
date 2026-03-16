/**
 * SQL Server のブラケット記法 ([schema].[table]) からブラケットを除去する。
 * 表示用途のみ。SQL生成やsourceTableには適用しないこと。
 */
export function stripBrackets(name: string): string {
  return name.replace(/\[([^\]]+)\]/g, '$1');
}
