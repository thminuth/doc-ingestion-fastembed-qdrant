'use strict';

import pdfParse from 'pdf-parse';

/**
 * Extrahiert den vollständigen Text aus einem PDF-Buffer.
 */
const extractPdfText = async (buffer: Buffer): Promise<string> => {
  const data = await pdfParse(buffer);
  return data.text;
};

export default extractPdfText;
