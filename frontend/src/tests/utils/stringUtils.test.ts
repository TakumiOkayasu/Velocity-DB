import { describe, expect, it } from 'vite-plus/test';
import { stripBrackets } from '../../utils/stringUtils';

describe('stripBrackets', () => {
  it('ブラケット付きスキーマ.テーブルを除去', () => {
    expect(stripBrackets('[Develop.MMS].[MMS]')).toBe('Develop.MMS.MMS');
  });

  it('dboスキーマのブラケットを除去', () => {
    expect(stripBrackets('[dbo].[Users]')).toBe('dbo.Users');
  });

  it('ブラケットなしはそのまま返す', () => {
    expect(stripBrackets('dbo.Users')).toBe('dbo.Users');
  });

  it('空文字列', () => {
    expect(stripBrackets('')).toBe('');
  });

  it('単一ブラケット', () => {
    expect(stripBrackets('[Users]')).toBe('Users');
  });
});
