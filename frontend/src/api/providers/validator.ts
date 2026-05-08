import type { ZodType } from 'zod';
import type { ResponseValidator } from './types';

class ZodResponseValidator implements ResponseValidator {
  parse<T>(schema: ZodType<T>, data: unknown): T {
    return schema.parse(data);
  }
}

export function createZodValidator(): ResponseValidator {
  return new ZodResponseValidator();
}
