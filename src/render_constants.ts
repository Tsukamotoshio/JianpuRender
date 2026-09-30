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

/** Stroke width for lines like bar lines, underlines */
export const LINE_STROKE_WIDTH = 1; // Pixel width for SVG strokes

/** Horizontal spacing multiplier in compact mode (relative to base note size) */
export const COMPACT_SPACING_FACTOR = 1.5; // e.g., 1.5 times the note number width

/** Vertical spacing between underlines (relative to note height) */
export const UNDERLINE_SPACING_FACTOR = 0.2;

/** Vertical offset for octave dots (relative to note height) */
export const OCTAVE_DOT_OFFSET_FACTOR = 1.0;

/** Size of octave/augmentation dots (relative to note height) */
export const DOT_SIZE_FACTOR = 0.1;

/** Length of augmentation dash (relative to note width) */
export const AUGMENTATION_DASH_FACTOR = 0.8;

/** Horizontal spacing after accidentals (relative to note height) */
export const ACCIDENTAL_SPACING_FACTOR = 0.1;

/** Horizontal spacing after augmentation dots/dashes (relative to note height) */
export const AUGMENTATION_SPACING_FACTOR = 0.2;

/** Default font size multiplier relative to config.noteHeight */
export const FONT_SIZE_MULTIPLIER = 1.2; // Adjust for good number size

/**
 * Top edge of a dynamic mark, below the number's baseline (relative to note
 * height). It has to clear everything else drawn under a note: three octave
 * dots reach 1.16 (OCTAVE_DOT_OFFSET_FACTOR * 0.6 + 2 * DOT_SIZE_FACTOR * 2.8)
 * and four duration underlines reach 1.1 (UNDERLINE_SPACING_FACTOR * 2.5 + 3 *
 * UNDERLINE_SPACING_FACTOR), so this sits just under the deeper of the two.
 */
export const DYNAMIC_Y_FACTOR = 1.35;

/** Font size multiplier for dynamic marks (relative to config.noteHeight) */
export const DYNAMIC_FONT_SIZE_MULTIPLIER = 0.8;

/** Font size multiplier for smaller elements like accidentals, time signatures */
export const SMALL_FONT_SIZE_MULTIPLIER = 0.75;


export const DURATION_LINE_SCALES = new Map<number, number>([
    [1, 1.78],
    [2, 1.6], 
    [3, 1.3],
    [4, 1.15]
]);

/**
 * Height of a hairpin wedge at its open end (relative to note height).
 * Set by putting the same score through LilyPond and matching the opening
 * against the digits beside it: at 0.42 the wedge read as a flat sliver next
 * to LilyPond's.
 */
export const HAIRPIN_HEIGHT_FACTOR = 0.6;

/** Gap between a hairpin and the notes (or marks) it runs between, in note heights */
export const HAIRPIN_GAP_FACTOR = 0.25;
