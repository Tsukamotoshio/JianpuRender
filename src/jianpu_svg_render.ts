/**
 * @license
 * Copyright 2025 flufy3d. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * =============================================================================
 */

import {
  LINE_STROKE_WIDTH, COMPACT_SPACING_FACTOR, UNDERLINE_SPACING_FACTOR,
  OCTAVE_DOT_OFFSET_FACTOR, DOT_SIZE_FACTOR, AUGMENTATION_DASH_FACTOR,
  FONT_SIZE_MULTIPLIER, SMALL_FONT_SIZE_MULTIPLIER, DURATION_LINE_SCALES,
  DYNAMIC_Y_FACTOR, DYNAMIC_FONT_SIZE_MULTIPLIER,
  HAIRPIN_HEIGHT_FACTOR, HAIRPIN_GAP_FACTOR,
  LYRIC_OFFSET_FACTOR
} from './render_constants';

import {
  SVGNS, drawSVGPath, drawSVGText, createSVGGroupChild, setBlinkAnimation,
  setStroke, highlightElement, resetElementHighlight, measureSVGTextWidth
} from './svg_tools';

import  {
  PATH_SCALE, ACCIDENTAL_TEXT, // Using text for accidentals
  barPath, underlinePath, augmentationDashPath, tiePath, dotPath,
  crescendoPath, decrescendoPath
} from './svg_paths';

import {
  JianpuInfo, TimeSignatureInfo, NoteInfo,
   DEFAULT_TIME_SIGNATURE
} from './jianpu_info';

import {
  JianpuBlock, JianpuNote
} from './jianpu_block';

import {
  JianpuModel
} from './jianpu_model';

import { PITCH_CLASS_NAMES } from './model_constants';

import {
  BeamGroup, beamLevelsBetweenConsecutiveBlocks, computeBeamGroups
} from './beam_grouping';


/**
 * Enumeration of different ways of horizontal score scrolling.
 */
export enum ScrollType {
  PAGE = 0, // Scroll page by page
  NOTE = 1, // Center each highlighted note
  BAR = 2   // Scroll to center the start of a measure when its first note is highlighted
}

/**
 * Configuration options for JianpuSVGRender.
 */
export interface JianpuSVGRenderConfig {
  /** Base vertical height in pixels for a standard note number (e.g., '1'). Controls overall scale. */
  noteHeight?: number;
  /** Horizontal spacing factor in COMPACT mode (multiple of note width). This factor determines the base gap *after* a note. */
  noteSpacingFactor?: number;
  /** Pixels per quarter note in PROPORTIONAL mode. 0 or undefined for COMPACT mode. */
  pixelsPerTimeStep?: number;
  /** Color for standard notes/symbols (RGB string or CSS color name). */
  noteColor?: string;
  /** Color for highlighted/active notes (RGB string or CSS color name). */
  activeNoteColor?: string;
  /** Default key signature (0-11) if not specified in JianpuInfo at time 0. */
  defaultKey?: number;
  /** Scroll behavior during playback. */
  scrollType?: ScrollType;
  /** Font family for rendering numbers and text. */
  fontFamily?: string;
  /** Explicitly set the width of the SVG container */
  width?: number;
   /** Explicitly set the height of the SVG container */
  height?: number;
  /** Whether to draw the measure (bar) number centered above each measure-start bar line. Default false. */
  showBarNumbers?: boolean;
  /** Whether to draw tempo markings as "♩=qpm" after the key/time signatures at
   *  the start of the score, and inline at every tempo change within the score.
   *  Default false. Note: the quarter-note glyph (♩, U+2669) is written as plain
   *  text and relies on the browser's font fallback to render. */
  showTempoMarking?: boolean;
  /** Called when a rendered note is clicked. Receives the note data and its SVG group. */
  onNoteClick?: (note: JianpuNote, element: SVGGElement) => void;
  /**
   * Fork: lay the score out as LilyPond prints it: notes spaced by duration
   * with LilyPond's own rules, wrapped into lines no wider than this many
   * pixels (breaking only at barlines), every line -- the last one too --
   * justified so that its last barline sits at the right edge; a score that
   * fits on one line keeps its natural spacing, as LilyPond's does. A measure
   * wider than the line gets a line of its own and is neither squeezed nor
   * stretched. Compact mode only. 0, the default, keeps the whole score on one
   * line with the original compact spacing. Lays out what one redraw() pass
   * draws: a later incremental pass carries on from the last line without
   * reflowing what is already there.
   */
  lineWidth?: number;
}

/**
 * Fork: one measure while wrapping. It is drawn into a group of its own, in x
 * relative to its own start; once its width is known it is placed on a line
 * (`line`, `offset` from the line's left edge) by moving that group. What it
 * holds is recorded so that justifying its line can move it: its blocks and
 * barlines by where they start (`x`, measure-relative, before justifying),
 * and the beams, which are only drawn then.
 */
interface MeasureFrame {
  g: SVGGElement;
  line: number;
  offset: number;
  width: number;
  /**
   * Each block, where it starts, and its spring (see spacing()): the room it
   * would like, the least it can have, and how readily it stretches.
   */
  blocks: Array<{ g: SVGGElement; x: number; ideal: number; min: number; k: number }>;
  /** How far justifying its line has moved this measure's start. */
  shiftStart: number;
  bars: Array<{ el: SVGPathElement; x: number }>;
  beams: Array<{ group: BeamGroup; anchors: Array<{ x: number; width: number; at: number }> }>;
  /** x of its closing barline (the score's final barline for the last measure). */
  closingBarX?: number;
}

/**
 * Fork: a line of the wrapped score: its group, where its next measure goes,
 * and once it is justified, how far a point of one of its measures has moved
 * (`shift`, given the measure and where the point starts in it) and where its
 * last barline now is (`end`).
 */
interface LineInfo {
  g: SVGGElement;
  x: number;
  measures: MeasureFrame[];
  shift?: (m: MeasureFrame, x: number) => number;
  end?: number;
}

/** Internal structure to track visual elements tied together (e.g., across blocks). */
interface LinkedSVGDetails {
  /** The SVG group element containing the note parts. */
  g: SVGGElement;
  /** x position at the rightmost edge of the note number/dots/dashes (for tie start). */
  xNoteRight: number;
  /** y position of the note number baseline (for tie vertical placement). */
  yNoteBaseline: number;
  /** Fork: the measure the note was drawn in while wrapping (null on one line); xNoteRight is relative to it. */
  frame: MeasureFrame | null;
  /** Fork: where the note's block starts in that measure -- the point it moves with when its line is justified. */
  at: number;
}

/**
 * Fork: a tie or hairpin, while wrapping. Its two ends move by different
 * amounts when a line is justified, so it is drawn only once the line it ends
 * on is -- in one piece, or in two if a line break falls in between. `at`
 * fields are the block starts each end moves with (see LinkedSVGDetails.at).
 */
interface PendingTie {
  from: LinkedSVGDetails;
  toG: SVGGElement;
  toX: number;
  toAt: number;
  to: MeasureFrame;
}
interface PendingHairpin {
  direction: string;
  xFrom: number;
  fromAt: number;
  from: MeasureFrame;
  xTo: number;
  toAt: number;
  to: MeasureFrame;
}

/** Map to link logical notes to their rendered SVG elements for ties. */
type LinkedNoteMap = Map<JianpuNote, LinkedSVGDetails>;

/**
 * Builds the stable `data-id` for a note's SVG group from its start time and
 * pitch. `start` is quantized to the same 1e-6 tolerance this codebase
 * already treats as "the same instant" everywhere else (see e.g.
 * `JianpuModel.isLastMeasureAtQ()` or the "Fill Rests" comparisons in
 * `infoToBlocks()`) — without this, a `start` value that arrives at the same
 * musical position via a different chain of floating-point additions (e.g.
 * `0.9999999959999997` instead of `1`) produces a *different* id for what is
 * musically the same note. That breaks two things at once: `redraw(note,
 * true)` looks up the SVG group by recomputing this same id from a
 * caller-supplied `NoteInfo`, so any drift between the id computed at draw
 * time and the id computed at highlight time makes playback highlighting
 * silently no-op; and consumers that persist ids across re-renders (e.g. for
 * mouse hit-testing) see a note's identity change even when nothing about
 * the note itself changed. `pitch` is always an integer MIDI value, so it
 * never needs quantizing.
 */
export function noteElementId(start: number, pitch: number): string {
  return `${start.toFixed(6)}-${pitch}`;
}

/**
 * Renders `JianpuInfo` data as numbered musical notation (Jianpu) in an SVG element.
 */
export class JianpuSVGRender {
  public jianpuInfo: JianpuInfo;
  public jianpuModel: JianpuModel;
  private config: Required<JianpuSVGRenderConfig>; // Use Required for internal consistency
  private height: number;
  private width: number;

  // SVG Elements
  private parentElement: HTMLElement; // The user-provided container div's direct child for scrolling
  private div: HTMLDivElement;       // The user-provided container div
  private mainSVG: SVGSVGElement;    // The main SVG drawing area
  private mainG: SVGGElement;        // Top-level group in mainSVG for transforms
  private musicG: SVGGElement;       // Group for notes, rests, ties, bar lines
  private signaturesG: SVGGElement;  // Group for key/time signatures *within* the scrollable area
  private overlaySVG: SVGSVGElement; // Fixed overlay SVG for current signatures
  private overlayG: SVGGElement;     // Group within overlaySVG
  private headerG: SVGGElement;      // Fork: title block at the top of mainSVG, above mainG
  private headerHeight = 0;          // Fork: height the title block takes; everything else sits below it
  private headerMinWidth = 0;        // Fork: the title block's width, so a short score still holds it
  private leftMargin = 0;            // Fork: room before the first note for its accidental
  // Fork: line wrapping (config.lineWidth); see MeasureFrame.
  private lines: LineInfo[] = [];
  private measure: MeasureFrame | null = null;   // the measure being drawn, while wrapping
  private blockAt = 0;                           // where the block being drawn starts in it
  private staffSpace = 0;                        // LilyPond's unit, in px, while wrapping (see spacing())
  private shortestQ = 0.75;                      // the piece's common shortest duration, in quarters
  private nextOverhang = 0;                      // how far the next note's accidental reaches left of it
  private pendingTies: PendingTie[] = [];
  private pendingHairpins: PendingHairpin[] = [];

  // State
  private signaturesBlinking: boolean;
  private lastKnownScrollLeft: number;
  private isScrolling: boolean;
  private currentKey: number;
  private currentKeyLabel?: string;   // Fork: caption to draw verbatim, when the caller gave one
  private currentTimeSignature: TimeSignatureInfo;
  private currentTempoQpm: number;
  private playingNotes: Map<string, NoteInfo>; // Map key: `${start}-${pitch}`
  private lastRenderedQ: number; // Track the last quarter note time rendered
  private estimatedNoteWidth: number; // Estimated width of a basic number for spacing
  private destroyed: boolean; // 已销毁标志，阻止后续 clear/redraw 操作

  // Hot-path element caches (avoid full-tree querySelector on every highlighted note)
  private noteGroupCache: Map<string, SVGGElement>; // Key: noteId `${start}-${pitch}`

  // Click-delegation map: noteId `${start}-${pitch}` → the JianpuNote drawn
  // into the note group carrying that data-id. Filled in drawNotes, cleared
  // whenever the SVG structure is rebuilt (clear) or released (destroy).
  private noteById: Map<string, JianpuNote>;

  // Beam grouping (see beam_grouping.ts): which BeamGroup (if any) each block
  // belongs to, and the x/width anchors recorded so far for each group's
  // blocks as they get drawn one at a time in time order. A group's merged
  // beam bar(s) are drawn once its last block's anchor is recorded.
  // Recomputed fresh on every full `redraw()` call. A group whose blocks are
  // split across two *partial* redraw calls is not reconciled: the editor
  // integration re-renders from a fresh instance on every edit rather than
  // appending to an existing one, so that path stays unexercised.
  private beamGroupByBlock: Map<JianpuBlock, BeamGroup>;
  private beamGroupAnchors: Map<BeamGroup, Array<{ x: number; width: number; at: number }>>;
  /**
   * The hairpin waiting for the note that closes it, during one drawing pass
   * (fork addition). A hairpin spans notes, so it can only be drawn once the
   * note it ends on has a position -- the same bookkeeping ties already do.
   * `markEl` is the dynamic drawn on the note it started from, kept so an
   * unfinished hairpin can take it away again; see finishOpenHairpin().
   */
  private openHairpin: {
    direction: string; xFrom: number; markEl: SVGTextElement | null;
    frame: MeasureFrame | null;   // fork: the measure xFrom is relative to, while wrapping
    at: number;                   // fork: and where its note's block starts in it
  } | null = null;

  // Layout & Scaling
  private numberFontSize: number;
  private smallFontSize: number;
  private yBaseline: number; // Vertical position for the number baseline


    /**
     * 解析多种格式的颜色字符串为有效的CSS颜色值
     * @param colorStr 颜色字符串，支持格式："blue"、"rgb(255,165,0)"、"255,165,0"
     * @returns 标准化的CSS颜色字符串
     */
    private parseColorString(colorStr: string): string {
        // 如果是CSS颜色名称或rgb()格式，直接返回
        if (/^[a-z]+$/i.test(colorStr) || colorStr.startsWith('rgb(')) {
            return colorStr;
        }
        // 处理"255,165,0"格式
        if (/^\d+,\s*\d+,\s*\d+$/.test(colorStr)) {
            return `rgb(${colorStr})`;
        }
        return colorStr; // 默认返回原字符串
    }


  /**
   * `JianpuSVGRender` constructor.
   * @param score The `JianpuInfo` to visualize.
   * @param config Visualization configuration options.
   * @param div The HTMLDivElement where the visualization should be displayed.
   */
  constructor(
    score: JianpuInfo,
    config: JianpuSVGRenderConfig,
    div: HTMLDivElement
  ) {
    this.jianpuInfo = score;
    this.div = div;

    // --- Default Configuration ---
    const defaultNoteHeight = 20; // Base size in pixels
    const defaultPixelsPerTimeStep = 0; // Default to compact mode
    this.config = {
      noteHeight: config.noteHeight ?? defaultNoteHeight,
      noteSpacingFactor: config.noteSpacingFactor ?? COMPACT_SPACING_FACTOR,
      pixelsPerTimeStep: config.pixelsPerTimeStep ?? defaultPixelsPerTimeStep,
      noteColor: this.parseColorString(config.noteColor ?? 'black'),
      activeNoteColor: this.parseColorString(config.activeNoteColor ?? 'red'),
      defaultKey: config.defaultKey ?? 0, // Default to C Major
      scrollType: config.scrollType ?? ScrollType.PAGE,
      fontFamily: config.fontFamily ?? 'sans-serif',
      width: config.width ?? 0, // Auto-width by default
      height: config.height ?? 0, // Auto-height by default
      showBarNumbers: config.showBarNumbers ?? false,
      showTempoMarking: config.showTempoMarking ?? false,
      onNoteClick: config.onNoteClick, // 可选回调，无默认值
      lineWidth: config.lineWidth ?? 0,
    };

     // --- Initial Model Creation ---
    this.jianpuModel = new JianpuModel(this.jianpuInfo, this.config.defaultKey);
    this.currentKey = this.jianpuModel.measuresInfo.keySignatureAtQ(0);
    this.currentKeyLabel = this.jianpuModel.measuresInfo.keySignatureLabelAtQ(0);
    this.currentTimeSignature = this.jianpuModel.measuresInfo.timeSignatureAtQ(0) ?? DEFAULT_TIME_SIGNATURE;
    this.currentTempoQpm = this.jianpuModel.measuresInfo.tempoAtQ(0);


    // --- Initialize State & Layout ---
    this.playingNotes = new Map();
    this.noteGroupCache = new Map();
    this.noteById = new Map();
    this.lastRenderedQ = -1;
    this.signaturesBlinking = false;
    this.lastKnownScrollLeft = 0;
    this.isScrolling = false;
    this.beamGroupByBlock = new Map();
    this.beamGroupAnchors = new Map();
    this.destroyed = false;

    // Calculate scaling and font sizes based on noteHeight
    this.numberFontSize = this.config.noteHeight * FONT_SIZE_MULTIPLIER;
    this.smallFontSize = this.config.noteHeight * SMALL_FONT_SIZE_MULTIPLIER;
     // Estimate width for spacing (crude, might need measurement)
    this.estimatedNoteWidth = this.numberFontSize * 0.6; // Guess based on typical font aspect ratio
    // Fork: the first note's accidental hangs to the left of its digit; with
    // the music starting at x = 0 it was drawn outside the SVG and cut off.
    this.leftMargin = this.estimatedNoteWidth * 0.8;
    // Position baseline: place it slightly above center for balanced look with dots/lines
    this.yBaseline = this.config.noteHeight * 1.5; // Start baseline lower to allow space above

    this.height = 0; // Will be calculated
    this.width = 0; // Will be calculated

    this.clear(); // Setup SVG structure
    this.redraw(); // Initial drawing
  }

  /**
   * Clears the SVG elements and resets internal state for a fresh draw.
   */
  public clear() {
    if (this.destroyed) return; // 已销毁：不重建 SVG 结构，避免复活已释放的资源
    // Empty the container div
    while (this.div.lastChild) {
      this.div.removeChild(this.div.lastChild);
    }
    this.openHairpin = null;   // fork: the element it pointed at is gone too
    this.lines = [];
    this.measure = null;
    this.pendingTies = [];
    this.pendingHairpins = [];
    this.div.style.position = 'relative'; // Needed for overlay positioning
    this.div.style.overflow = 'hidden'; // Hide internal scrollbars if parentElement scrolls

    // --- Overlay for Fixed Signatures ---
    this.overlaySVG = document.createElementNS(SVGNS, 'svg');
    this.overlaySVG.style.position = 'absolute';
    this.overlaySVG.style.left = '0';
    this.overlaySVG.style.top = '0';
    this.overlaySVG.style.pointerEvents = 'none'; // Allow interaction with content below
    this.div.appendChild(this.overlaySVG);
    this.overlayG = createSVGGroupChild(this.overlaySVG, 'overlay');

    // --- Scrollable Container ---
    this.parentElement = document.createElement('div');
    this.parentElement.style.overflowX = 'auto'; // Enable horizontal scrolling
    this.parentElement.style.overflowY = 'hidden'; // Vertical scroll managed by overall height
    this.parentElement.style.width = '100%';
    this.parentElement.style.height = '100%'; // Take available space
    this.div.appendChild(this.parentElement);
    this.parentElement.addEventListener('scroll', this.handleScrollEvent);

    // --- Main SVG for Score Content ---
    this.mainSVG = document.createElementNS(SVGNS, 'svg');
    this.mainSVG.style.display = 'block'; // Prevent extra space below SVG
    this.parentElement.appendChild(this.mainSVG);
    this.headerG = createSVGGroupChild(this.mainSVG, 'header'); // Fork: outside mainG's offset
    this.mainG = createSVGGroupChild(this.mainSVG, 'main-content');

    // Specific layers within main content
    this.signaturesG = createSVGGroupChild(this.mainG, 'signatures'); // In-line signatures
    this.musicG = createSVGGroupChild(this.mainG, 'music'); // Notes, rests, bars, ties

    // Click delegation for note interaction: a single listener on the SVG root
    // instead of one per note group. handleNoteClick is a stable arrow-function
    // reference, so the removeEventListener in destroy() always targets the
    // same listener instance.
    this.mainSVG.addEventListener('click', this.handleNoteClick);

    // Reset state
    this.playingNotes.clear();
    this.noteGroupCache.clear(); // 重建后旧 SVG 元素全部失效，缓存必须一并清空
    this.noteById.clear(); // 重建后旧 noteId 映射一并失效，由 drawNotes 重新填充
    this.lastRenderedQ = -1;
    this.signaturesBlinking = false;
    this.lastKnownScrollLeft = 0;
    this.isScrolling = false;
    this.height = this.config.height > 0 ? this.config.height : this.config.noteHeight * 5; // Initial guess
    this.width = this.config.width > 0 ? this.config.width : this.leftMargin;

    // Initial signature setup
    this.currentKey = this.jianpuModel.measuresInfo.keySignatureAtQ(0);
    this.currentKeyLabel = this.jianpuModel.measuresInfo.keySignatureLabelAtQ(0);
    this.currentTimeSignature = this.jianpuModel.measuresInfo.timeSignatureAtQ(0) ?? DEFAULT_TIME_SIGNATURE;
    this.currentTempoQpm = this.jianpuModel.measuresInfo.tempoAtQ(0);
    this.drawHeader();
    this.drawSignatures(this.overlayG, 0, true, true, this.drawsTempo()); // Draw initial signatures in overlay
    this.updateLayout(); // Set initial sizes
  }

  /**
   * Destroys the renderer and releases all resources it holds:
   * removes the scroll listener from parentElement, stops the overlay blink
   * animation, empties the container div and drops every cached element
   * reference. After this call the instance is unusable — clear() and
   * redraw() become no-ops (returning -1) instead of rebuilding the SVG.
   */
  public destroy(): void {
    if (this.destroyed) return; // Already destroyed, nothing left to release
    this.parentElement.removeEventListener('scroll', this.handleScrollEvent); // handleScrollEvent is a stable arrow-function reference
    // Defensive: the click listener dies together with mainSVG once it is
    // detached below, but remove it explicitly in case the detached SVG is
    // ever re-attached externally. Same stable reference as in clear().
    this.mainSVG.removeEventListener('click', this.handleNoteClick);
    setBlinkAnimation(this.overlayG, false); // Stop the signature blink animation
    while (this.div.lastChild) {
      this.div.removeChild(this.div.lastChild);
    }
    this.playingNotes.clear();
    this.noteGroupCache.clear();
    this.noteById.clear();
    this.destroyed = true;
  }

  /** Fork: draw the tempo mark only when asked to, or when the score declares one. */
  private drawsTempo(): boolean {
    return !!this.config.showTempoMarking || !!(this.jianpuInfo.header && this.jianpuInfo.header.tempo);
  }

  /**
   * Fork: the title block, as the PDF prints it above the first system --
   * title centred, composer right-aligned below it. Centred on the width the
   * staff is shown in, not on the score's full (scrolling) width, so it sits
   * over the start of the music like a page header. Sets headerHeight; the
   * signatures and the music are laid out below it.
   */
  private drawHeader(): void {
    this.headerHeight = 0;
    this.headerMinWidth = 0;
    const header = this.jianpuInfo.header;
    if (!header || (!header.title && !header.composer)) return;
    const visible = this.wraps() ? this.config.lineWidth
      : (this.parentElement.clientWidth || this.div.clientWidth || 600);
    const pad = this.config.noteHeight * 0.4;
    const titleSize = this.numberFontSize * 0.9;
    const composerSize = this.smallFontSize;
    let y = pad;
    // 放不下就别居中/靠右了：从左边距起排，SVG 撑到装得下为止（不裁掉）。
    let needed = visible;
    if (header.title) {
      y += titleSize;
      const title = drawSVGText(this.headerG, header.title, visible / 2, y, `${titleSize}px`,
        'normal', 'middle', 'alphabetic', this.config.noteColor, 1, this.config.fontFamily);
      title.setAttribute('data-header', 'title');
      const w = title.getBBox().width;
      if (w + 2 * this.leftMargin > visible) {
        title.setAttribute('x', `${this.leftMargin + w / 2}`);
        needed = Math.max(needed, w + 2 * this.leftMargin);
      }
    }
    if (header.composer) {
      y += composerSize * 1.6;
      const composer = drawSVGText(this.headerG, header.composer, visible - this.leftMargin, y,
        `${composerSize}px`, 'normal', 'end', 'alphabetic', this.config.noteColor, 1, this.config.fontFamily);
      composer.setAttribute('data-header', 'composer');
      const w = composer.getBBox().width;
      if (w + 2 * this.leftMargin > visible) {
        composer.setAttribute('x', `${this.leftMargin + w}`);
        needed = Math.max(needed, w + 2 * this.leftMargin);
      }
    }
    this.headerHeight = y + pad;
    this.headerMinWidth = needed;
  }

  /** Fork: where the first line of music sits, below the title block and the signatures. */
  private musicTop(): number {
    // 增加yBaseline的值，使乐谱内容下移
    // Fork: 2.2 (was 1.65). The signature row sits above the music, and a tie
    // over a long first note rose into it -- ties peak ~1.6 noteHeights above
    // the digits' centre line, the signatures' lower edge reached ~0.4 below theirs.
    const verticalPadding = this.config.noteHeight * 2.2;
    return this.headerHeight + this.yBaseline + verticalPadding;
  }

  /** Fork: whether this pass wraps the score into lines (see config.lineWidth). */
  private wraps(): boolean {
    return this.config.lineWidth > 0 && this.config.pixelsPerTimeStep <= 0;
  }

  /** Fork: where drawing goes -- the measure being drawn while wrapping, else the one line. */
  private target(): SVGGElement {
    return this.measure ? this.measure.g : this.musicG;
  }

  /**
   * Fork: LilyPond's common shortest duration (`calc-common-shortest-duration`
   * in lily/spacing-spanner.cc): the shortest note starting in each measure,
   * taken over the measures, the most frequent one -- the shorter on a tie --
   * and never longer than `base-shortest-duration`, 3/16 of a whole note.
   * In quarter notes.
   */
  private commonShortest(): number {
    const counts = new Map<number, number>();
    let shortest = Infinity;
    const flush = () => {
      if (shortest !== Infinity) {
        const d = Math.round(shortest * 1e6) / 1e6;
        counts.set(d, (counts.get(d) ?? 0) + 1);
      }
      shortest = Infinity;
    };
    this.jianpuModel.jianpuBlockMap.forEach((block) => {
      if (block.isMeasureBeginning() && block.start > 1e-6) flush();
      if (block.length > 1e-9) shortest = Math.min(shortest, block.length);
    });
    flush();
    let best = Infinity;
    let bestCount = 0;
    counts.forEach((count, d) => {
      if (count > bestCount || (count === bestCount && d < best)) {
        best = d;
        bestCount = count;
      }
    });
    return Math.min(0.75, best);
  }

  /**
   * Fork: LilyPond's spacing for one note (or rest, or dash -- jianpu-ly
   * prints each as a note or rest of its own), in px. `ideal` is the room
   * from its start to the next one's: `get_duration_space` in
   * lily/spacing-options.cc, (shortest-duration-space 2.0 + log2(duration /
   * common shortest)) * spacing-increment 1.2 staff spaces, linear below the
   * shortest -- less the 1.2 of a canonical notehead and plus the head's own
   * width (lily/note-spacing.cc; see headWidth()). `k` is how readily that
   * room stretches when a line is justified: lily/spacing-basic.cc gives a
   * spring max(0.1, space - 1.2).
   */
  private spacing(block: JianpuBlock): { ideal: number; k: number } {
    const ratio = block.length / this.shortestQ;
    const space = (ratio < 1 ? 2.0 + ratio - 1 : 2.0 + Math.log2(ratio)) * 1.2;
    return {
      ideal: (space - 1.2 + this.headWidth(block)) * this.staffSpace,
      k: Math.max(0.1, space - 1.2) * this.staffSpace,
    };
  }

  /**
   * Fork: how wide LilyPond takes a block's head to be, in staff spaces.
   * jianpu-ly draws every head as text, but LilyPond still measures a rest by
   * its own glyph (`ly:rest::width`). A digit, or a dash after a note, is
   * 0.556 em of NimbusSans-Bold at 11 pt = 1.223. A rest, or a dash after
   * one, is Emmentaler's neomensural rest (jianpu-ly's `Rest.style`): 0.8 up
   * to a quarter, 0.4 from a half up -- and since there is no neomensural
   * 32nd or 64th rest, those fall back to the default glyphs (lily/rest.cc),
   * 1.52 and 1.668. Except that jianpu-ly writes an underlined rest no beam
   * reaches from the left as a note (its `use_rest_hack`), spaced as one.
   */
  private headWidth(block: JianpuBlock): number {
    if (block.notes.length > 0) return 1.223;
    const group = this.beamGroupByBlock.get(block);
    if ((block.durationLines ?? 0) >= 1 && (!group || group.blocks[0] === block)) return 1.223;
    const dots = block.augmentationDots ?? 0;
    const base = block.length / (dots === 1 ? 1.5 : dots === 2 ? 1.75 : 1);
    if (base >= 2 - 1e-6) return 0.4;
    if (base >= 0.25 - 1e-6) return 0.8;
    return base >= 0.125 - 1e-6 ? 1.52 : 1.668;
  }

  /**
   * Fork: how far a block's accidental reaches left of its digit, in px, as
   * LilyPond places it: Emmentaler's sharp or flat at jianpu-ly's
   * `Accidental.font-size -4` (0.693 / 0.572 staff spaces) and
   * AccidentalPlacement `right-padding` 0.15 between it and the head.
   */
  private overhang(block: JianpuBlock | undefined): number {
    if (!block) return 0;
    let ss = 0;
    for (const note of block.notes) {
      if (note.accidental === 1) ss = Math.max(ss, 0.693 + 0.15);
      else if (note.accidental === 2) ss = Math.max(ss, 0.572 + 0.15);
    }
    return ss * this.staffSpace;
  }

  /**
   * Fork: how much wider than its digit a lone note's underline is drawn. On
   * one line, upstream's 1.15-1.78. Laid out as LilyPond does, the digit's own
   * width: there the underline is a beamlet about a head long
   * (`beamlet-default-length` 1.1 staff spaces), and the wider one reached
   * into the next note and past the barline once the spacing tightened.
   */
  private loneUnderlineScale(lines: number): number {
    return this.measure ? 1 : (DURATION_LINE_SCALES.get(lines) ?? 1);
  }

  /** Fork: a barline centred on x, drawn into `container`. */
  private drawBarLine(container: SVGGElement, x: number): SVGPathElement {
    const bar = drawSVGPath(container, barPath, x, 0, 1, this.barScaleY()); // Scale bar path (height 100)
    setStroke(bar, this.config.noteColor, LINE_STROKE_WIDTH);
    return bar;
  }

  /** Fork: the vertical scale of a barline's path. */
  private barScaleY(): number {
    // Adjust bar height based on estimated content height or fixed value
    const barHeight = this.config.noteHeight * 2; // Example height
    return barHeight / PATH_SCALE;
  }

  /** Fork: while wrapping, records a barline drawn at measure x, so justifying its line can move it. */
  private recordBar(bar: SVGPathElement, x: number, closing: boolean): void {
    if (!this.measure) return;
    this.measure.bars.push({ el: bar, x });
    if (closing) this.measure.closingBarX = x;
  }

  /**
   * Fork: a tie arc in `g` reaching from `left` to `right` (g's coordinates)
   * and no further. The inline ties are placed by a start point the arc then
   * overhangs on both sides -- tiePath runs from x = -13 to 90 and is scaled
   * by 1.3 * width / 100, so 0.169 of the width before it and 1.17 after --
   * which on a stretched line carried a long tie from a line's first note out
   * past the left edge. LilyPond's tie runs from one note to the next.
   */
  private drawTieSpan(g: SVGGElement, left: number, right: number): void {
    const before = 13 * 1.3 / 100;
    const after = 90 * 1.3 / 100;
    const width = (right - left) / (before + after);
    if (width > 1) {
      drawSVGPath(g, tiePath, left + before * width, -this.config.noteHeight * 1.2,
                  width / PATH_SCALE * 1.3, (this.config.noteHeight / PATH_SCALE) * 1.6);
    }
  }

  /** Fork: a new, empty line of the wrapped score. */
  private newLine(): LineInfo {
    const g = createSVGGroupChild(this.musicG);
    g.setAttribute('data-line', `${this.lines.length}`);
    const line: LineInfo = { g, x: this.leftMargin, measures: [] };
    this.lines.push(line);
    return line;
  }

  /** Fork: starts the group that the measure beginning with `block` is drawn into. */
  private startMeasure(block: JianpuBlock): void {
    const line = this.lines.length ? this.lines[this.lines.length - 1] : this.newLine();
    const g = createSVGGroupChild(line.g);
    g.setAttribute('data-measure', `${Math.floor(block.measureNumber)}`);
    // line -1 until placed: justifying the line before must not take it (or what ends in it) for its own.
    this.measure = { g, line: -1, offset: 0, width: 0, blocks: [], shiftStart: 0, bars: [], beams: [] };
  }

  /**
   * Fork: puts the measure just drawn (`width` wide, its closing barline and
   * the space after it included) at the end of the current line, or -- if it
   * would run past config.lineWidth -- justifies that line and starts a new
   * one with it. A measure is never split.
   */
  private placeMeasure(width: number): void {
    const m = this.measure!;
    let line = this.lines[this.lines.length - 1];
    // It fits if its closing barline does; the space after that only matters mid-line.
    const end = m.closingBarX !== undefined ? m.closingBarX + LINE_STROKE_WIDTH / 2 : width;
    if (line.measures.length > 0 && line.x + end > this.config.lineWidth) {
      this.justifyLine(this.lines.length - 1);
      line = this.newLine();
      line.g.appendChild(m.g);
    }
    m.line = this.lines.length - 1;
    m.offset = line.x;
    m.width = width;
    m.g.setAttribute('transform', `translate(${m.offset}, 0)`);
    line.x += width;
    line.measures.push(m);
  }

  /**
   * Fork: justifies line `k` once all its measures are placed: stretches it so
   * that its last barline lands at the right edge (lineWidth, less the
   * barline's own width), the way LilyPond's springs do (lily/spring.cc,
   * lily/simple-spacer.cc): one force for the whole line, each spring then as
   * long as max(its minimum, ideal + force * k) -- a note's from spacing(),
   * and the room after each barline but the last its own k, half of
   * BarLine's `next-note` semi-fixed-space 0.9 (the other half is fixed;
   * lily/staff-spacing.cc). A note held at its minimum by the next note's
   * accidental only starts to grow once the force has caught up with it.
   * Glyphs keep their size; each block, and each barline, moves by what the
   * springs before where it starts have grown. Then draws what spans between
   * blocks with the new positions: beams, and the ties and hairpins that end
   * on this line.
   */
  private justifyLine(k: number): void {
    const line = this.lines[k];
    const last = line.measures[line.measures.length - 1];
    const natural = last.offset + (last.closingBarX ?? last.width);
    const target = this.config.lineWidth - LINE_STROKE_WIDTH;
    const barSpring = this.staffSpace * 0.45;
    const bars = line.measures.length - 1;
    const grown = (b: { ideal: number; min: number; k: number }, f: number) =>
      Math.max(b.min, b.ideal + f * b.k) - Math.max(b.min, b.ideal);
    const stretchBy = (f: number) => line.measures.reduce(
      (sum, m) => m.blocks.reduce((s2, b) => s2 + grown(b, f), sum), f * barSpring * bars);
    // The force that takes the line to the target, found by halving: what the
    // springs grow by rises with it, though not linearly once a spring that
    // was held at its minimum starts to grow. A line already too long -- one
    // measure wider than the line -- is left as it is.
    // As LilyPond does (lily/constrained-breaking.cc, space_line): a score that
    // fits on a single line is not stretched to the line's width -- it keeps its
    // natural spacing. (A line that is the whole score is the last one too.)
    const onlyLine = k === 0 && this.measure === null && this.lines.length === 1;
    let force = 0;
    const need = target - natural;
    if (need > 0 && !onlyLine && stretchBy(1e6) > need) {
      let lo = 0;
      let hi = 1;
      while (stretchBy(hi) < need) hi *= 2;
      for (let i = 0; i < 50; i++) {
        const mid = (lo + hi) / 2;
        if (stretchBy(mid) < need) lo = mid; else hi = mid;
      }
      force = (lo + hi) / 2;
    }
    let before = 0;
    line.measures.forEach((m, i) => {
      m.shiftStart = before;
      before += m.blocks.reduce((sum, b) => sum + grown(b, force), 0);
      if (i < bars) before += force * barSpring;
    });
    const shift = (m: MeasureFrame, x: number) =>
      m.blocks.reduce((sum, b) => (b.x < x - 1e-6 ? sum + grown(b, force) : sum), m.shiftStart);
    line.shift = shift;
    line.end = natural + stretchBy(force);
    for (const m of line.measures) {
      const at = (x: number) => shift(m, x);
      for (const b of m.blocks) b.g.setAttribute('transform', `translate(${at(b.x)}, 0)`);
      for (const bar of m.bars) {
        bar.el.setAttribute('transform', `translate(${bar.x + at(bar.x)}, 0) scale(1, ${this.barScaleY()})`);
      }
      for (const beam of m.beams) {
        this.drawBeamGroup(beam.group, beam.anchors.map((a) => ({ x: a.x + at(a.at), width: a.width })), m.g);
      }
    }
    this.settle(k);
  }

  /**
   * Fork: draws the ties and hairpins that end on line `k`, now that it is
   * justified (and so is every line before it). Where a line break falls in
   * between, each is drawn in pieces, as LilyPond draws it: a tie as one arc
   * running out to the end of the line and one coming in from the start of
   * the next; a hairpin as a piece on each line, opening steadily from one
   * piece to the next.
   */
  private settle(k: number): void {
    const lineStart = this.leftMargin * 0.25;
    // Where measure-relative x, moving with the block that starts at `at`, now is on its line.
    const onLine = (m: MeasureFrame, x: number, at: number) => m.offset + x + this.lines[m.line].shift!(m, at);
    this.pendingTies = this.pendingTies.filter((t) => {
      if (t.to.line !== k) return true;
      const a = t.from.frame!;
      // Each arc goes into its note's group, which has moved with its block: the
      // group's own x = 0 is now at line x `origin`.
      const fromOrigin = onLine(a, 0, t.from.at);
      const toOrigin = onLine(t.to, 0, t.toAt);
      if (a.line === k) {
        this.drawTieSpan(t.from.g, t.from.xNoteRight, toOrigin + t.toX - fromOrigin);
      } else {
        this.drawTieSpan(t.from.g, t.from.xNoteRight, this.lines[a.line].end! - 1 - fromOrigin);
        this.drawTieSpan(t.toG, lineStart - toOrigin, t.toX);
      }
      return false;
    });
    this.pendingHairpins = this.pendingHairpins.filter((h) => {
      if (h.to.line !== k) return true;
      // In line coordinates: a line's group is only ever moved vertically.
      const gap = this.config.noteHeight * HAIRPIN_GAP_FACTOR;
      const lineEnd = (j: number) => this.lines[j].end! - gap;
      const xFrom = onLine(h.from, h.xFrom, h.fromAt);
      const xTo = onLine(h.to, h.xTo, h.toAt);
      const pieces: Array<[number, number, number]> = [];   // line, from x, to x
      if (h.from.line === k) {
        pieces.push([k, xFrom, xTo]);
      } else {
        pieces.push([h.from.line, xFrom, lineEnd(h.from.line)]);
        for (let j = h.from.line + 1; j < k; j++) pieces.push([j, lineStart, lineEnd(j)]);
        pieces.push([k, lineStart, xTo]);
      }
      const total = pieces.reduce((sum, p) => sum + Math.max(0, p[2] - p[1]), 0);
      let done = 0;
      for (const [j, x0, x1] of pieces) {
        const t0 = total > 0 ? done / total : 0;
        done += Math.max(0, x1 - x0);
        const t1 = total > 0 ? done / total : 1;
        const openings: [number, number] = h.direction === '>' ? [1 - t0, 1 - t1] : [t0, t1];
        this.drawHairpin({ direction: h.direction, xFrom: x0 }, x1, this.lines[j].g,
                         pieces.length > 1 ? openings : undefined);
      }
      return false;
    });
  }

  /**
   * Fork: stacks the lines of the wrapped score. Each sits a fixed distance
   * below the one before, or further if what hangs below that line and what
   * rises above this one (lyrics, octave dots, ties) need the room.
   */
  private stackLines(): void {
    const pitch = this.config.noteHeight * 4;
    const gap = this.config.noteHeight * 0.6;
    // Measure every line before moving any: each move would force a new layout.
    const boxes = this.lines.map((line) => {
      try {
        const box = line.g.getBBox();
        return { top: box.y, bottom: box.y + box.height };
      } catch (e) {
        return { top: 0, bottom: 0 };   // not rendered
      }
    });
    let y = 0;
    this.lines.forEach((line, k) => {
      if (k > 0) y += Math.max(pitch, boxes[k - 1].bottom - boxes[k].top + gap);
      line.g.setAttribute('transform', `translate(0, ${y})`);
    });
  }

  /** Updates SVG and container dimensions */
   private updateLayout(contentWidth?: number) {
        this.width = contentWidth ?? this.width;
        if (this.config.width > 0) {
            this.width = this.config.width;
        }
   
        // 增加基线偏移量，为签名留出更多空间
        this.height = Math.max(this.height, this.config.noteHeight * 6 + this.headerHeight); // 从5增加到6
        if (this.config.height > 0) {
            this.height = this.config.height;
        }
   
        // Fork: the SVG is at least as wide as the title block. Not this.width
        // itself -- that is where the next incremental draw continues from.
        this.mainSVG.setAttribute('width', `${Math.max(this.width, this.headerMinWidth)}`);
        this.mainSVG.setAttribute('height', `${this.height}`);
        this.mainG.setAttribute('transform', `translate(0, ${this.musicTop()})`); // 增加垂直间距
   
        this.overlaySVG.setAttribute('width', '200');
        this.overlaySVG.setAttribute('height', `${this.height}`);
        this.overlayG.setAttribute('transform', `translate(0, ${this.headerHeight + this.yBaseline})`); // 签名保持原位置
   }

  /**
   * Redraws the score or highlights notes.
   * If `activeNote` is provided, highlights that note and deactivates others.
   * If `activeNote` is null/undefined, redraws any part of the score
   * not yet rendered (incremental drawing).
   * @param activeNote The note to highlight (optional).
   * @param scrollIntoView If true, scroll the view to the active note (optional).
   * @returns The x-position of the highlighted note, or -1.
   */
  /**
   * Removes the playback highlight from every currently-highlighted note,
   * leaving the score drawn exactly as it was before playback started.
   *
   * `redraw(note)` only ever clears notes *other* than the one it is about to
   * highlight, so stopping playback had no way to clear the last one: callers
   * were left either passing a deliberately non-existent note to exploit that
   * "deactivate everything else" pass, or re-rendering the whole score. This
   * is the explicit version of that intent.
   */
  public clearHighlight(): void {
    this.playingNotes.forEach((_note, id) => {
      const g = this.mainSVG.querySelector(`g[data-id="${id}"]`) as SVGGElement | null;
      if (g) {
        resetElementHighlight(g, this.config.noteColor);
      }
    });
    this.playingNotes.clear();
  }

  public redraw(
    activeNote?: NoteInfo,
    scrollIntoView?: boolean
  ): number {
    if (this.destroyed) return -1; // 已销毁：不绘制任何内容
    let activeNotePosition = -1;
    const isCompact = this.config.pixelsPerTimeStep <= 0;

    // --- Highlight Handling ---
    if (activeNote) {
        const noteId = noteElementId(activeNote.start, activeNote.pitch);

        // Deactivate previously playing notes that are not the current one
        this.playingNotes.forEach((_note, id) => { // Changed 'note' to '_note' as it's unused
            if (id !== noteId) {
                const g = this.getNoteGroup(id);
                if (g) {
                    resetElementHighlight(g, this.config.noteColor);
                }
                this.playingNotes.delete(id);
            }
        });

        // Activate the current note
        if (!this.playingNotes.has(noteId)) {
             const g = this.getNoteGroup(noteId);
             if (g) {
                highlightElement(g, this.config.activeNoteColor);
                this.playingNotes.set(noteId, activeNote);

                 // Calculate position for scrolling
                 const noteRect = g.getBoundingClientRect();
                 const svgRect = this.mainSVG.getBoundingClientRect();
                 // Position relative to the *scrollable parent's* coordinate system
                  activeNotePosition = noteRect.left - svgRect.left + this.parentElement.scrollLeft;


                 // Handle scrolling
                 const isMeasureStart = g.hasAttribute('data-is-measure-start');
                 if (scrollIntoView && (this.config.scrollType !== ScrollType.BAR || isMeasureStart)) {
                     this.scrollIntoViewIfNeeded(activeNotePosition);
                 }
             }
        }
         // Signature blinking (only in proportional mode)
         if (!isCompact && this.signaturesBlinking) {
            // Logic to stop blinking if playback moves past signature area
            // Determine signature area width (e.g., from overlayG bounds)
             const overlayRect = this.overlayG.getBoundingClientRect();
             const signatureWidthPixels = overlayRect.width;
             // Convert note start time to pixels
              const noteTimePixels = this.jianpuModel.measuresInfo.quartersToTime(activeNote.start, activeNote.start) * this.config.pixelsPerTimeStep;
             if (noteTimePixels > signatureWidthPixels) {
                  this.signaturesBlinking = false;
                  setBlinkAnimation(this.overlayG, false);
             }
         }

    }
    // --- Incremental Redrawing ---
    else {
        this.jianpuModel.update(this.jianpuInfo, this.config.defaultKey); // Ensure model is up-to-date

        // Recompute beam groups over the *whole* score every full redraw (see
        // beam_grouping.ts). This only covers the "draw everything in one
        // pass" usage this class's own incremental loop below already
        // assumes elsewhere (lastRenderedQ starts at -1 and a fresh instance
        // is what stage 3.2's SumisoraOMR integration actually creates per
        // render) -- a group whose blocks straddle two separate *partial*
        // redraw calls isn't reconciled here.
        const allBlocksInOrder = Array.from(this.jianpuModel.jianpuBlockMap.values());
        const beamGroups = computeBeamGroups(allBlocksInOrder, this.jianpuModel.measuresInfo);
        this.beamGroupByBlock = new Map();
        for (const group of beamGroups) {
            for (const block of group.blocks) this.beamGroupByBlock.set(block, group);
        }
        this.beamGroupAnchors = new Map();
        this.openHairpin = null;   // fork: no hairpin carries over into a pass

        let currentX = this.width; // Start drawing from the end of previous content
        let contentWidth = this.width;
        let maxHeight = this.height > 0 ? this.height - this.yBaseline : this.config.noteHeight * 3; // Max extent below baseline
        let minHeight = 0; // Max extent above baseline (negative y)

        const linkedNoteMap: LinkedNoteMap = new Map(); // For ties across blocks
        const wrap = this.wraps();
        if (wrap) {
            // Fork: LilyPond's unit. Its jianpu digits are 11 pt text on a 20 pt staff,
            // whose staff space is 5 pt; ours are numberFontSize px.
            this.staffSpace = this.numberFontSize * 5 / 11;
            this.shortestQ = this.commonShortest();
        }

        let blockIndex = 0;
        this.jianpuModel.jianpuBlockMap.forEach((block, startTimeQ) => {
            const nextBlock = allBlocksInOrder[++blockIndex];
            // Check if block start time is >= last rendered quarter note time
            // Use a small tolerance for floating point comparisons
            if (startTimeQ >= this.lastRenderedQ - 1e-9) { // Draw new or overlapping blocks
                 // Fork: wrapping. A measure starts a group of its own, x from 0; the one
                 // just finished gets its closing barline and goes onto a line.
                 if (wrap && (!this.measure || (block.isMeasureBeginning() && block.start > 1e-6))) {
                     if (this.measure) {
                         // LilyPond measures the last note's space up to the barline
                         // (lily/note-spacing.cc, space-to-barline); after it, BarLine's
                         // next-note semi-fixed-space 0.9 to the next note.
                         // The fixed half of that grows until a first note's accidental clears the
                         // barline by 0.3 staff spaces (lily/staff-spacing.cc, min_dist_correction).
                         const barX = contentWidth + LINE_STROKE_WIDTH / 2;
                         this.recordBar(this.drawBarLine(this.measure.g, barX), barX, true);
                         const clear = Math.max(0, this.overhang(block) - this.staffSpace * 0.15);
                         this.placeMeasure(contentWidth + LINE_STROKE_WIDTH + this.staffSpace * 0.9 + clear);
                     }
                     this.startMeasure(block);
                     contentWidth = 0;
                 }
                 if (wrap) {
                     // the next note's accidental, unless a barline comes first
                     this.nextOverhang = nextBlock && !(nextBlock.isMeasureBeginning() && nextBlock.start > 1e-6)
                         ? this.overhang(nextBlock) : 0;
                 }
                 if (isCompact) {
                     // In compact mode, currentX advances with each drawn element
                     currentX = contentWidth; // Position determined by previous element's width
                 } else {
                     // In proportional mode, x is determined by time
                     currentX = this.jianpuModel.measuresInfo.quartersToTime(startTimeQ, startTimeQ) * this.config.pixelsPerTimeStep;
                 }

                const blockWidth = this.drawJianpuBlock(block, currentX, linkedNoteMap);

                if (isCompact) {
                     contentWidth += blockWidth; // Accumulate width in compact mode
                } else {
                    // Proportional mode width is determined by the latest time
                     contentWidth = Math.max(contentWidth, currentX + blockWidth);
                }

                // Update last rendered Q *after* processing the block fully
                this.lastRenderedQ = startTimeQ + block.length; // Move marker to the end of the block
            }
        });

        if (this.measure) {   // fork: the last measure, and its line, while wrapping
            this.placeMeasure(contentWidth);
            this.measure = null;
            this.justifyLine(this.lines.length - 1);
        }

        // Fork: settle a hairpin left open by the last note before measuring,
        // since dropping its mark changes the bounds the height comes from.
        this.finishOpenHairpin();

        if (wrap) {
            this.stackLines();
            // As wide as the lines are meant to be; wider only for a measure that
            // could not fit on a line of its own. A line ends at its last barline --
            // the room after it belongs to the next measure, which is on the next line.
            contentWidth = this.lines.reduce(
                (w, line) => Math.max(w, (line.end ?? line.x) + LINE_STROKE_WIDTH), this.config.lineWidth);
        }

        // Track vertical bounds once for the whole music group, rather than
        // once per block inside the loop above. getBBox() forces a synchronous
        // layout, so the per-block version cost one forced layout per block
        // (hundreds for a real score) to compute a value that is by definition
        // the union of them all -- exactly what the container's own bbox is.
        // The container additionally encloses content drawn straight into
        // musicG rather than into a block group (bar lines, merged beam bars),
        // so the resulting bounds can only ever be equal or slightly taller,
        // never tighter: no risk of clipping content that used to fit.
        let musicBottom = this.config.noteHeight * 1.5;   // fork: lowest point drawn, for wrapping
        try {
            const musicBox = this.musicG.getBBox();
            if (musicBox.height > 0) {
                minHeight = Math.min(minHeight, musicBox.y);
                maxHeight = Math.max(maxHeight, musicBox.y + musicBox.height);
                musicBottom = musicBox.y + musicBox.height;
            }
        } catch (e) {
            // Ignore getBBox error if the group is not rendered (display:none)
            // or has no graphical content yet.
        }

        // Update overall layout based on new content bounds
        if (wrap) {
            // Fork: down to the bottom of the last line, from where the first one sits.
            this.height = Math.max(this.height, this.musicTop() + musicBottom + this.config.noteHeight * 0.5);
        } else {
            this.height = Math.max(this.height, (maxHeight - minHeight) + this.config.noteHeight); // Add buffer
        }
        this.updateLayout(contentWidth);
    }

    return activeNotePosition;
  }

  /**
   * Looks up a note group by id, from the element cache. On a cache miss
   * falls back to a single querySelector and backfills the cache (guards
   * against incremental-draw ordering); returns null if still not found.
   * @param noteId The note id in `${start}-${pitch}` form.
   */
  private getNoteGroup(noteId: string): SVGGElement | null {
      let g = this.noteGroupCache.get(noteId) ?? null;
      if (!g) {
          g = this.mainSVG.querySelector(`g[data-id="${noteId}"]`) as SVGGElement | null;
          if (g) {
              this.noteGroupCache.set(noteId, g);
          }
      }
      return g;
  }


  /**
   * Draws a single JianpuBlock (notes or rest) at the specified x-position.
   * @param block The JianpuBlock to draw.
   * @param x The horizontal starting position.
   * @param linkedNoteMap Map for handling ties.
   * @returns The calculated width of the drawn block.
   */
   private drawJianpuBlock(
       block: JianpuBlock,
       x: number,
       linkedNoteMap: LinkedNoteMap
   ): number {
    
       let blockWidth = 0;
       const isCompact = this.config.pixelsPerTimeStep <= 0;
       const isMeasureStart = block.isMeasureBeginning();
       const blockGroup = createSVGGroupChild(this.target(), `block-${block.start}`);
       blockGroup.setAttribute('data-block-start', `${block.start}`); // For later lookup
       if (this.measure) {   // fork: justifying the line moves the block by where it starts
           this.measure.blocks.push({ g: blockGroup, x, ideal: 0, min: 0, k: 0 });
           this.blockAt = x;
       }

       // --- 1. Draw Bar Line (if needed) ---
       // Bar lines are drawn *before* the block they precede.
       if (isMeasureStart && block.start > 1e-6) { // Don't draw bar at time 0
           // Fork: while wrapping, the redraw loop has drawn it already, closing the
           // measure before -- a line break leaves it at the end of that line.
           if (!this.measure) {
               this.drawBarLine(this.musicG, x - (isCompact ? this.estimatedNoteWidth * 0.6 : 4)); // Position slightly before block
           }
           if (isCompact && !this.measure) {
                blockWidth += LINE_STROKE_WIDTH; // Add bar width if compact
           }
       }

       // --- 1b. Draw Bar Number (optional) ---
       // Drawn centered above the bar line position. Unlike the bar line
       // itself, the number is also drawn for the first measure at time 0
       // (which has no bar line): there it is left-aligned to the block
       // start so it stays inside the SVG. Per engraving convention bar
       // numbers do not participate in the block width calculation.
       if (this.config.showBarNumbers && isMeasureStart) {
           const isTimeZero = block.start <= 1e-6;
           const barX = x - (isCompact ? this.estimatedNoteWidth * 0.6 : 4); // Same x as the bar line
           const barNumberY = -this.config.noteHeight * 2.2; // Above the octave dots (highest ~ -1.9 * noteHeight)
           drawSVGText(
               this.measure ? blockGroup : this.musicG,   // fork: moves with its block while wrapping
               String(Math.round(block.measureNumber)), // Integer part is the measure number
               isTimeZero ? x : barX,
               barNumberY,
               `${this.smallFontSize}px`,
               'normal',
               isTimeZero ? 'start' : 'middle',
               'middle',
               this.config.noteColor,
               1,
               this.config.fontFamily
           );
       }


       // --- 2. Draw Signatures (if changed, in-line only) ---
       // Overlay handles the *current* signature. This draws changes *within* the score flow.
       // Each signature kind is drawn independently: only the ones that changed
       // at this block start get drawn (e.g. a tempo change alone draws just "♩=qpm").
       const keyChanged = this.updateCurrentKey(block.start);
       const timeChanged = this.updateCurrentTimeSignature(block.start);
       const tempoChanged = this.updateCurrentTempo(block.start);
       let signatureWidth = 0;
       if ((keyChanged || timeChanged || tempoChanged) && block.start > 1e-6) {
            // Draw the new signature(s) in the signaturesG (scrollable part)
            const sigX = x + blockWidth; // Position it after potential bar line
            signatureWidth = this.drawSignatures(this.measure ? blockGroup : this.signaturesG,
                                                 sigX, keyChanged, timeChanged, tempoChanged);
            if (isCompact) {
                 blockWidth += signatureWidth + this.estimatedNoteWidth * 0.2; // Add width and spacing
            }
       }


       // --- 3. Draw Notes or Rest ---
       const contentX = x + blockWidth; // Adjust starting X based on preceding elements
       let contentWidth = 0;
       if (block.notes.length > 0) {
           contentWidth = this.drawNotes(block, contentX, linkedNoteMap, blockGroup);
       } else if (block.length > 1e-6) { // Only draw rest if it has duration
           // It's a rest block
           contentWidth = this.drawRest(block, contentX, blockGroup);
       }


       // --- 4. Calculate Total Width ---
        if (this.measure) {
            // Fork: wrapping -- LilyPond's spacing (see spacing()): the note's ideal room,
            // or what it holds (a lyric, a dynamic, an in-line signature) if that is wider.
            // The least it can have (lily/separation-item.cc): what it holds, padding 0.1,
            // and the next note's accidental.
            const { ideal, k } = this.spacing(block);
            const min = blockWidth + contentWidth + this.staffSpace * 0.1 + this.nextOverhang;
            blockWidth = Math.max(ideal, min);
            Object.assign(this.measure.blocks[this.measure.blocks.length - 1], { ideal, min, k });
        } else if (isCompact) {
            // Total width is accumulated width of bar, signature, and content
            blockWidth += contentWidth;
            
            // Adjust spacing based on block duration for compact mode
            let gap = this.estimatedNoteWidth * this.config.noteSpacingFactor;
            // block.length is in quarter notes.
            // e.g., 64th note: 0.0625; 32nd note: 0.125; 16th note: 0.25; 8th note: 0.5; quarter note: 1.0
            if ( block.beatEnd) {
                gap *= 1.0; // Longer spacing for beat start
            } else if (block.length < 0.0625) { // 对于 64 分音符或更短的音符
                gap *= 0.05; // 极小的间距
            } else if (block.length < 0.125) { // 对于 32 分音符
                gap *= 0.1; // 非常小的间距
            } else if (block.length < 0.25) { // 对于 16 分音符
                gap *= 0.2; // 小间距
            } else if (block.length < 0.5) { // 对于 8 分音符
                gap *= 0.4;  // 半间距
            } else if (block.length < 1.0) { // 对于 4 分音符
                gap *= 0.5;  // 中等间距
            }
            
            // For quarter notes (length 1.0) or longer, the full gap is used.
            blockWidth += gap;
           

        } else {
            // Proportional mode: width is determined by the maximum extent of elements at this time
             blockWidth = Math.max(signatureWidth, contentWidth);
        }

        // --- 更新结束小节线判断
        const isFinalBlock = this.jianpuModel.isLastMeasureAtQ(block.start + block.length);
        if (isFinalBlock) {
            const barX = x + blockWidth + (this.measure ? LINE_STROKE_WIDTH / 2 : 0);
            this.recordBar(this.drawBarLine(this.target(), barX), barX, true);
            if (isCompact) {
                blockWidth += LINE_STROKE_WIDTH;
            }
        }

       return blockWidth; // Return the width *occupied* by this block's drawing operations
   }

 /**
 * Draws the notes within a JianpuBlock.
 * @param block The block containing notes.
 * @param x The starting x position for drawing this block's content.
 * @param linkedNoteMap Map for handling ties.
 * @param blockGroup The parent SVG group for this block.
 * @returns The horizontal space occupied by the notes (excluding final padding).
 */
private drawNotes(
    block: JianpuBlock,
    x: number,
    linkedNoteMap: LinkedNoteMap,
    blockGroup: SVGGElement
): number {
    let currentX = x;
    let maxX = x; // Track the rightmost edge
    const noteSpacing = this.estimatedNoteWidth * 0.1; // Small spacing between elements
    const FONT_SIZE = `${this.numberFontSize}px`;
    const SMALL_FONT_SIZE = `${this.smallFontSize}px`;

    const { durationLines = 0, augmentationDots = 0, augmentationDash = false } = block;


    // Draw notes (potentially a chord)
    block.notes.forEach((note) => { // Removed index as it wasn't used
        const noteId = noteElementId(note.start, note.pitch);
        // Group for individual note allows highlighting and tie linking
        const noteG = createSVGGroupChild(blockGroup, noteId);
        this.noteGroupCache.set(noteId, noteG); // Cache for hot-path lookups
        this.noteById.set(noteId, note); // noteId → note data, for click delegation
        if (block.isMeasureBeginning()) {
             noteG.setAttribute('data-is-measure-start', 'true'); // Mark for scrolling
        }

        let noteStartX = currentX; // Reset start X for each element relative to block start 'x'
        let noteEndX = noteStartX; // Track right edge of elements for this note

        // --- Accidental ---
        if (note.accidental !== 0) {
            const accText = ACCIDENTAL_TEXT[note.accidental];
            // Position accidental slightly before the number
            drawSVGText(noteG, accText, noteStartX + noteSpacing, 0, SMALL_FONT_SIZE, 'normal', 'end', 'text-top', this.config.noteColor, 1, this.config.fontFamily);
            // We don't advance noteStartX here, accidental sits to the left
            // We do need its width to potentially adjust overall block spacing later if needed.
            //let accWidth = acc.getBBox().width;

        }

        let noteWidth = 0;
        // 如果 augmentationDash 为 true 则画 '-'，否则画音符数字
        if (augmentationDash) {
           // Let's assume AUGMENTATION_DASH_FACTOR determines the width relative to noteHeight
           // Make sure AUGMENTATION_DASH_FACTOR is defined and provides a sensible width multiplier (e.g., 0.5, 1.0)
           const dashWidth = this.config.noteHeight * AUGMENTATION_DASH_FACTOR; // Desired visual length

           // 2. Calculate the horizontal scale needed for the base path ('h 50')
           const pathOriginalWidth = 50; // Width defined in augmentationDashPath
           const dashScaleX = dashWidth / pathOriginalWidth;

           // 3. Draw the path element. Set vertical scale to 1 (it's irrelevant for stroke thickness).
           const dash = drawSVGPath(noteG, augmentationDashPath, noteStartX, 0, dashScaleX, 1);

           // 4. Apply stroke for visibility and thickness
           //    Use the calculated dashThickness for stroke-width
           setStroke(dash, this.config.noteColor, LINE_STROKE_WIDTH);

           // 5. Use the calculated dashWidth for layout purposes
           noteWidth = dashWidth; // Use the intended width, not getBBox which might not account for stroke

           noteEndX = noteStartX + noteWidth; // Update right edge

        } else {

            const numText = `${note.jianpuNumber}`;
            const num = drawSVGText(noteG, numText, noteStartX, 0, FONT_SIZE, 'normal', 'start', 'middle', this.config.noteColor, 1, this.config.fontFamily);
            noteWidth = measureSVGTextWidth(num, numText, FONT_SIZE);
            noteEndX = noteStartX + noteWidth; // Number defines the main body width for now
          
        }


        // --- Octave Dots ---

        if (note.octaveDot !== 0 && augmentationDash === false) {
            const dotSize = this.config.noteHeight * DOT_SIZE_FACTOR;
            const dotScale = dotSize / (PATH_SCALE * 0.15);
            const dotX = noteStartX + noteWidth / 2;
            // 修改点间距计算，增加垂直间距
            const dotSpacing = dotSize * 2.8; // 增加点之间的间距
            const baseOffset = this.config.noteHeight * OCTAVE_DOT_OFFSET_FACTOR;
            
            for (let i = 0; i < Math.abs(note.octaveDot); i++) {
                // 使用绝对坐标而非相对坐标
                const y = (note.octaveDot > 0 ? -baseOffset : baseOffset*0.6) - (i * dotSpacing * (note.octaveDot > 0 ? 1 : -1) ); // Adjusted y calculation
                drawSVGPath(noteG, dotPath, dotX, y, dotScale, dotScale);
            }
        }


        // --- Duration Underlines (or, if this block is beamed with its
        // neighbours, defer to a single merged bar drawn once the whole
        // group has been recorded -- see beam_grouping.ts / drawBeamGroup) ---
        const beamGroup = this.beamGroupByBlock.get(block);
        if (beamGroup) {
            this.recordBeamAnchorAndMaybeDraw(beamGroup, block, noteStartX, noteWidth);
        } else if (durationLines > 0) {
            const lineYOffset = this.config.noteHeight * UNDERLINE_SPACING_FACTOR * 2.5;
            const lineSpacing = this.config.noteHeight * UNDERLINE_SPACING_FACTOR;
            const lineWidthScale = noteWidth / PATH_SCALE * this.loneUnderlineScale(durationLines);

            for (let lineIndex = 0; lineIndex < durationLines; lineIndex++) {
                const yPosition = lineYOffset + lineIndex * lineSpacing;
                const durationLine = drawSVGPath(noteG, underlinePath, noteStartX, yPosition, lineWidthScale, 1);
                setStroke(durationLine, this.config.noteColor, LINE_STROKE_WIDTH);
            }
        }


        // --- Augmentation Dots ---
         let augmentationX = noteEndX + noteSpacing; // Position after the number

         if (augmentationDots > 0) { // Dots only if no dash
            const dotSize = this.config.noteHeight * DOT_SIZE_FACTOR;
            const dotScale = dotSize / (PATH_SCALE * 0.15);
             for (let i = 0; i < augmentationDots; i++) {
                 // Draw relative to noteG origin
                 drawSVGPath(noteG, dotPath, augmentationX, 0, dotScale, dotScale);
                 augmentationX += dotSize + noteSpacing;
             }
             noteEndX = augmentationX + noteSpacing;
         }


        // --- Dynamic mark (fork addition) ---
        // Under the note, below the octave dots and the duration underlines,
        // in the bold italic dynamics are conventionally set in -- the same
        // place and the same look LilyPond gives them, so the editor and the
        // PDF it exports show the mark in the same relation to the note.
        // Drawn inside noteG so that selecting or highlighting the note takes
        // its mark with it, and so that a deleted note cannot leave one behind.
        let markEl: SVGTextElement | null = null;
        if (note.dynamic) {
            const dynamicFontSize = `${this.config.noteHeight * DYNAMIC_FONT_SIZE_MULTIPLIER}px`;
            const markX = noteStartX + noteWidth / 2;
            const mark = drawSVGText(
                noteG, note.dynamic, markX, this.config.noteHeight * DYNAMIC_Y_FACTOR,
                dynamicFontSize, 'bold', 'middle', 'hanging', this.config.noteColor);
            mark.setAttributeNS(null, 'font-style', 'italic');
            mark.setAttributeNS(null, 'data-dynamic', note.dynamic);
            // Widen the note's footprint by half the overhang on the right:
            // 'sfz' under a single digit is wider than the digit, and without
            // this the next note would be drawn over it in compact mode.
            const markWidth = measureSVGTextWidth(mark, note.dynamic, dynamicFontSize);
            noteEndX = Math.max(noteEndX, markX + markWidth / 2);
            markEl = mark;
        }

        // --- Hairpins (fork addition) ---
        // The wedge spans from the note it starts on to the note that closes
        // it, so it can only be drawn once that second note has a position --
        // the same bookkeeping ties do. It goes into musicG, not into either
        // note's group, because it belongs to neither of them alone.
        //
        // A `\!` closes one, and so does any dynamic, but only one begun on an
        // *earlier* note: written on the starting note itself, LilyPond draws
        // no wedge at all. Closing first and opening second is what gives a
        // note that both ends one hairpin and starts another the right shape.
        if (this.openHairpin && (note.hairpinEnd || note.dynamic)) {
            const xTo = noteStartX - this.config.noteHeight * HAIRPIN_GAP_FACTOR;
            const open = this.openHairpin;
            if (this.measure && open.frame) {   // fork: wrapping -- drawn once its line is justified
                this.pendingHairpins.push({ direction: open.direction, xFrom: open.xFrom, fromAt: open.at,
                                            from: open.frame, xTo, toAt: this.blockAt, to: this.measure });
            } else {
                this.drawHairpin(open, xTo);
            }
            this.openHairpin = null;
        }
        if (note.hairpinStart) {
            this.openHairpin = {
                direction: note.hairpinStart,
                xFrom: noteEndX + this.config.noteHeight * HAIRPIN_GAP_FACTOR,
                markEl,
                frame: this.measure,
                at: this.blockAt,
            };
        }

        // --- Lyric ---
        // Drawn under the note number (in the gap below the duration
        // underlines). Continuation segments of augmentation dashes and other
        // tied continuations (note.tiedFrom set) carry no lyric: the syllable
        // stays on the first segment of the tie chain. Rest blocks never
        // reach this loop (drawRest has no lyric handling).
        if (note.lyric && !note.tiedFrom) {
            const lyricY = this.config.noteHeight * LYRIC_OFFSET_FACTOR;
            const lyricCenterX = noteStartX + noteWidth / 2;
            const lyricText = drawSVGText(noteG, note.lyric, lyricCenterX, lyricY, SMALL_FONT_SIZE, 'normal', 'middle', 'middle', this.config.noteColor, 1, this.config.fontFamily);
            // A lyric can be wider than its note: widen the note's right edge
            // so the following note is spaced after the lyric instead of
            // overlapping it.
            const lyricWidth = lyricText.getBBox().width;
            const lyricRightX = lyricCenterX + lyricWidth / 2;
            if (lyricRightX > noteEndX) {
                noteEndX = lyricRightX;
            }
        }


        // --- Ties ---

        const noteLogicalEndPositionX = noteEndX;
        if (note.tiedTo && !augmentationDash) {
            // 存储当前note信息，等待后续绘制
            linkedNoteMap.set(note, { g: noteG, xNoteRight: noteLogicalEndPositionX, yNoteBaseline: 0,
                                      frame: this.measure, at: this.blockAt });
        } else if (note.tiedFrom) {
            // 递归查找链接的第一个note
            let firstNote = note.tiedFrom;
            while (firstNote.tiedFrom) {
                firstNote = firstNote.tiedFrom;
            }
            
            const prevLink = linkedNoteMap.get(firstNote);
            if (prevLink) {
                const tieStartX = prevLink.xNoteRight * 1.0;
                //const tieEndX = noteStartX - noteSpacing;
                const tieEndX = augmentationDash ? 
                (noteStartX - this.estimatedNoteWidth * 2.2) :
                (noteStartX - noteSpacing);


                const tieWidth = tieEndX - tieStartX;


                const tieY = - this.config.noteHeight * 1.2;
                const tieScaleX = tieWidth / PATH_SCALE * 1.3;
                const tieScaleY = (this.config.noteHeight / PATH_SCALE) * 1.6;

                if (this.measure) {
                    // Fork: wrapping -- drawn once the line it ends on is justified.
                    this.pendingTies.push({ from: prevLink, toG: noteG, toX: tieEndX, toAt: this.blockAt,
                                            to: this.measure });
                } else if (tieWidth > 1) {
                    // 从第一个note到当前note绘制tie
                    drawSVGPath(prevLink.g, tiePath,
                                tieStartX - (prevLink.g.getCTM()?.e ?? 0),
                                tieY, tieScaleX, tieScaleY);
                }
                // 清除整个链接链的缓存
                let current = firstNote;
                while (current && current !== note) {
                    linkedNoteMap.delete(current);
                    const nextNote = current.tiedTo;
                    if (nextNote) {
                        current = nextNote;
                    }
                }
            } else {
                console.warn("Missing linked SVG details for first tied note:", firstNote);
            }
        }

        // --- Fork: a tie between two written digits (a note held across a
        // barline, printed again after it as jianpu-ly does). Each tie joins
        // one digit to the next, so a note held over two barlines gets two.
        if (note.writtenTieFrom) {
            const prevLink = linkedNoteMap.get(note.writtenTieFrom);
            if (prevLink) {
                const tieStartX = prevLink.xNoteRight;
                const tieWidth = (noteStartX - noteSpacing) - tieStartX;
                if (this.measure) {
                    // Fork: wrapping -- drawn once the line it ends on is justified.
                    this.pendingTies.push({ from: prevLink, toG: noteG, toX: noteStartX - noteSpacing,
                                            toAt: this.blockAt, to: this.measure });
                } else if (tieWidth > 1) {
                    drawSVGPath(prevLink.g, tiePath,
                                tieStartX - (prevLink.g.getCTM()?.e ?? 0),
                                -this.config.noteHeight * 1.2,
                                tieWidth / PATH_SCALE * 1.3,
                                (this.config.noteHeight / PATH_SCALE) * 1.6);
                }
                linkedNoteMap.delete(note.writtenTieFrom);
            }
        }
        if (note.writtenTieTo) {
            linkedNoteMap.set(note, { g: noteG, xNoteRight: noteEndX, yNoteBaseline: 0,
                                      frame: this.measure, at: this.blockAt });
        }

         maxX = Math.max(maxX, noteEndX); // Update the overall rightmost edge relative to block start 'x'

    }); // End forEach note

    return maxX - x; // Return the width of the content drawn
}

/**
 * Draws one hairpin wedge, on the same row as the dynamic marks so that a
 * `p` and the crescendo leaving it sit on one line, as they do in engraved
 * music (fork addition).
 * @param open The hairpin being closed: its direction and its left edge.
 * @param xTo Right edge of the wedge, just before the note that closes it.
 * @param container Where to draw it (fork; x is in its coordinates).
 * @param openings Fork: for one piece of a hairpin a line break cuts in two,
 *     how far open it is at its left and right ends, 0 (the point) to 1.
 */
private drawHairpin(
    open: { direction: string; xFrom: number },
    xTo: number,
    container: SVGGElement = this.target(),
    openings?: [number, number]
): void {
    const width = xTo - open.xFrom;
    if (width <= 1) {
        return;   // the two notes are touching: there is no room for a wedge
    }
    const height = this.config.noteHeight * HAIRPIN_HEIGHT_FACTOR;
    const yMid = this.config.noteHeight
        * (DYNAMIC_Y_FACTOR + DYNAMIC_FONT_SIZE_MULTIPLIER / 2);
    let path = open.direction === '>' ? decrescendoPath : crescendoPath;
    if (openings) {
        const [a, b] = openings;
        path = `M 100,${-50 * b} L 0,${-50 * a} M 0,${50 * a} L 100,${50 * b}`;
    }
    const wedge = drawSVGPath(container, path, open.xFrom, yMid,
        width / PATH_SCALE, height / PATH_SCALE);
    setStroke(wedge, this.config.noteColor, LINE_STROKE_WIDTH);
    wedge.setAttributeNS(null, 'fill', 'none');   // two lines, not a triangle
    wedge.setAttributeNS(null, 'data-hairpin', open.direction);
}

/**
 * Ends a drawing pass. A hairpin that nothing closed is not drawn at all,
 * and it takes the dynamic on its starting note down with it -- that is what
 * LilyPond does with an unterminated one, verified by rendering, and showing
 * it here is the only way the editor agrees with the PDF it exports. The
 * linter warns about this case in words; this is its picture.
 */
private finishOpenHairpin(): void {
    if (!this.openHairpin) {
        return;
    }
    if (this.openHairpin.markEl) {
        this.openHairpin.markEl.remove();
    }
    this.openHairpin = null;
}

/**
 * Records a beamed block's note anchor (x position + width) for its
 * BeamGroup, and once every block in the group has been recorded (i.e.
 * this was the last one drawn), draws the group's merged beam bar(s) and
 * discards the group's bookkeeping.
 */
private recordBeamAnchorAndMaybeDraw(
    group: BeamGroup, block: JianpuBlock, noteStartX: number, noteWidth: number
): void {
    const anchors = this.beamGroupAnchors.get(group) ?? [];
    anchors.push({ x: noteStartX, width: noteWidth, at: this.blockAt });
    this.beamGroupAnchors.set(group, anchors);
    if (anchors.length === group.blocks.length) {
        if (this.measure) {
            // Fork: wrapping -- drawn once the line is justified (a beam never crosses a barline).
            this.measure.beams.push({ group, anchors });
        } else {
            this.drawBeamGroup(group, anchors);
        }
        this.beamGroupAnchors.delete(group);
    }
}

/**
 * Draws a beamed group's merged underline bar(s), replacing what would
 * otherwise be each block's own independent underline (see the "Duration
 * Underlines" branch in drawNotes()). Mirrors the standard multi-level
 * ("secondary"/partial) beam convention: level 1 spans the whole group
 * (always true here -- every block in a BeamGroup has durationLines >= 1
 * by construction, see computeBeamGroups()), and each higher level spans
 * only the maximal runs of *adjacent* blocks that both need that many
 * beams, with a short "hook" stub for an isolated block that needs more
 * beams than its neighbour(s) at that level.
 *
 * Hook direction is a deliberate simplification (points toward whichever
 * neighbour exists in the group, preferring forward): the stage 3.4
 * acceptance test is a uniform run of same-duration notes, which never
 * produces a hook, so treat this specific branch as unverified until it's
 * checked against a real mixed-duration file.
 */
private drawBeamGroup(
    group: BeamGroup, anchors: Array<{ x: number; width: number }>, container: SVGGElement = this.target()
): void {
    const lineYOffset = this.config.noteHeight * UNDERLINE_SPACING_FACTOR * 2.5;
    const lineSpacing = this.config.noteHeight * UNDERLINE_SPACING_FACTOR;
    const hookLength = this.estimatedNoteWidth * 0.6;

    const drawSegment = (level: number, xStart: number, xEnd: number) => {
        const yPosition = lineYOffset + (level - 1) * lineSpacing;
        const widthScale = (xEnd - xStart) / PATH_SCALE;
        const line = drawSVGPath(container, underlinePath, xStart, yPosition, widthScale, 1);
        setStroke(line, this.config.noteColor, LINE_STROKE_WIDTH);
    };

    const nBeams = group.blocks.map((b) => b.durationLines ?? 0);
    const maxLevel = Math.max(...nBeams);
    const connectLevels = beamLevelsBetweenConsecutiveBlocks(group); // length === blocks.length; last entry is always 0

    for (let level = 1; level <= maxLevel; level++) {
        let i = 0;
        while (i < nBeams.length) {
            if (nBeams[i] < level) { i++; continue; }
            let j = i;
            while (j < nBeams.length - 1 && connectLevels[j] >= level) j++;
            if (j > i) {
                drawSegment(level, anchors[i].x, anchors[j].x + anchors[j].width);
                i = j + 1;
            } else {
                const hasNext = i < anchors.length - 1;
                if (hasNext) drawSegment(level, anchors[i].x, anchors[i].x + hookLength);
                else drawSegment(level, anchors[i].x + anchors[i].width - hookLength, anchors[i].x + anchors[i].width);
                i++;
            }
        }
    }
}


/**
 * Draws a rest symbol for a JianpuBlock.
 * @param block The rest block.
 * @param x The starting x position.
 * @param blockGroup The parent SVG group.
 * @returns The horizontal space occupied by the rest (excluding final padding).
 */
private drawRest(block: JianpuBlock, x: number, blockGroup: SVGGElement): number {
    const FONT_SIZE = `${this.numberFontSize}px`;
    const noteSpacing = this.estimatedNoteWidth * 0.1;

    const { durationLines = 0, augmentationDots = 0} = block;
    let currentX = x; // Position relative to block start
    let noteEndX = currentX; // Track right edge

    // --- Rest Symbol ('0') ---
    // Fork: a block that is the `-` lengthening a rest (`0 - -` in a written
    // score) is drawn as that dash, the same dash a sustained note gets.
    let restWidth: number;
    if (block.augmentationDash) {
        restWidth = this.config.noteHeight * AUGMENTATION_DASH_FACTOR;
        const dash = drawSVGPath(blockGroup, augmentationDashPath, currentX, 0, restWidth / 50, 1);
        setStroke(dash, this.config.noteColor, LINE_STROKE_WIDTH);
    } else {
        const restSymbol = '0';
        const restText = drawSVGText(blockGroup, restSymbol, currentX, 0, FONT_SIZE, 'normal', 'start', 'middle', this.config.noteColor, 1, this.config.fontFamily);
        restWidth = measureSVGTextWidth(restText, restSymbol, FONT_SIZE);
    }
    noteEndX = currentX + restWidth;

     // --- Duration Underlines ---
    // Fork: a rest beamed with its neighbours (see computeBeamGroups) shares
    // the group's merged underline instead of drawing its own.
    const beamGroup = this.beamGroupByBlock.get(block);
    if (beamGroup) {
        this.recordBeamAnchorAndMaybeDraw(beamGroup, block, currentX, restWidth);
    } else if (durationLines > 0) {
        const lineYOffset = this.config.noteHeight * UNDERLINE_SPACING_FACTOR * 2.5;
        const lineSpacing = this.config.noteHeight * UNDERLINE_SPACING_FACTOR;
        const lineWidthScale = restWidth / PATH_SCALE * this.loneUnderlineScale(durationLines);
        
        for (let lineIndex = 0; lineIndex < durationLines; lineIndex++) {
            const yPosition = lineYOffset + lineIndex * lineSpacing;
            const durationLine = drawSVGPath(blockGroup, underlinePath, currentX, yPosition, lineWidthScale, 1);
            setStroke(durationLine, this.config.noteColor, LINE_STROKE_WIDTH);
        }
    }

    // --- Augmentation Dots ---
    let augmentationX = noteEndX + noteSpacing; // Position after the number

    if (augmentationDots > 0) { // Dots only if no dash
        const dotSize = this.config.noteHeight * DOT_SIZE_FACTOR;
        const dotScale = dotSize / (PATH_SCALE * 0.15);
        for (let i = 0; i < augmentationDots; i++) {
            // Draw relative to noteG origin
            drawSVGPath(blockGroup, dotPath, augmentationX, 0, dotScale, dotScale);
            augmentationX += dotSize + noteSpacing;
        }
        noteEndX = augmentationX + noteSpacing;
    }

    return noteEndX - x; // Return the width of the content drawn
}


  /**
   * Draws Key and/or Time signatures.
   * @param container The SVG group to draw into (overlayG or signaturesG). **Must be SVGGElement.**
   * @param x The starting x position.
   * @param drawKey Draw the key signature (1=X).
   * @param drawTime Draw the time signature (X/Y).
   * @param drawTempo Draw the tempo marking (♩=qpm) after the time signature.
   * @returns The width of the drawn signatures.
   */
   private drawSignatures(
       container: SVGGElement,
       x: number,
       drawKey: boolean,
       drawTime: boolean,
       drawTempo = false
   ): number {
       let currentX = x;
       const spacing = this.estimatedNoteWidth * 0.3; // Spacing between elements
       const timeFontSize = `${this.smallFontSize}px`;
       const keyFontSize = `${this.numberFontSize}px`; // Key sig slightly larger

       // --- Key Signature (e.g., 1=C) ---
       if (drawKey) {
           // Prefer the caller's caption: rebuilding it from the pitch class
           // loses both the mode (minor reads as its relative major) and the
           // spelling (Bb reads as A#). See KeySignatureInfo.label.
           const keyText = this.currentKeyLabel
               ?? `1=${PITCH_CLASS_NAMES[this.currentKey % 12] ?? 'C'}`;
           const keySig = drawSVGText(container, keyText, currentX, 0, keyFontSize, 'normal', 'start', 'middle', this.config.noteColor, 1, this.config.fontFamily);
           // Fork: mark it so a host can hit-test the caption and edit in place.
           // Same idea as the stable `data-id` on note groups -- without a
           // handle these are anonymous <text> nodes and nothing can find them.
           keySig.setAttribute('data-signature', 'key');
           currentX += keySig.getBBox().width + spacing * 2; // More space after key sig
       }

       // --- Time Signature (e.g., 4/4) ---
       if (drawTime) {
            const timeStr = `${this.currentTimeSignature.numerator}/${this.currentTimeSignature.denominator}`;
            const timeSig = drawSVGText(
                container,
                timeStr,
                currentX,
                0,  // 保持与基线对齐
                timeFontSize,
                'normal',
                'start',
                'middle',  // 垂直居中
                this.config.noteColor,
                1,
                this.config.fontFamily
            );
            timeSig.setAttribute('data-signature', 'time');   // Fork: see above
            currentX += timeSig.getBBox().width + spacing;
       }

       // --- Tempo Marking (e.g., ♩=96) ---
       // The quarter-note glyph (U+2669) is written as plain text and relies on
       // the browser's font fallback for display.
       if (drawTempo) {
            const tempoStr = `♩=${this.currentTempoQpm}`;
            const tempoSig = drawSVGText(
                container,
                tempoStr,
                currentX,
                0,  // 保持与基线对齐
                timeFontSize,
                'normal',
                'start',
                'middle',  // 垂直居中
                this.config.noteColor,
                1,
                this.config.fontFamily
            );
            currentX += tempoSig.getBBox().width + spacing;
       }

       const totalWidth = currentX - x;

       // Update vertical bounds based on signature height
       // Use try-catch as getBBox can fail if element is not rendered
       try {
           const bounds = container.getBBox();
           const minY = bounds.y; // Relative to baseline
           const maxY = bounds.y + bounds.height;
           // Calculate required total height based on baseline and bounds
           const requiredHeight = Math.max(this.yBaseline + maxY, this.yBaseline - minY) + this.config.noteHeight * 0.5; // Add buffer
           this.height = Math.max(this.height, requiredHeight);
       } catch(e) {
           // Ignore error
       }


       // --- Blinking Logic (Overlay Only) ---
        if (container === this.overlayG && this.config.pixelsPerTimeStep > 0) {
             this.signaturesBlinking = true;
             setBlinkAnimation(this.overlayG, true);
        }


       return totalWidth;
   }

  /** Updates the current key if changed at the given time */
  private updateCurrentKey(timeQ: number): boolean {
      const newKey = this.jianpuModel.measuresInfo.keySignatureAtQ(timeQ, true); // Check for exact change
      if (newKey !== -1 && newKey !== this.currentKey) {
          this.currentKey = newKey;
          this.currentKeyLabel = this.jianpuModel.measuresInfo.keySignatureLabelAtQ(timeQ);
          return true;
      }
      return false;
  }

  /** Updates the current time signature if changed at the given time */
  private updateCurrentTimeSignature(timeQ: number): boolean {
      const newTimeSig = this.jianpuModel.measuresInfo.timeSignatureAtQ(timeQ, true); // Check for exact change
      if (newTimeSig && (newTimeSig.numerator !== this.currentTimeSignature.numerator ||
                         newTimeSig.denominator !== this.currentTimeSignature.denominator))
      {
          this.currentTimeSignature = newTimeSig;
          return true;
      }
      return false;
  }

  /** Updates the current tempo if changed at the given time */
  private updateCurrentTempo(timeQ: number): boolean {
      const newTempo = this.jianpuModel.measuresInfo.tempoAtQ(timeQ, true); // Check for exact change
      if (newTempo !== -1 && newTempo !== this.currentTempoQpm) {
          this.currentTempoQpm = newTempo;
          return true;
      }
      return false;
  }

  /**
   * Click handler using event delegation: instead of one listener per note
   * group, a single 'click' listener on mainSVG walks from the clicked
   * element up the parent chain and reports the first element whose data-id
   * is a known note id (a key of noteById, filled by drawNotes).
   *
   * Other elements also carry a data-id — block groups ("block-<start>"),
   * 'main-content', 'music', 'signatures', 'overlay' — but none of those ids
   * is ever a note id, so the same lookup filters them out. The walk stops
   * at mainSVG itself (the listener element, never a note). Clicks that hit
   * no note (bar lines, signatures, empty space) are silently ignored.
   */
  private handleNoteClick = (event: MouseEvent): void => {
    if (this.destroyed) return; // 已销毁：监听器本应已随 DOM 移除，防御外部复用 mainSVG 的极端情况
    if (!this.config.onNoteClick) return; // No callback configured: ignore clicks entirely
    let el = event.target as Element | null;
    while (el && el !== this.mainSVG) {
      const noteId = el.getAttribute('data-id');
      const note = noteId === null ? undefined : this.noteById.get(noteId);
      if (note) {
        this.config.onNoteClick(note, el as SVGGElement); // Note groups are always <g data-id>
        return;
      }
      el = el.parentElement;
    }
  };

  /** Handles scroll events to update the fixed signature overlay */
  private handleScrollEvent = (_event: Event) => {
    this.lastKnownScrollLeft = this.parentElement.scrollLeft;
    if (!this.isScrolling) {
      window.requestAnimationFrame(() => {
        this.updateOverlaySignaturesForScroll(this.lastKnownScrollLeft);
        this.isScrolling = false;
      });
    }
    this.isScrolling = true;
  };

  /** Scrolls the container to bring the active note into view */
  private scrollIntoViewIfNeeded(activeNotePosition: number) {
      const containerWidth = this.parentElement.getBoundingClientRect().width;
      const currentScroll = this.parentElement.scrollLeft;
      let targetScroll = currentScroll;

      if (this.config.scrollType === ScrollType.PAGE) {
          const scrollMargin = 20; // Margin from edge
          if (activeNotePosition < currentScroll + scrollMargin) {
              // Note is off the left edge
              targetScroll = activeNotePosition - scrollMargin;
          } else if (activeNotePosition > currentScroll + containerWidth - scrollMargin) {
              // Note is off the right edge
              targetScroll = activeNotePosition - containerWidth + scrollMargin;
          }
      } else { // NOTE or BAR scrolling (center the note/bar start)
          const centerOffset = containerWidth * 0.5;
          targetScroll = activeNotePosition - centerOffset;
      }

      // Clamp scroll position to valid range
      targetScroll = Math.max(0, Math.min(targetScroll, this.parentElement.scrollWidth - containerWidth));

      if (Math.abs(targetScroll - currentScroll) > 1) { // Only scroll if needed
          this.parentElement.scrollTo({
              left: targetScroll,
              behavior: 'smooth' // Use smooth scrolling
          });
           // Manually update overlay after scroll starts, as scroll event might lag
           this.updateOverlaySignaturesForScroll(targetScroll);
      }
  }

  /** Helper to update overlay based on a target scroll position */
   private updateOverlaySignaturesForScroll(scrollLeft: number) {
        const scrolledTimeQ = this.pixelsToTime(scrollLeft);
        const keyAtScroll = this.jianpuModel.measuresInfo.keySignatureAtQ(scrolledTimeQ);
        const timeSigAtScroll = this.jianpuModel.measuresInfo.timeSignatureAtQ(scrolledTimeQ) ?? this.currentTimeSignature;
        const tempoAtScroll = this.jianpuModel.measuresInfo.tempoAtQ(scrolledTimeQ);

        let needsRedraw = false;
        if (keyAtScroll !== this.currentKey) {
            this.currentKey = keyAtScroll;
            this.currentKeyLabel = this.jianpuModel.measuresInfo.keySignatureLabelAtQ(scrolledTimeQ);
            needsRedraw = true;
        }
         if (timeSigAtScroll.numerator !== this.currentTimeSignature.numerator ||
             timeSigAtScroll.denominator !== this.currentTimeSignature.denominator) {
             this.currentTimeSignature = timeSigAtScroll;
             needsRedraw = true;
         }
         if (tempoAtScroll !== this.currentTempoQpm) {
             this.currentTempoQpm = tempoAtScroll;
             needsRedraw = true;
         }

        if (needsRedraw) {
            while (this.overlayG.lastChild) this.overlayG.removeChild(this.overlayG.lastChild);
            this.drawSignatures(this.overlayG, 0, true, true, this.drawsTempo());
            // Blinking logic on scroll update
             if (scrollLeft < 10 && this.config.pixelsPerTimeStep > 0) {
                  setBlinkAnimation(this.overlayG, true); this.signaturesBlinking = true;
              } else if (this.config.pixelsPerTimeStep > 0) {
                  setBlinkAnimation(this.overlayG, false); this.signaturesBlinking = false;
              }
        }
   }


  /** Converts a pixel position to a time in quarter notes (proportional mode only) */
  private pixelsToTime(pixels: number): number {
      if (this.config.pixelsPerTimeStep <= 0) return 0; // Not applicable in compact mode
      // Use start time 0 for tempo context for general scroll position
      return this.jianpuModel.measuresInfo.timeToQuarters(pixels / this.config.pixelsPerTimeStep, 0);
  }

  /**
   * Exports the current score as a standalone, self-contained SVG string.
   *
   * The export is a deep clone of the live `mainSVG` (its width/height
   * attributes come along with the clone), plus:
   * - explicit xmlns / xmlns:xlink declarations so the file is valid
   *   standalone XML even when parsed outside the serializer;
   * - a white background `<rect>` inserted as the first child (an exported
   *   SVG is transparent by default, which is unreadable on dark pages);
   * - unless `includeOverlay` is false, the fixed signature overlay
   *   (`overlayG`) cloned into a plain `<g>` right after the background rect,
   *   so the key/time/tempo signatures currently shown by the overlay are
   *   part of the exported file.
   *
   * Overlay alignment (verified against clear()/updateLayout()): overlaySVG
   * is absolutely positioned at (0, 0) of the container div and mainSVG
   * starts at (0, 0) of the same div, and neither SVG declares a viewBox, so
   * both coordinate systems share a single origin with 1 unit = 1 px. The
   * overlay signatures are drawn starting at x = 0
   * (drawSignatures(this.overlayG, 0, ...)) — the same left edge the score
   * content starts at — so the overlayG clone needs no extra translation:
   * its own transform `translate(0, this.yBaseline)` already reproduces the
   * on-screen vertical offset (the score itself sits lower still, since
   * mainG carries `translate(0, yBaseline + verticalPadding)`). Signature
   * band and score content are therefore vertically disjoint by design,
   * which is also why placing the overlay clone below the score group in
   * paint order does not change the visible result.
   *
   * Note: the returned string is a snapshot of the *current* DOM. Playback
   * state — e.g. the active-note highlight color, or the signature blink
   * animation while it is running — is baked into the export as-is.
   *
   * @param includeOverlay Whether to include the fixed signature overlay in
   *     the export. Defaults to true.
   * @returns The standalone SVG markup, or an empty string if the renderer
   *     was already destroy()ed (the SVG structure is gone, nothing to
   *     serialize).
   */
  public toSVGString(includeOverlay = true): string {
    if (this.destroyed) return ''; // 已销毁：SVG 结构已释放，返回空字符串
    const exportSVG = this.mainSVG.cloneNode(true) as SVGSVGElement;

    // XMLSerializer normally emits namespace declarations on its own, but set
    // them explicitly as a safety net for standalone consumption.
    exportSVG.setAttribute('xmlns', SVGNS);
    exportSVG.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');

    // Defensive: updateLayout() always sets the width/height attributes on
    // mainSVG and cloneNode copies attributes, but fall back to the current
    // instance values should the attributes ever be missing.
    if (!exportSVG.getAttribute('width')) {
      exportSVG.setAttribute('width', `${this.width}`);
    }
    if (!exportSVG.getAttribute('height')) {
      exportSVG.setAttribute('height', `${this.height}`);
    }

    // White background first, so it paints below everything else.
    const background = document.createElementNS(SVGNS, 'rect');
    background.setAttribute('width', '100%');
    background.setAttribute('height', '100%');
    background.setAttribute('fill', 'white');
    exportSVG.insertBefore(background, exportSVG.firstChild);

    // Overlay clone goes after the background and before the score content
    // (background.nextSibling is the cloned mainG).
    if (includeOverlay) {
      const overlayWrapper = document.createElementNS(SVGNS, 'g');
      overlayWrapper.appendChild(this.overlayG.cloneNode(true));
      exportSVG.insertBefore(overlayWrapper, background.nextSibling);
    }

    return new XMLSerializer().serializeToString(exportSVG);
  }

  /**
   * Exports the current score via {@link toSVGString} and triggers a browser
   * download of it as an .svg file. Does nothing after destroy().
   * @param filename Suggested file name for the download. Defaults to
   *     'jianpu-score.svg'.
   */
  public downloadSVG(filename = 'jianpu-score.svg'): void {
    if (this.destroyed) return; // 已销毁：无内容可下载
    const svgString = this.toSVGString();
    if (!svgString) return; // Defensive: nothing to write
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none'; // 隐藏的 <a download>，仅用于触发下载
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

}