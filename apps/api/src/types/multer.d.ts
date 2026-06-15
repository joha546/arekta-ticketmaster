declare module 'multer' {
  import type { RequestHandler } from 'express';

  export interface File {
    fieldname: string;
    originalname: string;
    encoding: string;
    mimetype: string;
    size: number;
    buffer: Buffer;
  }

  export class MulterError extends Error {
    code: string;
  }

  interface StorageEngine {
    _handleFile(
      req: unknown,
      file: File,
      cb: (error?: Error | null, info?: Partial<File>) => void,
    ): void;
    _removeFile(req: unknown, file: File, cb: (error: Error | null) => void): void;
  }

  interface Multer {
    single(field: string): RequestHandler;
  }

  interface Options {
    storage?: StorageEngine;
    limits?: { fileSize?: number };
    fileFilter?: (
      req: unknown,
      file: { mimetype: string },
      cb: (error: Error | null, acceptFile?: boolean) => void,
    ) => void;
  }

  interface MulterFactory {
    (options?: Options): Multer;
    memoryStorage(): StorageEngine;
    MulterError: typeof MulterError;
  }

  const multer: MulterFactory;
  export default multer;
}
