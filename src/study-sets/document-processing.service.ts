import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { createCanvas, ImageData, Path2D, type Canvas } from '@napi-rs/canvas';
import { randomUUID } from 'crypto';
import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import { R2StorageService } from '../storage/r2-storage.service';
import { AiProcessFileSnapshot } from './schemas/study-set-ai-job.schema';

const execFileAsync = promisify(execFile);
const globalCanvas = globalThis as any;
if (!globalCanvas.ImageData) {
  globalCanvas.ImageData = ImageData;
}
if (!globalCanvas.Path2D) {
  globalCanvas.Path2D = Path2D;
}
const pdfjs = require('pdfjs-dist') as typeof import('pdfjs-dist');
const { getDocument, ImageKind, OPS } = pdfjs;

interface PageExtraction {
  pageNumber: number;
  text: string;
  needsVision: boolean;
  visionSummary?: string | null;
}

interface OcrResult {
  text: string;
  confidence: number | null;
  shortTokenRatio: number;
}

interface RenderedPage {
  buffer: Buffer;
  width: number;
  height: number;
  imageData: Uint8ClampedArray;
}

interface PageMeta {
  pageNumber: number;
  text: string;
  nativeTextChars: number;
  alphaRatio: number;
  ocrTextLen: number;
  ocrConfidence: number | null;
  shortTokenRatio: number;
  needsVision: boolean;
  visionRankScore: number;
  needsVisionReason: string;
  imageCount: number;
  imageAreaRatio: number;
  vectorOps: number;
  visionSummary?: string | null;
  duplicateOf?: number | null;
}

interface Hash64 {
  hi: number;
  lo: number;
}

class NodeCanvasFactory {
  create(width: number, height: number): { canvas: Canvas; context: any } {
    const canvas = createCanvas(Math.max(1, Math.floor(width)), Math.max(1, Math.floor(height)));
    const context = canvas.getContext('2d');
    return { canvas, context };
  }

  reset(canvasAndContext: { canvas: Canvas; context: any }, width: number, height: number): void {
    canvasAndContext.canvas.width = Math.max(1, Math.floor(width));
    canvasAndContext.canvas.height = Math.max(1, Math.floor(height));
  }

  destroy(canvasAndContext: { canvas: Canvas; context: any }): void {
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
    canvasAndContext.context = null;
  }
}

@Injectable()
export class DocumentProcessingService {
  private readonly logger = new Logger(DocumentProcessingService.name);
  private readonly openai: OpenAI | null;
  private readonly openAiModel: string;
  private readonly ocrDpi: number;
  private readonly ocrMaxWidth: number;
  private readonly ocrJpegQuality: number;
  private readonly ocrLanguage: string;
  private readonly slidesSamplePages: number;
  private readonly slidesTextThreshold: number;
  private readonly slidesImageRatio: number;
  private readonly diagramTextThreshold: number;
  private readonly diagramMediumThreshold: number;
  private readonly diagramConfidenceThreshold: number;
  private readonly diagramShortTokenThreshold: number;
  private readonly nativeTextOcrThreshold: number;
  private readonly textWinsCharThreshold: number;
  private readonly textWinsAlphaRatio: number;
  private readonly visionImageAreaRatioThreshold: number;
  private readonly visionMaxPages: number;
  private readonly visionMaxImages: number;
  private readonly visionMaxImageWidth: number;
  private readonly visionImageQuality: number;
  private readonly visionMinImagePixels: number;
  private readonly dedupeSimilarity: number;
  private readonly dedupeEnabled: boolean;
  private readonly standardFontDataUrl: string;
  private readonly pdfObjectTimeoutMs: number;
  private readonly pdfObjectVisionTimeoutMs: number;
  private readonly visionPageTimeoutMs: number;
  private readonly visionRequestTimeoutMs: number;
  private tesseractChecked = false;
  private tesseractAvailable = true;

  constructor(
    private readonly storage: R2StorageService,
    private readonly config: ConfigService
  ) {
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    this.openAiModel = this.config.get<string>('OPENAI_MODEL') ?? 'gpt-4o-mini';
    this.openai = apiKey ? new OpenAI({ apiKey }) : null;
    this.ocrDpi = this.readNumber('OCR_DPI', 150);
    this.ocrMaxWidth = this.readNumber('OCR_MAX_WIDTH', 1400);
    this.ocrJpegQuality = this.readNumber('OCR_JPEG_QUALITY', 0.75);
    this.ocrLanguage = this.config.get<string>('OCR_LANGUAGE') ?? 'eng';
    this.slidesSamplePages = this.readNumber('SLIDES_SAMPLE_PAGES', 3);
    this.slidesTextThreshold = this.readNumber('SLIDES_TEXT_THRESHOLD', 200);
    this.slidesImageRatio = this.readNumber('SLIDES_IMAGE_RATIO', 0.7);
    this.diagramTextThreshold = this.readNumber('DIAGRAM_TEXT_THRESHOLD', 120);
    this.diagramMediumThreshold = this.readNumber('DIAGRAM_MEDIUM_TEXT_THRESHOLD', 300);
    this.diagramConfidenceThreshold = this.readNumber('DIAGRAM_CONFIDENCE_THRESHOLD', 0.65);
    this.diagramShortTokenThreshold = this.readNumber('DIAGRAM_SHORT_TOKEN_RATIO', 0.45);
    this.nativeTextOcrThreshold = this.readNumber('NATIVE_TEXT_OCR_THRESHOLD', 180);
    this.textWinsCharThreshold = this.readNumber('TEXT_WINS_CHAR_THRESHOLD', 300);
    this.textWinsAlphaRatio = this.readNumber('TEXT_WINS_ALPHA_RATIO', 0.25);
    this.visionImageAreaRatioThreshold = this.readNumber('VISION_IMAGE_AREA_RATIO_THRESHOLD', 0.25);
    this.visionMaxPages = this.readNumber('VISION_MAX_PAGES', 0);
    this.visionMaxImages = this.readNumber('VISION_MAX_IMAGES', 2);
    this.visionMaxImageWidth = this.readNumber('VISION_MAX_IMAGE_WIDTH', 1200);
    this.visionImageQuality = this.readNumber('VISION_IMAGE_QUALITY', 0.7);
    this.visionMinImagePixels = this.readNumber('VISION_MIN_IMAGE_PIXELS', 10000);
    this.dedupeSimilarity = this.readNumber('DEDUP_SIMILARITY', 0.95);
    this.dedupeEnabled = this.readBoolean('DEDUP_ENABLED', true);
    this.pdfObjectTimeoutMs = this.readNumber('PDFJS_OBJECT_TIMEOUT_MS', 6000);
    this.pdfObjectVisionTimeoutMs = this.readNumber('PDFJS_OBJECT_TIMEOUT_VISION_MS', 15000);
    this.visionPageTimeoutMs = this.readNumber('VISION_PAGE_TIMEOUT_MS', 20000);
    this.visionRequestTimeoutMs = this.readNumber('VISION_REQUEST_TIMEOUT_MS', 45000);
    const pdfjsRoot = path.dirname(require.resolve('pdfjs-dist/package.json'));
    this.standardFontDataUrl = path.join(pdfjsRoot, 'standard_fonts/');
  }

  async buildStudySource(file: AiProcessFileSnapshot): Promise<string> {
    if (file.textContent?.trim()) {
      return file.textContent.trim();
    }

    if (!file.storageKey) {
      throw new Error(`Missing storage key for ${file.fileName}`);
    }

    if (file.extension !== 'pdf') {
      throw new Error(`Unsupported file type ${file.extension} for ${file.fileName}`);
    }

    const buffer = await this.storage.getObjectBuffer(file.storageKey);
    const pages = await this.extractPdfPages(buffer);
    const combined = pages
      .map(page => this.formatPageText(page))
      .join('\n\n')
      .trim();

    if (!combined) {
      throw new Error(`No text could be extracted from ${file.fileName}`);
    }

    return combined;
  }

  private async extractPdfPages(buffer: Buffer): Promise<PageExtraction[]> {
    const loadingTask = getDocument({
      data: new Uint8Array(buffer),
      standardFontDataUrl: this.standardFontDataUrl
    });
    const pdf = await loadingTask.promise;
    const docType = await this.classifyDocument(pdf);
    const pages: PageMeta[] = [];
    const dedupeIndex: Array<{ hash: Hash64; pageNumber: number }> = [];

    this.logger.log(`Document classified as ${docType} (${pdf.numPages} pages).`);

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const extractedText = await this.extractTextFromPage(page);
      const nativeTextChars = extractedText.length;
      const alphaRatio = this.computeAlphaRatio(extractedText);
      const media = await this.analyzePageMedia(page);
      const allowDedupe = this.dedupeEnabled && this.isSafeToDedupe(nativeTextChars, media);
      const shouldOcr = nativeTextChars < this.nativeTextOcrThreshold;

      let ocrText = extractedText;
      let ocrConfidence: number | null = null;
      let shortTokenRatio = this.computeShortTokenRatio(ocrText);
      let duplicateOf: number | null = null;
      let hash: Hash64 | null = null;

      if (shouldOcr) {
        const rendered = await this.renderPageForOcr(page);
        hash = this.computeDhash(rendered.imageData, rendered.width, rendered.height);
        if (allowDedupe) {
          duplicateOf = this.findDuplicate(hash, dedupeIndex);
        }

        const ocr = await this.runOcr(rendered.buffer);
        ocrText = ocr.text || extractedText;
        ocrConfidence = ocr.confidence;
        shortTokenRatio = ocr.shortTokenRatio;
        if (hash !== null && !duplicateOf) {
          dedupeIndex.push({ hash, pageNumber });
        }
      }

      const ocrTextLen = ocrText.length;
      const textWins =
        nativeTextChars >= this.textWinsCharThreshold && alphaRatio >= this.textWinsAlphaRatio;
      const imageHeavy = media.imageAreaRatio >= this.visionImageAreaRatioThreshold;
      const lowText = this.shouldUseVision(ocrTextLen, ocrConfidence, shortTokenRatio);
      let needsVision = false;
      let needsVisionReason = 'text-ok';

      if (duplicateOf) {
        needsVision = false;
        needsVisionReason = 'duplicate';
      } else if (textWins) {
        needsVision = false;
        needsVisionReason = 'text-wins';
      } else if (media.imageCount === 0) {
        needsVision = false;
        needsVisionReason = 'no-images';
      } else if (!imageHeavy) {
        needsVision = false;
        needsVisionReason = 'image-area-low';
      } else if (lowText) {
        needsVision = true;
        needsVisionReason = 'image-heavy-low-text';
      } else {
        needsVision = false;
        needsVisionReason = 'image-heavy-text-ok';
      }

      const visionRankScore = this.computeVisionRankScore(
        media.imageAreaRatio,
        ocrTextLen,
        ocrConfidence,
        shortTokenRatio,
        media.vectorOps
      );

      this.logger.log(
        `Page ${pageNumber} decision: nativeTextChars=${nativeTextChars}, alphaRatio=${alphaRatio.toFixed(2)}, imageCount=${media.imageCount}, imageAreaRatio=${media.imageAreaRatio.toFixed(2)}, ocrChars=${ocrTextLen}, needsVision=${needsVision} (${needsVisionReason}).`
      );

      pages.push({
        pageNumber,
        text: ocrText,
        nativeTextChars,
        alphaRatio,
        ocrTextLen,
        ocrConfidence,
        shortTokenRatio,
        needsVision,
        visionRankScore,
        needsVisionReason,
        imageCount: media.imageCount,
        imageAreaRatio: media.imageAreaRatio,
        vectorOps: media.vectorOps,
        duplicateOf
      });
    }

    const duplicateCount = pages.filter(page => page.duplicateOf).length;
    const visionCount = pages.filter(page => page.needsVision).length;
    this.logger.log(
      `OCR completed. Vision duplicates: ${duplicateCount}. Vision needed: ${visionCount}.`
    );

    await this.applyVisionCaptions(pdf, pages);

    return pages.map(page => ({
      pageNumber: page.pageNumber,
      text: page.text,
      needsVision: page.needsVision,
      visionSummary: page.visionSummary ?? null
    }));
  }

  private async classifyDocument(pdf: any): Promise<'slides' | 'text'> {
    const sampleCount = Math.min(this.slidesSamplePages, pdf.numPages);
    if (!sampleCount) {
      return 'text';
    }

    let imagePages = 0;
    for (let index = 1; index <= sampleCount; index += 1) {
      const page = await pdf.getPage(index);
      const text = await this.extractTextFromPage(page);
      if (text.length < this.slidesTextThreshold) {
        imagePages += 1;
      }
    }

    const ratio = imagePages / sampleCount;
    return ratio >= this.slidesImageRatio ? 'slides' : 'text';
  }

  private async applyVisionCaptions(pdf: any, pages: PageMeta[]): Promise<void> {
    if (!this.openai) {
      this.logger.warn('OpenAI API key missing. Skipping vision analysis.');
      return;
    }

    const candidates = pages.filter(page => page.needsVision && !page.duplicateOf && page.imageCount > 0);
    if (!candidates.length) {
      return;
    }

    let selected = candidates;
    if (this.visionMaxPages > 0 && candidates.length > this.visionMaxPages) {
      selected = candidates
        .slice()
        .sort((a, b) => b.visionRankScore - a.visionRankScore)
        .slice(0, this.visionMaxPages);
      const selectedSet = new Set(selected.map(item => item.pageNumber));
      pages.forEach(page => {
        if (page.needsVision && !selectedSet.has(page.pageNumber)) {
          page.needsVision = false;
        }
      });
    }

    this.logger.log(
      `Vision candidates: ${candidates.length}. Selected: ${selected.length}.`
    );

    for (const pageMeta of selected) {
      this.logger.log(
        `Vision processing page ${pageMeta.pageNumber} (imageCount=${pageMeta.imageCount}, imageAreaRatio=${pageMeta.imageAreaRatio.toFixed(2)}, vectorOps=${pageMeta.vectorOps}).`
      );
      const page = await pdf.getPage(pageMeta.pageNumber);
      let images: Array<{ width: number; height: number; data: Uint8ClampedArray }> = [];
      try {
        images = await this.withTimeout(
          this.extractPageImages(page),
          this.visionPageTimeoutMs,
          `extractPageImages page ${pageMeta.pageNumber}`
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Image extraction timed out for page ${pageMeta.pageNumber}: ${message}`);
        images = [];
      }
      this.logger.log(`Vision image count for page ${pageMeta.pageNumber}: ${images.length}.`);
      const dataUrl = images.length ? this.buildVisionImageDataUrl(images) : null;
      if (!dataUrl) {
        pageMeta.needsVision = false;
        pageMeta.needsVisionReason = 'no-images-after-extract';
        continue;
      }

      const start = Date.now();
      pageMeta.visionSummary = await this.describePageWithVisionUsingImage(
        dataUrl,
        pageMeta.text,
        pageMeta.pageNumber,
        pdf.numPages
      );
      this.logger.log(
        `Vision call completed for page ${pageMeta.pageNumber} in ${Date.now() - start}ms.`
      );
    }

    const pageByNumber = new Map(pages.map(page => [page.pageNumber, page]));
    pages.forEach(page => {
      if (!page.duplicateOf) {
        return;
      }
      const original = pageByNumber.get(page.duplicateOf);
      if (original?.visionSummary) {
        page.needsVision = original.needsVision;
        page.visionSummary = original.visionSummary;
      }
    });

    const visionTotal = pages.filter(page => page.visionSummary).length;
    const visionPrimary = pages.filter(page => page.visionSummary && !page.duplicateOf).length;
    this.logger.log(
      `Vision captions generated for ${visionTotal} page(s) (${visionPrimary} direct, ${visionTotal - visionPrimary} reused).`
    );
  }

  private async extractTextFromPage(page: any): Promise<string> {
    const textContent = await page.getTextContent();
    return textContent.items
      .map((item: any) => (item?.str ? String(item.str) : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private async renderPageForOcr(page: any): Promise<RenderedPage> {
    const baseViewport = page.getViewport({ scale: 1 });
    const targetScale = this.ocrDpi / 72;
    const scaledWidth = baseViewport.width * targetScale;
    const scale = scaledWidth > this.ocrMaxWidth ? this.ocrMaxWidth / baseViewport.width : targetScale;
    const viewport = page.getViewport({ scale });

    const canvasFactory = new NodeCanvasFactory();
    const { canvas, context } = canvasFactory.create(viewport.width, viewport.height);

    await page.render({ canvasContext: context, viewport, canvasFactory }).promise;

    const imageData = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const buffer = canvas.toBuffer('image/jpeg', this.ocrJpegQuality);

    canvasFactory.destroy({ canvas, context });

    return {
      buffer,
      width: canvas.width,
      height: canvas.height,
      imageData: new Uint8ClampedArray(imageData)
    };
  }

  private async analyzePageMedia(
    page: any
  ): Promise<{ imageCount: number; imageAreaRatio: number; vectorOps: number }> {
    const viewport = page.getViewport({ scale: 1 });
    const pageArea = Math.max(1, viewport.width * viewport.height);
    const opList = await page.getOperatorList();
    let imageCount = 0;
    let imageArea = 0;
    let vectorOps = 0;
    const seen = new Set<string>();
    const vectorOpCodes = new Set<number>(
      [
        OPS.constructPath,
        OPS.stroke,
        OPS.closeStroke,
        OPS.fill,
        OPS.eoFill,
        OPS.fillStroke,
        OPS.eoFillStroke,
        OPS.closeFillStroke,
        OPS.closeEOFillStroke,
        OPS.shadingFill,
        OPS.paintFormXObjectBegin,
        OPS.paintFormXObjectEnd,
        OPS.paintXObject
      ].filter(value => typeof value === 'number')
    );
    const imageOpCodes = new Set<number>(
      [
        OPS.paintImageXObject,
        OPS.paintInlineImageXObject,
        OPS.paintImageXObjectRepeat,
        OPS.paintInlineImageXObjectGroup,
        OPS.paintImageMaskXObject,
        OPS.paintImageMaskXObjectRepeat,
        OPS.paintImageMaskXObjectGroup
      ].filter(value => typeof value === 'number')
    );

    for (let index = 0; index < opList.fnArray.length; index += 1) {
      const fn = opList.fnArray[index];
      if (vectorOpCodes.has(fn)) {
        vectorOps += 1;
      }
      if (!imageOpCodes.has(fn)) {
        continue;
      }

      const args = opList.argsArray[index];
      const inlineImage = args?.[0] && typeof args[0] === 'object' ? args[0] : null;
      if (inlineImage?.width && inlineImage?.height) {
        imageCount += 1;
        imageArea += inlineImage.width * inlineImage.height;
        continue;
      }

      const objId = args?.[0];
      if (typeof objId !== 'string') {
        continue;
      }
      if (seen.has(objId)) {
        continue;
      }
      seen.add(objId);

      const image = await this.waitForPdfObject(page, objId);
      if (image?.width && image?.height) {
        imageCount += 1;
        imageArea += image.width * image.height;
      }
    }

    return {
      imageCount,
      imageAreaRatio: imageArea / pageArea,
      vectorOps
    };
  }

  private computeAlphaRatio(text: string): number {
    const compact = text.replace(/\s+/g, '');
    if (!compact) {
      return 0;
    }
    const letters = compact.match(/[A-Za-z]/g)?.length ?? 0;
    return letters / compact.length;
  }

  private computeVisionRankScore(
    imageAreaRatio: number,
    textLength: number,
    confidence: number | null,
    shortTokenRatio: number,
    vectorOps: number
  ): number {
    let score = 0;
    score += imageAreaRatio * 2;
    if (textLength < this.diagramTextThreshold) {
      score += 1;
    }
    if (confidence !== null && confidence < this.diagramConfidenceThreshold) {
      score += 0.5;
    }
    if (textLength < this.diagramMediumThreshold && shortTokenRatio > this.diagramShortTokenThreshold) {
      score += 0.5;
    }
    if (imageAreaRatio >= this.visionImageAreaRatioThreshold && vectorOps >= 200) {
      score += 0.1;
    }
    return score;
  }

  private isSafeToDedupe(
    nativeTextChars: number,
    media: { imageCount: number; imageAreaRatio: number; vectorOps: number }
  ): boolean {
    if (nativeTextChars >= this.diagramTextThreshold) {
      return false;
    }
    if (media.imageCount > 0) {
      return false;
    }
    if (media.imageAreaRatio >= this.visionImageAreaRatioThreshold) {
      return false;
    }
    if (media.vectorOps >= 20) {
      return false;
    }
    return true;
  }

  private async waitForPdfObject(
    page: any,
    objId: string,
    timeoutMs = this.pdfObjectTimeoutMs
  ): Promise<any | null> {
    try {
      return await this.withTimeout(
        new Promise(resolve => page.objs.get(objId, resolve)),
        timeoutMs,
        `pdfjs obj ${objId}`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`PDF object ${objId} timed out: ${message}`);
      return null;
    }
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    let timeoutId: NodeJS.Timeout | null = null;
    const timeoutPromise = new Promise<T>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`${label} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  private async runOcr(imageBuffer: Buffer): Promise<OcrResult> {
    if (!(await this.ensureTesseractAvailable())) {
      return { text: '', confidence: null, shortTokenRatio: 0 };
    }

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ocr-'));
    const inputPath = path.join(tempDir, `${randomUUID()}.jpg`);
    try {
      await fs.writeFile(inputPath, imageBuffer);
      const args = [
        inputPath,
        'stdout',
        '--oem',
        '1',
        '--psm',
        '6',
        '-l',
        this.ocrLanguage,
        '-c',
        `user_defined_dpi=${this.ocrDpi}`,
        'tsv'
      ];
      const { stdout } = await execFileAsync('tesseract', args, { maxBuffer: 8 * 1024 * 1024 });
      return this.parseOcrTsv(stdout);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`OCR failed: ${message}`);
      return { text: '', confidence: null, shortTokenRatio: 0 };
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }

  private parseOcrTsv(tsv: string): OcrResult {
    const lines = tsv.split(/\r?\n/).filter(Boolean);
    if (lines.length <= 1) {
      return { text: '', confidence: null, shortTokenRatio: 0 };
    }

    let currentLine = -1;
    const textParts: string[] = [];
    const confidences: number[] = [];

    for (let index = 1; index < lines.length; index += 1) {
      const parts = lines[index].split('\t');
      if (parts.length < 12) {
        continue;
      }

      const level = Number(parts[0]);
      const lineNum = Number(parts[4]);
      const conf = Number(parts[10]);
      const text = parts[11]?.trim();

      if (level !== 5 || !text) {
        continue;
      }

      if (lineNum !== currentLine) {
        if (textParts.length > 0) {
          textParts.push('\n');
        }
        currentLine = lineNum;
      }

      textParts.push(text);
      if (!Number.isNaN(conf) && conf >= 0) {
        confidences.push(conf);
      }
    }

    const rawText = textParts.join(' ').replace(/\s+\n\s+/g, '\n').replace(/\s+/g, ' ').trim();
    const confidence = confidences.length
      ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length / 100
      : null;

    return {
      text: rawText,
      confidence,
      shortTokenRatio: this.computeShortTokenRatio(rawText)
    };
  }

  private computeShortTokenRatio(text: string): number {
    const tokens = text.split(/\s+/).filter(Boolean);
    if (!tokens.length) {
      return 0;
    }

    const shortCount = tokens.filter(token => token.length <= 2).length;
    return shortCount / tokens.length;
  }

  private shouldUseVision(textLength: number, confidence: number | null, shortTokenRatio: number): boolean {
    if (textLength < this.diagramTextThreshold) {
      return true;
    }
    if (confidence !== null && confidence < this.diagramConfidenceThreshold) {
      return true;
    }
    if (textLength < this.diagramMediumThreshold && shortTokenRatio > this.diagramShortTokenThreshold) {
      return true;
    }
    return false;
  }

  private computeDiagramScore(textLength: number, confidence: number | null, shortTokenRatio: number): number {
    let score = 0;
    if (textLength < this.diagramTextThreshold) {
      score += 2;
    } else if (textLength < this.diagramMediumThreshold) {
      score += 1;
    }
    if (confidence !== null) {
      score += Math.max(0, 1 - confidence);
    }
    score += shortTokenRatio;
    return score;
  }

  private formatPageText(page: PageExtraction): string {
    const text = page.text?.trim() || '[No OCR text found on this page.]';
    const parts = [`OCR_TEXT: ${text}`];

    if (page.needsVision && page.visionSummary) {
      parts.push(`DIAGRAM_CAPTION_JSON: ${page.visionSummary}`);
    }

    return `=== Page ${page.pageNumber} ===\n${parts.join('\n')}`;
  }

  private async describePageWithVisionUsingImage(
    imageDataUrl: string,
    extractedText: string,
    pageNumber: number,
    totalPages: number
  ): Promise<string | null> {
    try {
      const prompt = [
        '=== STRICT JSON OUTPUT MODE ===',
        'Return ONLY a valid JSON object. No extra text.',
        '',
        `You are analyzing extracted images from page ${pageNumber} of ${totalPages} in a student's PDF notes.`,
        'Describe the diagram or visual clearly for study purposes.',
        'Keep the output concise and structured for downstream study generation.',
        '',
        'Required JSON format:',
        '{',
        '  "diagram_type": string,',
        '  "entities": [string],',
        '  "relationships": [{"from": string, "to": string, "label": string}],',
        '  "labels": [string],',
        '  "key_takeaways": [string],',
        '  "suggested_flashcards": [string]',
        '}',
        '',
        'Rules:',
        '- 1-3 key_takeaways max.',
        '- suggested_flashcards max 3.',
        '- If unsure, use empty arrays but keep keys.',
        extractedText
          ? `Extracted text (may be incomplete): ${extractedText}`
          : 'Extracted text was minimal or empty.'
      ].join('\n');

      const openai = this.openai;
      if (!openai) {
        return null;
      }

      const response = await this.withTimeout(
        openai.chat.completions.create({
        model: this.openAiModel,
        messages: [
          { role: 'system', content: 'You are a JSON-only assistant.' },
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              {
                type: 'image_url',
                image_url: { url: imageDataUrl }
              }
            ]
          }
        ],
        max_tokens: 350
        }),
        this.visionRequestTimeoutMs,
        `vision request page ${pageNumber}`
      );

      const content = response.choices?.[0]?.message?.content?.trim();
      if (!content) {
        this.logger.warn(`Vision response was empty for page ${pageNumber}.`);
        return null;
      }
      return content;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Vision analysis failed for page ${pageNumber}: ${message}`);
      return null;
    }
  }

  private async extractPageImages(page: any): Promise<Array<{ width: number; height: number; data: Uint8ClampedArray }>> {
    const opList = await page.getOperatorList();
    const images: Array<{ width: number; height: number; data: Uint8ClampedArray }> = [];
    const seen = new Set<string>();

    for (let index = 0; index < opList.fnArray.length; index += 1) {
      const fn = opList.fnArray[index];
      if (
        fn !== OPS.paintImageXObject &&
        fn !== OPS.paintInlineImageXObject &&
        fn !== OPS.paintImageXObjectRepeat
      ) {
        continue;
      }

      const args = opList.argsArray[index];
      const inlineImage = args?.[0] && typeof args[0] === 'object' ? args[0] : null;
      if (inlineImage?.data) {
        const normalized = this.normalizePdfImage(inlineImage);
        if (normalized && normalized.width * normalized.height >= this.visionMinImagePixels) {
          images.push(normalized);
          if (this.visionMaxImages > 0 && images.length >= this.visionMaxImages) {
            break;
          }
        }
        continue;
      }

      const objId = args?.[0];
      if (typeof objId !== 'string') {
        continue;
      }
      if (seen.has(objId)) {
        continue;
      }
      seen.add(objId);

      const image = await this.waitForPdfObject(page, objId, this.pdfObjectVisionTimeoutMs);
      const normalized = this.normalizePdfImage(image);
      if (normalized && normalized.width * normalized.height >= this.visionMinImagePixels) {
        images.push(normalized);
        if (this.visionMaxImages > 0 && images.length >= this.visionMaxImages) {
          break;
        }
      }
    }

    return images;
  }

  private normalizePdfImage(image: any): { width: number; height: number; data: Uint8ClampedArray } | null {
    if (!image?.data || !image.width || !image.height) {
      return null;
    }

    const width = image.width;
    const height = image.height;
    const raw = image.data as Uint8ClampedArray | Uint8Array;

    if (image.kind === ImageKind.RGB_24BPP) {
      const data = new Uint8ClampedArray(width * height * 4);
      for (let i = 0, j = 0; i < raw.length; i += 3, j += 4) {
        data[j] = raw[i];
        data[j + 1] = raw[i + 1];
        data[j + 2] = raw[i + 2];
        data[j + 3] = 255;
      }
      return { width, height, data };
    }

    if (image.kind === ImageKind.RGBA_32BPP) {
      return { width, height, data: new Uint8ClampedArray(raw) };
    }

    this.logger.warn(`Unsupported image kind ${image.kind} during image extraction.`);
    return null;
  }

  private buildVisionImageDataUrl(images: Array<{ width: number; height: number; data: Uint8ClampedArray }>): string | null {
    if (!images.length) {
      return null;
    }

    const limit = this.visionMaxImages > 0 ? this.visionMaxImages : images.length;
    const selected = images
      .slice()
      .sort((a, b) => b.width * b.height - a.width * a.height)
      .slice(0, limit);

    const canvases = selected.map(image => this.createScaledCanvas(image));
    const combined = this.combineCanvases(canvases);
    const buffer = combined.toBuffer('image/jpeg', this.visionImageQuality);
    return `data:image/jpeg;base64,${buffer.toString('base64')}`;
  }

  private createScaledCanvas(image: { width: number; height: number; data: Uint8ClampedArray }): Canvas {
    const { width, height, data } = image;
    const canvas = createCanvas(width, height);
    const context = canvas.getContext('2d');
    const imageData = new ImageData(data, width, height);
    context.putImageData(imageData, 0, 0);

    if (width <= this.visionMaxImageWidth) {
      return canvas;
    }

    const scale = this.visionMaxImageWidth / width;
    const targetHeight = Math.max(1, Math.round(height * scale));
    const scaled = createCanvas(this.visionMaxImageWidth, targetHeight);
    const scaledContext = scaled.getContext('2d');
    scaledContext.drawImage(canvas, 0, 0, scaled.width, scaled.height);
    return scaled;
  }

  private combineCanvases(canvases: Canvas[]): Canvas {
    if (canvases.length === 1) {
      return canvases[0];
    }

    const width = Math.max(...canvases.map(canvas => canvas.width));
    const padding = 12;
    const height = canvases.reduce((sum, canvas) => sum + canvas.height, 0) + padding * (canvases.length - 1);
    const combined = createCanvas(width, height);
    const context = combined.getContext('2d');

    let offsetY = 0;
    for (const canvas of canvases) {
      context.drawImage(canvas, 0, offsetY, canvas.width, canvas.height);
      offsetY += canvas.height + padding;
    }

    return combined;
  }

  private computeDhash(data: Uint8ClampedArray, width: number, height: number): Hash64 {
    const cols = 9;
    const rows = 8;
    const pixels: number[] = [];

    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        const srcX = Math.min(width - 1, Math.floor((x + 0.5) * width / cols));
        const srcY = Math.min(height - 1, Math.floor((y + 0.5) * height / rows));
        const index = (srcY * width + srcX) * 4;
        const r = data[index];
        const g = data[index + 1];
        const b = data[index + 2];
        const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
        pixels.push(gray);
      }
    }

    let hi = 0;
    let lo = 0;
    let bitIndex = 0;
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols - 1; x += 1) {
        const left = pixels[y * cols + x];
        const right = pixels[y * cols + x + 1];
        if (left > right) {
          if (bitIndex < 32) {
            lo |= 1 << bitIndex;
          } else {
            hi |= 1 << (bitIndex - 32);
          }
        }
        bitIndex += 1;
      }
    }

    return { hi: hi >>> 0, lo: lo >>> 0 };
  }

  private findDuplicate(hash: Hash64, index: Array<{ hash: Hash64; pageNumber: number }>): number | null {
    for (const entry of index) {
      const distance = this.hammingDistance(hash, entry.hash);
      const similarity = 1 - distance / 64;
      if (similarity >= this.dedupeSimilarity) {
        return entry.pageNumber;
      }
    }
    return null;
  }

  private hammingDistance(a: Hash64, b: Hash64): number {
    return this.popcount32(a.hi ^ b.hi) + this.popcount32(a.lo ^ b.lo);
  }

  private popcount32(value: number): number {
    let x = value >>> 0;
    x -= (x >>> 1) & 0x55555555;
    x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
    return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
  }

  private async ensureTesseractAvailable(): Promise<boolean> {
    if (this.tesseractChecked) {
      return this.tesseractAvailable;
    }

    this.tesseractChecked = true;
    try {
      await execFileAsync('tesseract', ['--version'], { timeout: 5000 });
      this.tesseractAvailable = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Tesseract not available: ${message}`);
      this.tesseractAvailable = false;
    }

    return this.tesseractAvailable;
  }

  private readNumber(key: string, fallback: number): number {
    const value = Number(this.config.get<string>(key));
    return Number.isFinite(value) ? value : fallback;
  }

  private readBoolean(key: string, fallback: boolean): boolean {
    const raw = this.config.get<string>(key);
    if (raw === undefined) {
      return fallback;
    }
    return raw === 'true' || raw === '1';
  }
}
