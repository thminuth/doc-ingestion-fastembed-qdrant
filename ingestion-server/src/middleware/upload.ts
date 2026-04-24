'use strict';

import { Request } from 'express';
import multer, { FileFilterCallback } from 'multer';

const ACCEPTED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/markdown',
];

const fileFilter = (req: Request, file: Express.Multer.File, cb: FileFilterCallback): void => {
  const isMd = file.originalname.toLowerCase().endsWith('.md');
  if (ACCEPTED_MIME_TYPES.includes(file.mimetype) || isMd) {
    if (isMd && file.mimetype !== 'text/markdown') {
      file.mimetype = 'text/markdown';
    }
    cb(null, true);
  } else {
    cb(new Error('Ungültiger Dateityp. Nur PDF, DOCX und Markdown (.md) sind erlaubt.'));
  }
};

const uploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter,
}).single('document');

export default uploadMiddleware;
