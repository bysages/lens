// Unicode subset detection utilities
// Based on Google Fonts official subset definitions
// Reference: googlefonts/nam-files repository

// Optimized batch subset detection for Unicode ranges
export function detectSubsetsInRange(
  startCode: number,
  endCode: number,
  subsets: Set<string>,
): void {
  // Define subset ranges for efficient batch detection
  const subsetRanges = [
    { name: "latin", ranges: [[0x0020, 0x007f]] },
    {
      name: "latin-ext",
      ranges: [
        [0x0080, 0x00ff],
        [0x0100, 0x017f],
        [0x0180, 0x024f],
        [0x0250, 0x02af],
        [0x02b0, 0x02ff],
        [0x1e00, 0x1eff],
      ],
    },
    { name: "greek", ranges: [[0x0370, 0x03ff]] },
    { name: "greek-ext", ranges: [[0x1f00, 0x1fff]] },
    { name: "cyrillic", ranges: [[0x0400, 0x04ff]] },
    {
      name: "cyrillic-ext",
      ranges: [
        [0x0500, 0x052f],
        [0x2de0, 0x2dff],
        [0xa640, 0xa69f],
        [0x1c80, 0x1c8f],
      ],
    },
    {
      name: "arabic",
      ranges: [
        [0x0600, 0x06ff],
        [0x0750, 0x077f],
        [0x08a0, 0x08ff],
      ],
    },
    { name: "hebrew", ranges: [[0x0590, 0x05ff]] },
    { name: "thai", ranges: [[0x0e00, 0x0e7f]] },
    {
      name: "devanagari",
      ranges: [
        [0x0900, 0x097f],
        [0xa8e0, 0xa8ff],
      ],
    },
    { name: "bengali", ranges: [[0x0980, 0x09ff]] },
    { name: "gujarati", ranges: [[0x0a80, 0x0aff]] },
    { name: "gurmukhi", ranges: [[0x0a00, 0x0a7f]] },
    { name: "kannada", ranges: [[0x0c80, 0x0cff]] },
    { name: "malayalam", ranges: [[0x0d00, 0x0d7f]] },
    { name: "oriya", ranges: [[0x0b00, 0x0b7f]] },
    { name: "tamil", ranges: [[0x0b80, 0x0bff]] },
    { name: "telugu", ranges: [[0x0c00, 0x0c7f]] },
  ];

  // Batch detection: check if ranges overlap
  for (const subset of subsetRanges) {
    for (const [rangeStart, rangeEnd] of subset.ranges) {
      // Check if there's any overlap between input range and subset range
      if (!(endCode < rangeStart || startCode > rangeEnd)) {
        subsets.add(subset.name);
        break; // Found overlap for this subset, no need to check other ranges
      }
    }
  }

  // Handle Vietnamese separately (requires individual character check)
  const needsVietnameseCheck = startCode <= 0x1ef9 && endCode >= 0x0102;
  if (needsVietnameseCheck) {
    // Sample check for Vietnamese (every 5th codepoint for performance)
    const vietnameseStart = Math.max(startCode, 0x0102);
    const vietnameseEnd = Math.min(endCode, 0x1ef9);

    for (
      let codepoint = vietnameseStart;
      codepoint <= vietnameseEnd;
      codepoint += 5
    ) {
      if (isVietnameseCodepoint(codepoint)) {
        subsets.add("vietnamese");
        break;
      }
    }
  }

  // Add fallback for unrecognized Latin-script ranges
  if (startCode <= 0x02ff && endCode >= 0x0000) {
    subsets.add("latin");
  }
}

// Detect appropriate subset for a Unicode codepoint
export function detectSubsetForCodepoint(
  codepoint: number,
  subsets: Set<string>,
): void {
  // Latin subset (Basic Latin)
  // U+0020-U+007F
  if (codepoint >= 0x0020 && codepoint <= 0x007f) {
    subsets.add("latin");
    return;
  }

  // Latin Extended subset
  // Latin-1 Supplement: U+0080-U+00FF
  // Latin Extended-A: U+0100-U+017F
  // Latin Extended-B: U+0180-U+024F
  // IPA Extensions: U+0250-U+02AF
  // Spacing Modifier Letters: U+02B0-U+02FF
  // Latin Extended Additional: U+1E00-U+1EFF
  if (
    (codepoint >= 0x0080 && codepoint <= 0x00ff) ||
    (codepoint >= 0x0100 && codepoint <= 0x017f) ||
    (codepoint >= 0x0180 && codepoint <= 0x024f) ||
    (codepoint >= 0x0250 && codepoint <= 0x02af) ||
    (codepoint >= 0x02b0 && codepoint <= 0x02ff) ||
    (codepoint >= 0x1e00 && codepoint <= 0x1eff)
  ) {
    subsets.add("latin-ext");
    return;
  }

  // Vietnamese subset (specific Vietnamese characters)
  if (isVietnameseCodepoint(codepoint)) {
    subsets.add("vietnamese");
    return;
  }

  // Greek subset
  // Greek and Coptic: U+0370-U+03FF
  if (codepoint >= 0x0370 && codepoint <= 0x03ff) {
    subsets.add("greek");
    return;
  }

  // Greek Extended subset
  // U+1F00-U+1FFF
  if (codepoint >= 0x1f00 && codepoint <= 0x1fff) {
    subsets.add("greek-ext");
    return;
  }

  // Cyrillic subset
  // U+0400-U+04FF
  if (codepoint >= 0x0400 && codepoint <= 0x04ff) {
    subsets.add("cyrillic");
    return;
  }

  // Cyrillic Extended subset
  // Cyrillic Supplement: U+0500-U+052F
  // Cyrillic Extended-A: U+2DE0-U+2DFF
  // Cyrillic Extended-B: U+A640-U+A69F
  // Cyrillic Extended-C: U+1C80-U+1C8F
  if (
    (codepoint >= 0x0500 && codepoint <= 0x052f) ||
    (codepoint >= 0x2de0 && codepoint <= 0x2dff) ||
    (codepoint >= 0xa640 && codepoint <= 0xa69f) ||
    (codepoint >= 0x1c80 && codepoint <= 0x1c8f)
  ) {
    subsets.add("cyrillic-ext");
    return;
  }

  // Arabic subset
  // Arabic: U+0600-U+06FF
  // Arabic Supplement: U+0750-U+077F
  // Arabic Extended-A: U+08A0-U+08FF
  if (
    (codepoint >= 0x0600 && codepoint <= 0x06ff) ||
    (codepoint >= 0x0750 && codepoint <= 0x077f) ||
    (codepoint >= 0x08a0 && codepoint <= 0x08ff)
  ) {
    subsets.add("arabic");
    return;
  }

  // Hebrew subset
  // Hebrew: U+0590-U+05FF
  if (codepoint >= 0x0590 && codepoint <= 0x05ff) {
    subsets.add("hebrew");
    return;
  }

  // Thai subset
  // Thai: U+0E00-U+0E7F
  if (codepoint >= 0x0e00 && codepoint <= 0x0e7f) {
    subsets.add("thai");
    return;
  }

  // Devanagari subset
  // Devanagari: U+0900-U+097F
  // Devanagari Extended: U+A8E0-U+A8FF
  if (
    (codepoint >= 0x0900 && codepoint <= 0x097f) ||
    (codepoint >= 0xa8e0 && codepoint <= 0xa8ff)
  ) {
    subsets.add("devanagari");
    return;
  }

  // Bengali subset
  // Bengali: U+0980-U+09FF
  if (codepoint >= 0x0980 && codepoint <= 0x09ff) {
    subsets.add("bengali");
    return;
  }

  // Gujarati subset
  // Gujarati: U+0A80-U+0AFF
  if (codepoint >= 0x0a80 && codepoint <= 0x0aff) {
    subsets.add("gujarati");
    return;
  }

  // Gurmukhi subset
  // Gurmukhi: U+0A00-U+0A7F
  if (codepoint >= 0x0a00 && codepoint <= 0x0a7f) {
    subsets.add("gurmukhi");
    return;
  }

  // Kannada subset
  // Kannada: U+0C80-U+0CFF
  if (codepoint >= 0x0c80 && codepoint <= 0x0cff) {
    subsets.add("kannada");
    return;
  }

  // Malayalam subset
  // Malayalam: U+0D00-U+0D7F
  if (codepoint >= 0x0d00 && codepoint <= 0x0d7f) {
    subsets.add("malayalam");
    return;
  }

  // Oriya subset
  // Oriya: U+0B00-U+0B7F
  if (codepoint >= 0x0b00 && codepoint <= 0x0b7f) {
    subsets.add("oriya");
    return;
  }

  // Tamil subset
  // Tamil: U+0B80-U+0BFF
  if (codepoint >= 0x0b80 && codepoint <= 0x0bff) {
    subsets.add("tamil");
    return;
  }

  // Telugu subset
  // Telugu: U+0C00-U+0C7F
  if (codepoint >= 0x0c00 && codepoint <= 0x0c7f) {
    subsets.add("telugu");
    return;
  }

  // Add fallback for unrecognized Latin-script characters
  if (codepoint >= 0x0000 && codepoint <= 0x02ff) {
    subsets.add("latin");
  }
}

// Check if codepoint is specifically Vietnamese
export function isVietnameseCodepoint(codepoint: number): boolean {
  // Vietnamese-specific characters based on Google Fonts vietnamese subset
  const vietnameseRanges = [
    [0x0102, 0x0103], // Ă ă
    [0x0110, 0x0111], // Đ đ
    [0x0128, 0x0129], // Ĩ ĩ
    [0x0168, 0x0169], // Ũ ũ
    [0x01a0, 0x01a1], // Ơ ơ
    [0x01af, 0x01b0], // Ư ư
    [0x1ea0, 0x1ef9], // Vietnamese Extended range
    [0x20ab, 0x20ab], // Vietnamese Dong sign
  ];

  return vietnameseRanges.some(
    ([start, end]) => codepoint >= start && codepoint <= end,
  );
}
