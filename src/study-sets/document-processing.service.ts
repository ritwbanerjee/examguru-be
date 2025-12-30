import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { createCanvas, ImageData, Path2D, loadImage, type Canvas } from '@napi-rs/canvas';
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

interface VisionOptions {
  allowVision?: boolean;
  visionPageCap?: number;
}

export interface ProcessingStats {
  totalPages: number;
  ocrPages: number;
  visionPages: number;
  visionImages: number;
  visionUnits: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
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
  ocrApplied: boolean;
  shortTokenRatio: number;
  needsVision: boolean;
  visionRankScore: number;
  needsVisionReason: string;
  imageCount: number;
  imageAreaRatio: number;
  vectorOps: number;
  pageImageKey?: string | null;
  visionSummary?: string | null;
  visionImageCount?: number;
  duplicateOf?: number | null;
}

interface TextSnapshot {
  pageNumber: number;
  extractedText: string;
  nativeTextChars: number;
  alphaRatio: number;
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
  private readonly strongTextCharThreshold: number;
  private readonly strongTextAlphaRatio: number;
  private readonly nativeTextOcrThreshold: number;
  private readonly textWinsCharThreshold: number;
  private readonly textWinsAlphaRatio: number;
  private readonly visionImageAreaRatioThreshold: number;
  private readonly visionVectorOpsThreshold: number;
  private readonly visionMinImageCount: number;
  private readonly visionBigImageTextThreshold: number;
  private readonly pageAnalysisConcurrency: number;
  private readonly visionMaxPages: number;
  private readonly visionMaxImages: number;
  private readonly visionMaxImageWidth: number;
  private readonly visionImageQuality: number;
  private readonly visionMinImagePixels: number;
  private readonly dedupeSimilarity: number;
  private readonly dedupeEnabled: boolean;
  private readonly standardFontDataUrl: string;
  private readonly pdfObjectProbeTimeoutMs: number;
  private readonly pdfObjectTimeoutMs: number;
  private readonly pdfObjectVisionTimeoutMs: number;
  private readonly visionPageTimeoutMs: number;
  private readonly visionRequestTimeoutMs: number;
  private readonly slidesOcrThreshold: number;
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
    this.strongTextCharThreshold = this.readNumber('STRONG_TEXT_CHAR_THRESHOLD', 800);
    this.strongTextAlphaRatio = this.readNumber('STRONG_TEXT_ALPHA_RATIO', 0.8);
    this.nativeTextOcrThreshold = this.readNumber('NATIVE_TEXT_OCR_THRESHOLD', 180);
    this.textWinsCharThreshold = this.readNumber('TEXT_WINS_CHAR_THRESHOLD', 300);
    this.textWinsAlphaRatio = this.readNumber('TEXT_WINS_ALPHA_RATIO', 0.25);
    this.visionImageAreaRatioThreshold = this.readNumber('VISION_IMAGE_AREA_RATIO_THRESHOLD', 0.25);
    this.visionVectorOpsThreshold = this.readNumber('VISION_VECTOR_OPS_THRESHOLD', 30);
    this.visionMinImageCount = this.readNumber('VISION_MIN_IMAGE_COUNT', 2);
    this.visionBigImageTextThreshold = this.readNumber('VISION_BIG_IMAGE_TEXT_THRESHOLD', 800);
    const maxVisionOverride = this.readNumber('MAX_VISION_PAGES', Number.NaN);
    this.visionMaxPages = Number.isFinite(maxVisionOverride)
      ? maxVisionOverride
      : this.readNumber('VISION_MAX_PAGES', 0);
    this.visionMaxImages = this.readNumber('VISION_MAX_IMAGES', 2);
    this.visionMaxImageWidth = this.readNumber('VISION_MAX_IMAGE_WIDTH', 1024);
    this.visionImageQuality = this.readNumber('VISION_IMAGE_QUALITY', 0.7);
    this.visionMinImagePixels = this.readNumber('VISION_MIN_IMAGE_PIXELS', 10000);
    this.dedupeSimilarity = this.readNumber('DEDUP_SIMILARITY', 0.95);
    this.dedupeEnabled = this.readBoolean('DEDUP_ENABLED', true);
    this.pageAnalysisConcurrency = this.readNumber('PAGE_ANALYSIS_CONCURRENCY', 4);
    this.pdfObjectProbeTimeoutMs = this.readNumber('PDFJS_OBJECT_TIMEOUT_PROBE_MS', 400);
    this.pdfObjectTimeoutMs = this.readNumber('PDFJS_OBJECT_TIMEOUT_MS', 6000);
    this.pdfObjectVisionTimeoutMs = this.readNumber('PDFJS_OBJECT_TIMEOUT_VISION_MS', 15000);
    this.visionPageTimeoutMs = this.readNumber('VISION_PAGE_TIMEOUT_MS', 20000);
    this.visionRequestTimeoutMs = this.readNumber('VISION_REQUEST_TIMEOUT_MS', 45000);
    this.slidesOcrThreshold = this.readNumber('SLIDES_OCR_THRESHOLD', 80);
    const pdfjsRoot = path.dirname(require.resolve('pdfjs-dist/package.json'));
    this.standardFontDataUrl = path.join(pdfjsRoot, 'standard_fonts/');
  }

  async buildStudySource(file: AiProcessFileSnapshot, options?: VisionOptions): Promise<string> {
    const result = await this.buildStudySourceWithStats(file, options);
    return result.text;
  }

  async buildStudySourceWithStats(
    file: AiProcessFileSnapshot,
    options: VisionOptions = {}
  ): Promise<{ text: string; stats: ProcessingStats }> {
    if (file.textContent?.trim()) {
      return {
        text: file.textContent.trim(),
        stats: {
          totalPages: 1,
          ocrPages: 0,
          visionPages: 0,
          visionImages: 0,
          visionUnits: 0,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0
        }
      };
    }

    if (!file.storageKey) {
      throw new Error(`Missing storage key for ${file.fileName}`);
    }

    if (file.extension !== 'pdf') {
      throw new Error(`Unsupported file type ${file.extension} for ${file.fileName}`);
    }

    const buffer = await this.storage.getObjectBuffer(file.storageKey);
    const { pages, stats } = await this.extractPdfPagesWithStats(buffer, file, options);
    const combined = pages
      .map(page => this.formatPageText(page))
      .join('\n\n')
      .trim();

    if (!combined) {
      throw new Error(`No text could be extracted from ${file.fileName}`);
    }

    return { text: combined, stats };
  }

  private async extractPdfPagesWithStats(
    buffer: Buffer,
    file: AiProcessFileSnapshot,
    options: VisionOptions
  ): Promise<{ pages: PageExtraction[]; stats: ProcessingStats }> {
    const loadingTask = getDocument({
      data: new Uint8Array(buffer),
      standardFontDataUrl: this.standardFontDataUrl
    });
    const pdf = await loadingTask.promise;
    const pageNumbers = Array.from({ length: pdf.numPages }, (_, index) => index + 1);
    const textSnapshots = await this.mapWithConcurrency(
      pageNumbers,
      this.pageAnalysisConcurrency,
      async pageNumber => {
        const page = await pdf.getPage(pageNumber);
        const extractedText = await this.extractTextFromPage(page);
        return {
          pageNumber,
          extractedText,
          nativeTextChars: extractedText.length,
          alphaRatio: this.computeAlphaRatio(extractedText)
        };
      }
    );

    const docType = this.classifyDocumentFromText(textSnapshots);
    this.logger.log(`Document classified as ${docType} (${pdf.numPages} pages).`);

    const allowVision = options.allowVision !== false;
    const visionPageCap = options.visionPageCap ?? this.visionMaxPages;
    const pageImageKeyByPage = new Map<number, string>();
    (file.pageImageKeys ?? []).forEach(entry => {
      if (entry?.pageNumber && entry.storageKey) {
        pageImageKeyByPage.set(entry.pageNumber, entry.storageKey);
      }
    });

    const snapshotByPage = new Map(textSnapshots.map(item => [item.pageNumber, item]));
    const ocrThreshold = docType === 'slides' ? this.slidesOcrThreshold : this.nativeTextOcrThreshold;
    const pagesWithHashes: Array<PageMeta & { hash?: Hash64 | null; allowDedupe?: boolean }> =
      await this.mapWithConcurrency(pageNumbers, this.pageAnalysisConcurrency, async pageNumber => {
        const snapshot = snapshotByPage.get(pageNumber);
        if (!snapshot) {
          throw new Error(`Missing text snapshot for page ${pageNumber}`);
        }

        const { extractedText, nativeTextChars, alphaRatio } = snapshot;
        const pageImageKey = pageImageKeyByPage.get(pageNumber) ?? null;
        const captionSignal = allowVision && this.hasDiagramCaption(extractedText);
        const strongTextWins =
          nativeTextChars >= this.strongTextCharThreshold &&
          alphaRatio >= this.strongTextAlphaRatio;
        const textWins =
          strongTextWins ||
          (nativeTextChars >= this.textWinsCharThreshold && alphaRatio >= this.textWinsAlphaRatio);
        const shouldOcr = !strongTextWins && nativeTextChars < ocrThreshold;
        const ocrApplied = shouldOcr;
        let ocrText = extractedText;
        let ocrConfidence: number | null = null;
        let shortTokenRatio = this.computeShortTokenRatio(ocrText);
        let media = { imageCount: 0, imageAreaRatio: 0, vectorOps: 0 };
        let hash: Hash64 | null = null;

        if ((!textWins && allowVision) || shouldOcr) {
          const page = await pdf.getPage(pageNumber);
          if (!textWins && allowVision) {
            media = await this.analyzePageMedia(page, this.pdfObjectProbeTimeoutMs);
          }

          if (shouldOcr) {
            const rendered = await this.renderPageForOcr(page);
            hash = this.computeDhash(rendered.imageData, rendered.width, rendered.height);
            const ocr = await this.runOcr(rendered.buffer);
            ocrText = ocr.text || extractedText;
            ocrConfidence = ocr.confidence;
            shortTokenRatio = ocr.shortTokenRatio;
          }
        }

        const ocrTextLen = ocrText.length;
        const imageHeavy = media.imageAreaRatio >= this.visionImageAreaRatioThreshold;
        const bigImageOverride =
          media.imageCount > 0 &&
          (imageHeavy || nativeTextChars < this.visionBigImageTextThreshold);
        const diagramImportant =
          media.vectorOps >= this.visionVectorOpsThreshold ||
          media.imageCount >= this.visionMinImageCount;
        const lowText = this.shouldUseVision(ocrTextLen, ocrConfidence, shortTokenRatio);
        const candidateByMedia = nativeTextChars <= this.strongTextCharThreshold && imageHeavy;
        let needsVision = false;
        let needsVisionReason = 'text-ok';

        if (!allowVision) {
          needsVision = false;
          needsVisionReason = 'vision-disabled';
        } else if (captionSignal && pageImageKey) {
          needsVision = true;
          needsVisionReason = 'diagram-caption';
        } else if (bigImageOverride) {
          needsVision = true;
          needsVisionReason = 'image-big-override';
        } else if (strongTextWins) {
          needsVision = false;
          needsVisionReason = 'text-strong';
        } else if (textWins) {
          needsVision = false;
          needsVisionReason = 'text-wins';
        } else if (media.imageCount === 0) {
          needsVision = false;
          needsVisionReason = 'no-images';
        } else if (!imageHeavy) {
          needsVision = false;
          needsVisionReason = 'image-area-low';
        } else if (!diagramImportant) {
          needsVision = false;
          needsVisionReason = 'image-not-important';
        } else if (!candidateByMedia) {
          needsVision = false;
          needsVisionReason = 'native-text-high';
        } else {
          needsVision = true;
          needsVisionReason = lowText ? 'image-heavy-low-text' : 'image-heavy-diagram';
        }

        const visionRankScore = this.computeVisionRankScore(
          media.imageAreaRatio,
          ocrTextLen,
          ocrConfidence,
          shortTokenRatio,
          media.vectorOps,
          captionSignal
        );

        this.logger.log(
          `Page ${pageNumber} decision: nativeTextChars=${nativeTextChars}, alphaRatio=${alphaRatio.toFixed(2)}, imageCount=${media.imageCount}, imageAreaRatio=${media.imageAreaRatio.toFixed(2)}, ocrChars=${ocrTextLen}, needsVision=${needsVision} (${needsVisionReason}).`
        );

        return {
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
          pageImageKey,
          duplicateOf: null,
          hash,
          allowDedupe: this.dedupeEnabled && this.isSafeToDedupe(nativeTextChars, media),
          ocrApplied
        };
      });

    const pages: PageMeta[] = [];
    const dedupeIndex: Array<{ hash: Hash64; pageNumber: number }> = [];
    const pagesSorted = pagesWithHashes.slice().sort((a, b) => a.pageNumber - b.pageNumber);

    for (const page of pagesSorted) {
      if (page.allowDedupe && page.hash) {
        const duplicateOf = this.findDuplicate(page.hash, dedupeIndex);
        if (duplicateOf) {
          page.duplicateOf = duplicateOf;
          page.needsVision = false;
          page.needsVisionReason = 'duplicate';
        } else {
          dedupeIndex.push({ hash: page.hash, pageNumber: page.pageNumber });
        }
      }
      pages.push(page);
    }

    const duplicateCount = pages.filter(page => page.duplicateOf).length;
    const visionCount = pages.filter(page => page.needsVision).length;
    this.logger.log(
      `OCR completed. Vision duplicates: ${duplicateCount}. Vision needed: ${visionCount}.`
    );

    const visionUsage = await this.applyVisionCaptions(pdf, pages, {
      allowVision,
      visionPageCap
    });

    const visionSelected = pages.filter(page => page.visionSummary && !page.duplicateOf);
    const visionUnits = visionSelected.reduce(
      (sum, page) =>
        sum + this.computeVisionUnits(page.visionImageCount ?? 0, page.imageAreaRatio),
      0
    );
    const stats: ProcessingStats = {
      totalPages: pages.length,
      ocrPages: pages.filter(page => page.ocrApplied).length,
      visionPages: visionSelected.length,
      visionImages: visionSelected.reduce((sum, page) => sum + (page.visionImageCount ?? 0), 0),
      visionUnits,
      inputTokens: visionUsage.inputTokens,
      outputTokens: visionUsage.outputTokens,
      totalTokens: visionUsage.totalTokens
    };

    return {
      pages: pages.map(page => ({
        pageNumber: page.pageNumber,
        text: page.text,
        needsVision: page.needsVision,
        visionSummary: page.visionSummary ?? null
      })),
      stats
    };
  }

  private classifyDocumentFromText(textSnapshots: TextSnapshot[]): 'slides' | 'text' {
    const sampleCount = Math.min(this.slidesSamplePages, textSnapshots.length);
    if (!sampleCount) {
      return 'text';
    }

    const sampled = textSnapshots
      .slice()
      .sort((a, b) => a.pageNumber - b.pageNumber)
      .slice(0, sampleCount);
    const imagePages = sampled.filter(page => page.nativeTextChars < this.slidesTextThreshold).length;
    const ratio = imagePages / sampleCount;
    return ratio >= this.slidesImageRatio ? 'slides' : 'text';
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

  private async applyVisionCaptions(
    pdf: any,
    pages: PageMeta[],
    options: { allowVision: boolean; visionPageCap: number }
  ): Promise<TokenUsage> {
    const usageTotal = this.emptyUsage();
    if (!options.allowVision || options.visionPageCap <= 0) {
      this.logger.log('Vision disabled for this file based on plan or caps.');
      return usageTotal;
    }
    if (!this.openai) {
      this.logger.warn('OpenAI API key missing. Skipping vision analysis.');
      return usageTotal;
    }

    const candidates = pages.filter(
      page => page.needsVision && !page.duplicateOf && (page.imageCount > 0 || page.pageImageKey)
    );
    if (!candidates.length) {
      return usageTotal;
    }

    let selected = candidates;
    const maxPages = options.visionPageCap > 0 ? options.visionPageCap : this.visionMaxPages;
    if (maxPages > 0 && candidates.length > maxPages) {
      selected = candidates
        .slice()
        .sort((a, b) => b.visionRankScore - a.visionRankScore)
        .slice(0, maxPages);
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
      let images: Array<{ width: number; height: number; data: Uint8ClampedArray }> = [];
      if (pageMeta.imageCount > 0) {
        const page = await pdf.getPage(pageMeta.pageNumber);
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
      }
      let dataUrl = images.length ? this.buildVisionImageDataUrl(images) : null;
      if (dataUrl) {
        pageMeta.visionImageCount = images.length;
      }

      if (!dataUrl && pageMeta.pageImageKey) {
        const fallback = await this.buildVisionDataUrlFromPageImage(pageMeta.pageImageKey);
        if (fallback) {
          dataUrl = fallback.dataUrl;
          pageMeta.visionImageCount = 1;
          pageMeta.imageAreaRatio = Math.max(pageMeta.imageAreaRatio, fallback.areaRatio);
        }
      }

      this.logger.log(`Vision image count for page ${pageMeta.pageNumber}: ${pageMeta.visionImageCount ?? 0}.`);
      if (!dataUrl) {
        pageMeta.needsVision = false;
        pageMeta.needsVisionReason = 'no-images-after-extract';
        continue;
      }

      const start = Date.now();
      const visionResult = await this.describePageWithVisionUsingImage(
        dataUrl,
        pageMeta.text,
        pageMeta.pageNumber,
        pdf.numPages
      );
      this.addUsage(usageTotal, visionResult?.usage);
      pageMeta.visionSummary = visionResult?.summary ?? null;
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
    return usageTotal;
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
    page: any,
    timeoutMs: number
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

      const image = await this.waitForPdfObject(page, objId, timeoutMs);
      if (image?.width && image?.height) {
        imageCount += 1;
        imageArea += image.width * image.height;
      }
    }

    return {
      imageCount,
      imageAreaRatio: Math.min(1, imageArea / pageArea),
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

  private emptyUsage(): TokenUsage {
    return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  }

  private addUsage(target: TokenUsage, usage?: TokenUsage | null): void {
    if (!usage) {
      return;
    }
    target.inputTokens += usage.inputTokens;
    target.outputTokens += usage.outputTokens;
    target.totalTokens += usage.totalTokens;
  }

  private extractUsage(response: { usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } }): TokenUsage {
    const inputTokens = response.usage?.prompt_tokens ?? 0;
    const outputTokens = response.usage?.completion_tokens ?? 0;
    return {
      inputTokens,
      outputTokens,
      totalTokens: response.usage?.total_tokens ?? inputTokens + outputTokens
    };
  }

  private async mapWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    worker: (item: T, index: number) => Promise<R>
  ): Promise<R[]> {
    const limit = Math.max(1, Math.floor(concurrency));
    const results = new Array<R>(items.length);
    let index = 0;

    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (true) {
        const current = index;
        index += 1;
        if (current >= items.length) {
          return;
        }
        results[current] = await worker(items[current], current);
      }
    });

    await Promise.all(runners);
    return results;
  }

  private computeVisionRankScore(
    imageAreaRatio: number,
    textLength: number,
    confidence: number | null,
    shortTokenRatio: number,
    vectorOps: number,
    captionSignal: boolean
  ): number {
    let score = 0;
    score += imageAreaRatio * 2;
    if (captionSignal) {
      score += 1;
    }
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

  private hasDiagramCaption(text: string): boolean {
    if (!text) {
      return false;
    }
    return /(figure|fig\.|diagram|visual connection|illustration|chart|graph|table)/i.test(text);
  }

  private computeVisionUnits(imageCount: number, imageAreaRatio: number): number {
    if (imageCount <= 0 || imageAreaRatio <= 0) {
      return 0;
    }
    return imageCount * imageAreaRatio;
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
  ): Promise<{ summary: string | null; usage: TokenUsage }> {
    try {
      const imageBytes = this.estimateDataUrlBytes(imageDataUrl);
      this.logger.log(
        `Vision request page ${pageNumber}/${totalPages}: image attached (${imageBytes} bytes).`
      );
      const prompt = [
        '=== STRICT JSON OUTPUT MODE ===',
        'Return ONLY a valid JSON object. No extra text.',
        '',
        `You are analyzing extracted images from page ${pageNumber} of ${totalPages} in a student's PDF notes.`,
        'Focus ONLY on diagram labels and relationships (no full slide transcription).',
        'Keep the output concise and structured for downstream study generation.',
        '',
        'Required JSON format:',
        '{',
        '  "labels": [string],',
        '  "relationships": [{"from": string, "to": string, "label": string}]',
        '}',
        '',
        'Rules:',
        '- If unsure, use empty arrays but keep keys.',
        extractedText
          ? `Extracted text (may be incomplete): ${extractedText}`
          : 'Extracted text was minimal or empty.'
      ].join('\n');

      const openai = this.openai;
      if (!openai) {
        return { summary: null, usage: this.emptyUsage() };
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
        max_tokens: 200
        }),
        this.visionRequestTimeoutMs,
        `vision request page ${pageNumber}`
      );

      const content = response.choices?.[0]?.message?.content?.trim();
      if (!content) {
        this.logger.warn(`Vision response was empty for page ${pageNumber}.`);
        return { summary: null, usage: this.extractUsage(response) };
      }
      return { summary: content, usage: this.extractUsage(response) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Vision analysis failed for page ${pageNumber}: ${message}`);
      return { summary: null, usage: this.emptyUsage() };
    }
  }

  private estimateDataUrlBytes(dataUrl: string): number {
    if (!dataUrl) {
      return 0;
    }
    const commaIndex = dataUrl.indexOf(',');
    if (commaIndex < 0) {
      return 0;
    }
    const base64 = dataUrl.slice(commaIndex + 1);
    const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
    return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
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

  private async buildVisionDataUrlFromPageImage(
    storageKey: string
  ): Promise<{ dataUrl: string; areaRatio: number } | null> {
    try {
      const buffer = await this.storage.getObjectBuffer(storageKey);
      const image = await loadImage(buffer);
      const width = Math.max(1, Math.floor(image.width));
      const height = Math.max(1, Math.floor(image.height));

      const marginTop = Math.round(height * 0.05);
      const marginBottom = Math.round(height * 0.08);
      const marginSide = Math.round(width * 0.03);
      const cropWidth = Math.max(1, width - marginSide * 2);
      const cropHeight = Math.max(1, height - marginTop - marginBottom);

      const canvas = createCanvas(cropWidth, cropHeight);
      const context = canvas.getContext('2d');
      context.drawImage(
        image as any,
        marginSide,
        marginTop,
        cropWidth,
        cropHeight,
        0,
        0,
        cropWidth,
        cropHeight
      );

      const scaled = this.scaleCanvasToMaxWidth(canvas, this.visionMaxImageWidth);
      const output = scaled.toBuffer('image/jpeg', this.visionImageQuality);
      const areaRatio = (cropWidth * cropHeight) / (width * height);
      return {
        dataUrl: `data:image/jpeg;base64,${output.toString('base64')}`,
        areaRatio
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to prepare page image for vision: ${message}`);
      return null;
    }
  }

  private scaleCanvasToMaxWidth(canvas: Canvas, maxWidth: number): Canvas {
    if (maxWidth <= 0 || canvas.width <= maxWidth) {
      return canvas;
    }
    const scale = maxWidth / canvas.width;
    const targetHeight = Math.max(1, Math.round(canvas.height * scale));
    const scaled = createCanvas(maxWidth, targetHeight);
    const context = scaled.getContext('2d');
    context.drawImage(canvas, 0, 0, scaled.width, scaled.height);
    return scaled;
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
