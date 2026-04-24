'use strict';

import mammoth from 'mammoth';

/**
 * Extrahiert den vollständigen Text aus einem DOCX-Buffer.
 */
const extractDocxText = async (buffer: Buffer): Promise<string> => {
  try {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  } catch (error: any) {
    console.warn(`[docxExtractor] Warnung: Konnte DOCX nicht parsen (Möglicherweise unvollständig oder beschädigt). Details: ${error.message}`);
    return ''; // Leerer Text, damit die Pipeline nicht komplett abstürzt
  }
};

export default extractDocxText;
