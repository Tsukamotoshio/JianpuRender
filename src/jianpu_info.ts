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

/** Stores minimal information related to a musical note */
export interface NoteInfo {
  /** Starting time, in quarter note quantities (float) */
  start: number;
  /** Note length, in quarter note quantities (float) */
  length: number;
  /** Note pitch according to MIDI standard */
  pitch: number;
  /** Note intensity according to MIDI velocity */
  intensity: number;
  /**
   * An absolute dynamic printed under this note, in LilyPond's spelling
   * without the backslash -- 'p', 'mf', 'sfz'. Absent or empty for none.
   *
   * SumisoraOMR fork addition. JianpuInfo had no notion of dynamics, so a
   * score carrying them (5 of the 40 MusicXML files in this project's corpus
   * do) showed none on screen while the PDF exported from the very same
   * document showed them all: the editor disagreed with its own output.
   *
   * Carried on the note rather than as a separate timed list because that is
   * where the notation itself puts it -- in jianpu-ly the mark is a
   * post-event on a note, so a note that moves takes its mark along, and an
   * editor that inserts or deletes notes has nothing extra to keep in step.
   */
  dynamic?: string;
  /**
   * '<' when a crescendo begins on this note, '>' for a decrescendo.
   *
   * SumisoraOMR fork addition, alongside `dynamic`. A hairpin spans notes but
   * is written as two halves that each belong to one note -- which is how
   * LilyPond and jianpu-ly store it, and what keeps an unfinished one (the
   * normal state while typing) representable at all.
   */
  hairpinStart?: string;
  /** True when a `\!` on this note ends a hairpin begun on an earlier one. */
  hairpinEnd?: boolean;
  /**
   * How the note is written: its digit (1-7). When present, `octaveDot` and
   * `accidental` are read alongside it and nothing is derived from `pitch`.
   *
   * SumisoraOMR fork addition. Upstream only ever had a MIDI pitch to go on,
   * so it decided the digit, the octave dots and the accidental itself --
   * with its own octave convention and its own sharp-or-flat spelling. A
   * caller that already holds a written score (a jianpu text, which is what
   * gets printed) then saw a different score on screen than on paper: in
   * that project's corpus 5887 of 6980 notes differed, mostly by one octave
   * dot in every key but C. Supplying the written form makes the drawing
   * show what was written; leaving it out keeps upstream's behaviour.
   */
  jianpuNumber?: number;
  /** Octave dots as written: positive above, negative below. Read only with `jianpuNumber`. */
  octaveDot?: number;
  /** Accidental as written, coded as JianpuNote's: 0 none, 1 sharp, 2 flat. Read only with `jianpuNumber`. */
  accidental?: number;
}

/** Stores information related to a tempo change on a score (not used yet) */
export interface TempoInfo {
  /** Starting time, in quarter note quantities (float) */
  start: number;
  /** Quarters Per Minute from this quarter on, unless further changes */
  qpm: number;
}

/** Stores information related to a key signature change on a score */
export interface KeySignatureInfo {
  /** Starting time, in quarter note quantities (float) */
  start: number;
  /** Key signature (0=C, 1=C#/Db, ..., 11=B) from this quarter on */
  key: number; // Represents the *tonic* key, e.g., 0 for C, 7 for G, 5 for F
  /**
   * Exactly how to write this key, e.g. `1=Bb` or `6=A`.
   *
   * SumisoraOMR fork addition. `key` is a pitch class, which is all the digit
   * mapping needs but strictly less than the label carries: it cannot say
   * whether the score is major or minor (a piece in A minor and one in C major
   * share pitch class 0), and it cannot say whether the tonic is spelled Bb or
   * A#. Rebuilding the caption from the number therefore mislabels both cases,
   * and measurably so -- 23 of the 74 scores in this project's corpus were
   * captioned wrongly. When a caller knows the answer it passes it here and it
   * is drawn verbatim; without it the old reconstruction still applies, so the
   * renderer keeps working standalone.
   */
  label?: string;
}

/** Stores information related to a time signature change on a score */
export interface TimeSignatureInfo {
  /** Starting time, in quarter note quantities (float) */
  start: number;
  /** Would hold 3 in a 3/4 time signature change */
  numerator: number;
  /** Would hold 4 in a 3/4 time signature change */
  denominator: number;
}

/** Stores a lyric syllable attached to the note sounding at its start time */
export interface LyricInfo {
  /** Starting time, in quarter note quantities (float). The note covering this time gets the lyric. */
  start: number;
  /** Lyric text (a syllable or word) */
  text: string;
}

/** Stores the bare minimal information related to a full single Jianpu score */
export interface JianpuInfo {
  /** All notes in the score. There's no need to be sorted by start q */
  notes: NoteInfo[];
  /** All lyric syllables in the score. They will be attached to the notes sounding at their start q. There's no need to be sorted by start q */
  lyrics?: LyricInfo[];
  /** All tempo changes in the score. They will get sorted by start q */
  tempos?: TempoInfo[];
  /** All key signature changes in the score. They will get sorted by start q */
  keySignatures?: KeySignatureInfo[];
  /** All time signature changes in the score. They will get sorted by start q */
  timeSignatures?: TimeSignatureInfo[];
  /**
   * Total score length in quarter notes, when the caller knows it.
   *
   * SumisoraOMR fork addition. Without it the score's length is inferred from
   * the notes alone, so anything after the last note simply is not drawn: a
   * score of nothing but rests renders as an empty staff, and a half-entered
   * one stops dead at its last note. An editor needs those trailing rests --
   * they are where the user is about to type. Ignored when shorter than the
   * notes themselves, so it can only ever extend the score, never truncate it.
   */
  totalLength?: number;
  /**
   * The written score, one entry per token, in order -- when the caller has
   * one (SumisoraOMR fork addition).
   *
   * With slots, each note and each `-` that continues it is drawn as exactly
   * the token the text has (`6 - q- q6` as a 6, a dash, an underlined dash and
   * an underlined 6) instead of a notation re-derived from note timings, which
   * splits at beats and draws a sustained note as repeated tied digits.
   * `notes` still supplies pitch, dynamics and the written digit; a slot is
   * matched to its note by start. Without slots nothing changes.
   */
  slots?: SlotInfo[];
}

/**
 * One token of the written score (SumisoraOMR fork addition, see
 * `JianpuInfo.slots`). Field names follow the producer's JSON.
 */
export interface SlotInfo {
  /** Start of the token, in quarter notes */
  start: number;
  /** Length of the token, in quarter notes (a note's head plus its `dashes`) */
  duration: number;
  /** A `0` */
  is_rest: boolean;
  /** A `-` continuing whatever precedes it */
  is_dash: boolean;
  /** Underlines: 1 for `q`, 2 for `s`, 3 for `d` */
  lines: number;
  /** Augmentation dots: 1 for a trailing `.` */
  dots: number;
  /** Dashes written after a note longer than a dotted quarter (`1 -` is 1) */
  dashes: number;
  /**
   * Which measure of the text the token is in (0-based) and its place in it.
   * With it, barlines, beat spacing and beam groups follow the measures as
   * written -- a pickup, or an over- or underfull measure in OMR output --
   * instead of measures re-derived from the time signature.
   */
  ref?: { measure: number; index: number };
}

/** Default tempo in case none is found (60 bpm) */
export const DEFAULT_TEMPO: TempoInfo = {
  start: 0,
  qpm: 60
};
/** Default key in case none is found (C key) */
export const DEFAULT_KEY_SIGNATURE: KeySignatureInfo = {
  start: 0,
  key: 0 // 0 represents C Major
};
/** Default time signature in case none is found (4/4) */
export const DEFAULT_TIME_SIGNATURE: TimeSignatureInfo = {
  start: 0,
  numerator: 4,
  denominator: 4
};

/**
 * Calculates the number of quarters that fits within a measure (bar)
 * in a given time signature
 * @param timeSignature The time signature
 * @returns The number of quarters that fit in
 */
export function getMeasureLength(timeSignature: TimeSignatureInfo): number {
  // The length of a measure in quarter notes depends on the time signature.
  // For example, 4/4 has 4 quarter notes. 3/4 has 3 quarter notes.
  // 6/8 has 6 eighth notes, which is 3 quarter notes.
  // This calculation assumes the denominator represents the beat unit directly.
  return timeSignature.numerator * (4 / timeSignature.denominator);
}