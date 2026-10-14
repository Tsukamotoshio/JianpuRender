/**
 * Fork (SumisoraOMR): the bar number LilyPond prints for a measure.
 *
 * The SumisoraOMR pipeline leaves LilyPond's default bar numbering in place:
 * a number at the start of every line but the first, counting the measures
 * from 1. A pickup (`\partial`) is not a measure of its own there: it is bar
 * 0, and the first full measure after it bar 1 (checked against the PDF: a
 * 2/4 score with an eighth-note pickup and seven full measures on its first
 * line prints 8 at the start of the second).
 *
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
 */

/**
 * The number LilyPond prints for the measure a block starts in.
 * @param measureNumber The block's `measureNumber`: its measure, counted from
 *   1 (the pickup, when there is one, is measure 1), plus where in that
 *   measure the block starts as a fraction.
 * @param anacrusis Whether the score opens with a pickup.
 */
export function printedBarNumber(measureNumber: number, anacrusis: boolean): number {
  return Math.floor(measureNumber + 1e-6) - (anacrusis ? 1 : 0);
}
