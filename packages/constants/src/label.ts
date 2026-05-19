/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// Asana-style vivid label palette (color-hex.com/color-palette/1011310).
// Swatch set for label + custom-field option colour pickers and
// getRandomLabelColor(). Solid-fill pills render text in a contrasting
// colour (see labelPillStyle), so these saturated values read well.
export const LABEL_COLOR_OPTIONS = ["#3be8b0", "#1aafd0", "#6a67ce", "#ffb900", "#fc636b"];

export const getRandomLabelColor = () => {
  const randomIndex = Math.floor(Math.random() * LABEL_COLOR_OPTIONS.length);
  return LABEL_COLOR_OPTIONS[randomIndex];
};
