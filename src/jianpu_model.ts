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
    JianpuInfo, NoteInfo, KeySignatureInfo, LyricInfo, SlotInfo,
    DEFAULT_TEMPO, DEFAULT_TIME_SIGNATURE, DEFAULT_KEY_SIGNATURE
  } from './jianpu_info';
  import { MeasuresInfo } from './measure_info';
  import { JianpuBlock, JianpuBlockMap, JianpuNote } from './jianpu_block';
  import {
     MAJOR_SCALE_INTERVALS, MIDDLE_C_MIDI
  } from './model_constants';
  
  /**
   * Models JianpuInfo into a musical structure of JianpuBlocks indexed by the
   * quarter note time they start from. Handles note processing, splitting, and
   * rhythmic context.
   */
  export class JianpuModel {
    /** The input score info, stored for potential external updates. */
    public jianpuInfo: JianpuInfo;
    /** Pre-calculated measure, tempo, key, and time signature info per time chunk. */
    public measuresInfo: MeasuresInfo;
    /** The result of analysis: JianpuBlocks indexed by start time (quarters). */
    public jianpuBlockMap: JianpuBlockMap;
    /** Last processed quarter note time, indicating the score's duration. */
    private lastQ: number;
  
    /**
     * Creates a `JianpuModel`.
     * @param jianpuInfo Generic information about the score.
     * @param defaultKey Optional default key signature (0-11, 0=C) if not specified at time 0.
     */
    constructor(jianpuInfo: JianpuInfo, defaultKey?: number) {
      this.jianpuInfo = jianpuInfo;
      this.jianpuBlockMap = new Map();
      this.lastQ = 0;
      this.update(jianpuInfo, defaultKey);
    }
  
    /**
     * 判断给定时间是否处于乐谱最后一个小节
     * @param q 要检查的四分音符时间位置
     * @returns 如果处于最后小节返回true
     */
    public isLastMeasureAtQ(q: number): boolean {
      return q >= this.lastQ - 1e-6; // 允许浮点数精度误差
    }
  
    /**
     * 获取乐谱总时长(用于外部访问lastQ)
     */
    public getTotalDuration(): number {
      return this.lastQ;
    }
  
    /**
     * Processes new JianpuInfo to update the internal model.
     * Sorts input arrays and ensures defaults are present.
     * Recalculates `measuresInfo` and `jianpuBlockMap`.
     * @param jianpuInfo New score information.
     * @param defaultKey Optional default key.
     */
    public update(jianpuInfo: JianpuInfo, defaultKey?: number) {
      this.jianpuInfo = jianpuInfo;
  
      jianpuInfo.notes.sort((a, b) => a.start - b.start);
  
      this.lastQ = 0;
      jianpuInfo.notes.forEach(note => {
          this.lastQ = Math.max(this.lastQ, note.start + note.length);
      });
      // Fork addition: honour a caller-declared total length. `Add final rest
      // if needed` below already knows how to fill the tail -- it just never
      // had a length to fill up to, because lastQ was derived from the notes.
      if (jianpuInfo.totalLength !== undefined) {
          this.lastQ = Math.max(this.lastQ, jianpuInfo.totalLength);
      }
      this.lastQ += 1e-6; // Small buffer for final block processing
  
      jianpuInfo.tempos = jianpuInfo.tempos && jianpuInfo.tempos.length ? jianpuInfo.tempos : [DEFAULT_TEMPO];
      jianpuInfo.tempos.sort((a, b) => a.start - b.start);
      if (jianpuInfo.tempos[0].start > 1e-6) {
          jianpuInfo.tempos.unshift({...DEFAULT_TEMPO, start: 0 });
      }
  
      const startingKey: KeySignatureInfo = defaultKey !== undefined ?
          { start: 0, key: defaultKey } : { ...DEFAULT_KEY_SIGNATURE };
      jianpuInfo.keySignatures = jianpuInfo.keySignatures && jianpuInfo.keySignatures.length ? jianpuInfo.keySignatures : [startingKey];
      jianpuInfo.keySignatures.sort((a, b) => a.start - b.start);
      if (jianpuInfo.keySignatures[0].start > 1e-6) {
           jianpuInfo.keySignatures.unshift({...startingKey, start: 0});
      }
  
      jianpuInfo.timeSignatures = jianpuInfo.timeSignatures && jianpuInfo.timeSignatures.length ? jianpuInfo.timeSignatures : [DEFAULT_TIME_SIGNATURE];
      jianpuInfo.timeSignatures.sort((a, b) => a.start - b.start);
      if (jianpuInfo.timeSignatures[0].start > 1e-6) {
           jianpuInfo.timeSignatures.unshift({...DEFAULT_TIME_SIGNATURE, start: 0});
      }

      // Unlike notes/tempos/keySignatures/timeSignatures above (which are
      // sorted in place, an existing behavior), lyrics are sorted on a copy so
      // the user's input array keeps its original order. The sorted copy is
      // only used locally for lyric-to-note attachment.
      const sortedLyrics = jianpuInfo.lyrics ?
          [...jianpuInfo.lyrics].sort((a, b) => a.start - b.start) : [];

      this.measuresInfo = new MeasuresInfo(jianpuInfo, this.lastQ);
      if (jianpuInfo.slots && jianpuInfo.slots.length) {
          this.slotsToBlocks(jianpuInfo.slots, sortedLyrics);
      } else {
          this.infoToBlocks(sortedLyrics);
      }
    }
  
    /**
    * Converts raw NoteInfo into structured JianpuBlocks.
    * Handles note grouping, rests, and basic splitting.
    * @param sortedLyrics Lyrics sorted by start (a copy, see `update`). Used
    *        to attach lyric syllables to the notes sounding at their start.
    */
    private infoToBlocks(sortedLyrics: LyricInfo[] = []): void {
      const rawBlocks = new Map<number, JianpuBlock>();
      let lastNoteEndTime = 0;
      // Advancing cursor into sortedLyrics: notes are visited in ascending
      // start order, so each lyric only needs to be considered once (O(n+m)
      // instead of a full scan per note).
      const lyricCursor = { index: 0 };
  
      this.jianpuInfo.notes.forEach(note => {
          const noteStart = note.start;
          const measureNumber = this.measuresInfo.measureNumberAtQ(noteStart);
  
          if (noteStart > lastNoteEndTime + 1e-6) { // Fill Rests
              const restStart = lastNoteEndTime;
              const restLength = noteStart - restStart;
              const restMeasureNum = this.measuresInfo.measureNumberAtQ(restStart);
              const restBlock = new JianpuBlock(restStart, restLength, [], restMeasureNum);
              rawBlocks.set(restStart, restBlock);
          }
  
          const keySignatureKey = this.measuresInfo.keySignatureAtQ(noteStart);
          const jianpuNote = this.createJianpuNote(note, keySignatureKey);
          const lyric = this.nextLyricForNote(note, sortedLyrics, lyricCursor);
          if (lyric) {
              jianpuNote.lyric = lyric.text;
          }
  
          let block = rawBlocks.get(noteStart);
          if (!block) {
              block = new JianpuBlock(noteStart, 0, [], measureNumber);
              rawBlocks.set(noteStart, block);
          }
          block.addNote(jianpuNote);
          lastNoteEndTime = Math.max(lastNoteEndTime, noteStart + block.length);
      });
  
       if (this.lastQ > lastNoteEndTime + 1e-6) { // Add final rest if needed
           const restStart = lastNoteEndTime;
           // update() adds a small processing buffer to lastQ, but the score
           // itself ends at the last note's end. Subtracting the buffer keeps
           // the final rest from overshooting the real end, which used to
           // leave a spurious ~1e-6 length rest block in the map.
           const restLength = this.lastQ - 1e-6 - restStart;
            if (restLength > 1e-6) {
               const restMeasureNum = this.measuresInfo.measureNumberAtQ(restStart);
               const restBlock = new JianpuBlock(restStart, restLength, [], restMeasureNum);
               rawBlocks.set(restStart, restBlock);
           }
       }
  
      this.jianpuBlockMap = new Map();
      const sortedStartsFromRaw = Array.from(rawBlocks.keys()).sort((a, b) => a - b);
      this.splitIntoSymbols(sortedStartsFromRaw.map(start => rawBlocks.get(start)!), this.jianpuBlockMap);

      this.jianpuBlockMap.forEach((block) => {
          block.calculateRenderProperties(this.measuresInfo);
      });
    }

    /**
     * Splits blocks at beats and into standard symbol lengths, merging the
     * pieces into `into`. `blocks` must be sorted by start.
     */
    private splitIntoSymbols(blocks: JianpuBlock[], into: JianpuBlockMap): void {
      const blockProcessingQueue: JianpuBlock[] = [...blocks];
      while (blockProcessingQueue.length > 0) {
          const currentBlock = blockProcessingQueue.shift()!;

          const remainingBeatSplit = currentBlock.splitToBeat(this.measuresInfo);
          if (remainingBeatSplit) {
              currentBlock.mergeToMap(into);
              blockProcessingQueue.unshift(remainingBeatSplit);
              continue;
          }

          let blockToSymbolSplit = currentBlock;
          let remainingSymbolSplit : JianpuBlock | null = null;
          do {
              remainingSymbolSplit = blockToSymbolSplit.splitToStandardSymbol(this.measuresInfo);
              blockToSymbolSplit.mergeToMap(into);
              if (remainingSymbolSplit) {
                  blockToSymbolSplit = remainingSymbolSplit;
              }
           } while(remainingSymbolSplit);
      }
    }

    /**
     * Fork (SumisoraOMR): builds the blocks from the written tokens instead of
     * re-deriving a notation from note timings. Each note, and each `-` that
     * continues it, becomes exactly one block drawn the way its token is
     * written; nothing is split at beats, so `6 - q- q6` stays four blocks and
     * a sustained note is never drawn as repeated tied digits.
     *
     * A `-` gets a note of its own -- same pitch, no accidental, no mark, and
     * no tie link to the note it continues: the dash *is* the sustain, so no
     * tie arc may be drawn, and lyrics and dynamics stay on the attack.
     * A note lengthened by an edit (`dashes` > 0) is a head plus that many
     * one-beat dash blocks, as the serializer writes it.
     *
     * Rests are blocks of their own too, and a `-` after a rest is drawn as
     * a dash (`0 - -`, as jianpu-ly prints it, not `0 0 0`). Only time no
     * token accounts for -- after a note that cannot be drawn, say -- is
     * still filled with rests by the upstream rules.
     */
    private slotsToBlocks(slots: SlotInfo[], sortedLyrics: LyricInfo[]): void {
      const lyricCursor = { index: 0 };
      const noteAt = new Map<string, NoteInfo>();
      this.jianpuInfo.notes.forEach(n => noteAt.set(n.start.toFixed(6), n));

      // 文本里的小节：每个小节从它的第一个 token 开始，长度是它所有 token 时值之和。
      // 小节线、拍位（块后留空）、连梁分组都按它算——弱起、OMR 产出的超拍/欠拍小节
      // 都按写的来，而不是按拍号从 0 推出来的时间网格。
      const measures: { start: number; length: number }[] = [];
      let lastMeasure = -1;
      for (const slot of slots) {
          if (!slot.ref) { measures.length = 0; break; }   // 不带小节信息：退回按拍号推
          if (slot.ref.measure !== lastMeasure) {
              measures.push({ start: slot.start, length: 0 });
              lastMeasure = slot.ref.measure;
          }
          measures[measures.length - 1].length += slot.duration;
      }
      const placeInMeasure = (block: JianpuBlock) => {
          if (!measures.length) return;
          let i = 0;
          while (i + 1 < measures.length && measures[i + 1].start <= block.start + 1e-6) i++;
          const m = measures[i];
          block.measureStartQ = m.start;
          block.measureLengthQ = m.length;
          if (i === 0 && this.jianpuInfo.anacrusis) {
              // 弱起：jianpu-ly 把弱起当作一整小节的末尾，拍点从「整小节应在的结尾」往回数。
              const bar = this.measuresInfo.measureLengthAtQ(m.start);
              block.measureStartQ = m.start + this.jianpuInfo.anacrusis - bar;
              block.measureLengthQ = bar;
          }
          // 整数部分是小节号（1 起），小数部分是在小节里的位置——与上游 measureNumber
          // 的含义一致，isMeasureBeginning() 和小节号绘制因此直接按文本走。
          const into = m.length > 1e-9 ? (block.start - m.start) / m.length : 0;
          block.measureNumber = i + 1 + (Math.abs(into) < 1e-6 ? 0 : into);
      };

      const blocks: JianpuBlock[] = [];
      // note 为 null 的块是休止（`0`），或延长休止的 `-`（dash 为真）。
      const addBlock = (start: number, length: number, note: JianpuNote | null,
                        lines: number, dots: number, dash: boolean) => {
          const block = new JianpuBlock(start, length, note ? [note] : [],
                                        this.measuresInfo.measureNumberAtQ(start));
          block.written = { lines, dots, dash };
          placeInMeasure(block);
          block.markBeatBounds(this.measuresInfo);   // spacing: a full gap after the end of a beat
          blocks.push(block);
      };
      const dashNote = (of: JianpuNote, start: number, length: number): JianpuNote => ({
          start, length, pitch: of.pitch, intensity: of.intensity,
          jianpuNumber: of.jianpuNumber, octaveDot: of.octaveDot, accidental: 0,
      });

      // 下一个 `-` 延续的是什么：一个音（held），一个休止（afterRest），或什么都不是
      // （段首、画不出来的音之后）——最后这种留给下面的补休止逻辑。
      let held: JianpuNote | null = null;
      // 上一个画成数字的音（音头，或它在前面小节被重印的那个），新重印的数字从它连线。
      let lastDigit: JianpuNote | null = null;
      let afterRest = false;
      for (const slot of slots) {
          if (slot.is_rest) {
              held = null;
              lastDigit = null;
              afterRest = true;
              const headLength = slot.duration - slot.dashes;
              addBlock(slot.start, headLength, null, slot.lines, slot.dots, false);
              for (let k = 0; k < slot.dashes; k++) {
                  addBlock(slot.start + headLength + k, 1, null, 0, 0, true);
              }
              continue;
          }
          if (slot.is_dash) {
              if (held && lastDigit && slot.ref && slot.ref.index === 0) {
                  // jianpu-ly 的印法：开启一个小节、延续一个音的 `-` 印成那个音本身（数字、
                  // 升降号、八度点照音头，下划线与附点照这个 `-`），并与前一个数字连线。
                  // 同小节其后的 `-` 仍是横线；延续休止的 `-` 不受影响。
                  const again: JianpuNote = {
                      start: slot.start, length: slot.duration, pitch: held.pitch,
                      intensity: held.intensity, jianpuNumber: held.jianpuNumber,
                      octaveDot: held.octaveDot, accidental: held.accidental,
                      writtenTieFrom: lastDigit,
                  };
                  lastDigit.writtenTieTo = again;
                  addBlock(slot.start, slot.duration, again, slot.lines, slot.dots, false);
                  lastDigit = again;
              } else if (held) {
                  addBlock(slot.start, slot.duration, dashNote(held, slot.start, slot.duration),
                           slot.lines, slot.dots, true);
              } else if (afterRest) {
                  addBlock(slot.start, slot.duration, null, slot.lines, slot.dots, true);
              }
              continue;
          }
          afterRest = false;
          const info = noteAt.get(slot.start.toFixed(6));
          if (!info) { held = null; lastDigit = null; continue; }
          const headLength = slot.duration - slot.dashes;
          const note = this.createJianpuNote({ ...info, length: headLength },
                                             this.measuresInfo.keySignatureAtQ(slot.start));
          const lyric = this.nextLyricForNote(info, sortedLyrics, lyricCursor);
          if (lyric) {
              note.lyric = lyric.text;
          }
          addBlock(slot.start, headLength, note, slot.lines, slot.dots, false);
          for (let k = 0; k < slot.dashes; k++) {
              const start = slot.start + headLength + k;
              addBlock(start, 1, dashNote(note, start, 1), 0, 0, true);
          }
          held = note;
          lastDigit = note;
      }

      // 补休止：token 块没覆盖到的时间段，先在文本小节线处切开（每条小节线前都要有块，
      // 小节线才画得出来），再按上游原来的规则切。
      const gaps: JianpuBlock[] = [];
      const end = this.lastQ - 1e-6;
      const addGap = (from: number, to: number) => {
          const cuts = measures.map(m => m.start).filter(t => t > from + 1e-6 && t < to - 1e-6);
          [from, ...cuts].forEach((s, k) => {
              const e = k < cuts.length ? cuts[k] : to;
              gaps.push(new JianpuBlock(s, e - s, [], this.measuresInfo.measureNumberAtQ(s)));
          });
      };
      let covered = 0;
      for (const block of blocks) {
          if (block.start > covered + 1e-6) addGap(covered, block.start);
          covered = Math.max(covered, block.start + block.length);
      }
      if (end > covered + 1e-6) addGap(covered, end);
      // 切之前先定位到文本小节：拍点从文本小节起点数，切出的碎片继承同一小节。
      gaps.forEach(placeInMeasure);
      const rests: JianpuBlockMap = new Map();
      this.splitIntoSymbols(gaps, rests);
      // 切分时上游按拍号给新块算了小节号；这里统一改成文本小节。
      rests.forEach(placeInMeasure);

      // The renderer walks the map in insertion order, so insert by start.
      // Array.from, not spread: the ES5 build has no downlevelIteration, and
      // spreading a Map iterator there silently yields nothing.
      const ordered = blocks.concat(Array.from(rests.values())).sort((a, b) => a.start - b.start);
      this.jianpuBlockMap = new Map(ordered.map(block => [block.start, block]));
      this.jianpuBlockMap.forEach((block) => {
          block.calculateRenderProperties(this.measuresInfo);
      });
    }
  
    /**
     * Finds the first lyric whose start falls within the note's sounding
     * interval `[note.start, note.start + note.length)` (1e-6 tolerance on
     * both bounds) and advances the shared cursor past it, so each lyric can
     * be attached at most once. Chord notes share the same start: the first
     * note processed (the first in the user's notes array, as the sort is
     * stable) takes the lyric and the cursor moves on, so the remaining chord
     * members stay lyric-free. Lyrics falling in rest gaps, outside the score
     * or beyond a note's end are skipped here or discarded by the cursor on a
     * later note.
     *
     * Attachment happens BEFORE any beat/measure splitting (notes are split
     * later in `infoToBlocks`'s processing queue), so a lyric landing mid-note
     * ends up on the FIRST segment after `splitJianpuNote` cleaves the note
     * (the split part never receives the `lyric` field — see
     * `splitJianpuNote`).
     * @param note The raw NoteInfo currently being converted.
     * @param sortedLyrics Lyrics sorted by start.
     * @param cursor Shared advancing index into `sortedLyrics`.
     * @returns The matching LyricInfo, or null when none fits this note.
     */
     private nextLyricForNote(
        note: NoteInfo,
        sortedLyrics: LyricInfo[],
        cursor: { index: number }
     ): LyricInfo | null {
        const epsilon = 1e-6;
        // Discard lyrics starting before this note: they fell into a rest gap
        // or before the score, and can never match this or any later note
        // (notes are visited in ascending start order).
        while (cursor.index < sortedLyrics.length &&
               sortedLyrics[cursor.index].start < note.start - epsilon) {
            cursor.index++;
        }
        const lyric = sortedLyrics[cursor.index];
        if (!lyric) return null;
        // Half-open interval with tolerance: a lyric exactly at the note end
        // (or within epsilon below it) belongs to the following note, not this
        // one.
        if (lyric.start >= note.start - epsilon &&
            lyric.start < note.start + note.length - epsilon) {
            cursor.index++;
            return lyric;
        }
        return null;
    }

     /**
     * Converts a raw NoteInfo into a JianpuNote, calculating the
     * Jianpu number, octave dots, and accidental based on key context.
     * @param note The raw NoteInfo.
     * @param key The current key signature (0-11).
     * @returns A processed JianpuNote.
     */
     private createJianpuNote(note: NoteInfo, key: number): JianpuNote {
          // Fork: a note that says how it is written is drawn that way. The
          // three fields go together -- deriving the dots from the pitch
          // while taking the digit as written could mix two octave
          // conventions on one note -- so the derivation runs only for a
          // note that gives no digit at all (upstream's performance-style input).
          const details = note.jianpuNumber !== undefined
              ? { jianpuNumber: note.jianpuNumber,
                  octaveDot: note.octaveDot ?? 0,
                  accidental: note.accidental ?? 0 }
              : mapMidiToJianpu(note.pitch, key);

          const jianpuNote: JianpuNote = {
              ...note,
              jianpuNumber: details.jianpuNumber,
              octaveDot: details.octaveDot,
              accidental: details.accidental,
          };
          return jianpuNote;
      }
  }
  

/**
 * Maps a MIDI pitch to its Jianpu representation (number, octave dots, accidental)
 * relative to a given key signature (tonic).
 * @param midiPitch The MIDI pitch number (e.g., 60 = Middle C).
 * @param key The key signature tonic (0=C, 1=Db/C#, ..., 11=B).
 * @returns Object containing { jianpuNumber (1-7), octaveDot, accidental (0=none, 1=#, 2=b, 3=natural is not used by this func) }.
 */
export function mapMidiToJianpu(midiPitch: number, key: number): {
    jianpuNumber: number;
    octaveDot: number;
    accidental: number;
  } {
    const keyPitchClass = key % 12;
    let tonicMidiRef = MIDDLE_C_MIDI + keyPitchClass;
    // Adjust tonicMidiRef to be the tonic in the octave typically represented with no dots
    // For C major, tonicMidiRef is C4. For G major, G3. For F major, F3 etc.
    if (keyPitchClass > (MIDDLE_C_MIDI % 12)) { // MIDDLE_C_MIDI % 12 is 0 (C)
        tonicMidiRef -= 12;
    }
  
    // tonicMidi: The tonic of the key, adjusted to be in an octave close to the input midiPitch
    // This helps in calculating the interval within a single octave.
    const octaveOffsetForIntervalCalc = Math.round((midiPitch - tonicMidiRef) / 12);
    const tonicMidi = tonicMidiRef + octaveOffsetForIntervalCalc * 12;
  
    // Interval in semitones from the octave-adjusted tonic to the midiPitch.
    const interval = (midiPitch - tonicMidi + 12) % 12;
  
    let jianpuNumber = MAJOR_SCALE_INTERVALS[interval];
    let accidental = 0; // 0:none, 1:#, 2:b
  
    if (jianpuNumber === undefined) { // Note is chromatic relative to the major scale of the key
        // interval is the chromatic semitone distance from the tonic of the current key.
        // e.g. in C major (tonic C): C# is interval 1, Eb is interval 3, etc.
        // MAJOR_SCALE_INTERVALS maps diatonic intervals from tonic to jianpu degrees (1-7)
        // e.g. MAJOR_SCALE_INTERVALS[0] is 1 (Do), MAJOR_SCALE_INTERVALS[4] is 3 (Mi)
  
        switch (interval) {
            case 1: // e.g., C# in C major (1 semitone above tonic)
                // Prefer C# (Do sharp) over Db (Re flat)
                jianpuNumber = MAJOR_SCALE_INTERVALS[0]; // Jianpu degree of the note it's sharpening (tonic)
                accidental = 1; // sharp
                break;
            case 3: // e.g., Eb in C major (3 semitones above tonic)
                // Prefer Eb (Mi flat) over D# (Re sharp)
                jianpuNumber = MAJOR_SCALE_INTERVALS[4]; // Jianpu degree of the note it's flatting (major third)
                accidental = 2; // flat
                break;
            case 6: // e.g., F# in C major (6 semitones above tonic)
                // Prefer F# (Fa sharp) over Gb (So flat)
                jianpuNumber = MAJOR_SCALE_INTERVALS[5]; // Jianpu degree of the note it's sharpening (perfect fourth)
                accidental = 1; // sharp
                break;
            case 8: // e.g., Ab in C major (8 semitones above tonic)
                // Prefer Ab (La flat) over G# (So sharp)
                jianpuNumber = MAJOR_SCALE_INTERVALS[9]; // Jianpu degree of the note it's flatting (major sixth)
                accidental = 2; // flat
                break;
            case 10: // e.g., Bb in C major (10 semitones above tonic)
                // Prefer Bb (Ti flat) over A# (La sharp)
                jianpuNumber = MAJOR_SCALE_INTERVALS[11]; // Jianpu degree of the note it's flatting (major seventh)
                accidental = 2; // flat
                break;
            default: {
                // This case should ideally not be reached if `interval` is truly chromatic (1,3,6,8,10)
                // and MAJOR_SCALE_INTERVALS is well-defined.
                // As a fallback, try the original logic's sharp preference.
                console.warn(`Unexpected chromatic interval ${interval} in mapMidiToJianpu. Defaulting to sharp of lower valid degree.`);
                const lowerIntervalFallback = (interval - 1 + 12) % 12;
                const upperIntervalFallback = (interval + 1 + 12) % 12;
                const lowerDegreeFallback = MAJOR_SCALE_INTERVALS[lowerIntervalFallback];
                const upperDegreeFallback = MAJOR_SCALE_INTERVALS[upperIntervalFallback];
  
                if (lowerDegreeFallback !== undefined) {
                    jianpuNumber = lowerDegreeFallback;
                    accidental = 1; // sharp
                } else if (upperDegreeFallback !== undefined) {
                    jianpuNumber = upperDegreeFallback;
                    accidental = 2; // flat
                } else {
                    // Extremely unlikely fallback if MAJOR_SCALE_INTERVALS is sparse.
                    jianpuNumber = 1; // Default to 1#
                    accidental = 1;
                    console.error(`Could not determine Jianpu number components for MIDI ${midiPitch}, interval ${interval} from tonic in key ${key}.`);
                }
                break;
            }
        }
  
        // Final check: jianpuNumber should be defined after the switch if interval was one of 1,3,6,8,10
        // and MAJOR_SCALE_INTERVALS has entries for 0,4,5,9,11.
        if (jianpuNumber === undefined) {
             console.error(`Jianpu number became undefined for MIDI ${midiPitch} (interval ${interval}, key ${key}) after chromatic processing. This indicates a logic error or misconfigured MAJOR_SCALE_INTERVALS.`);
             // Provide a very basic fallback to prevent crashes, though this state is erroneous.
             jianpuNumber = 1;
             accidental = 1; // Default to 1#
        }
    }
  
    // Octave dots are relative to the tonicMidiRef (the "no dots" reference octave for the current key's tonic).
    const octaveDot = Math.floor((midiPitch - tonicMidiRef) / 12);
    
    return {
        jianpuNumber,
        octaveDot,
        accidental,
    };
  }