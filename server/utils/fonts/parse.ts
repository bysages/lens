// Font utility functions (no external dependencies)
// Compatible with Google Fonts API syntax

import type { FontStyle, FontWeight, ParsedFont } from "./types";

function parseWeightRange(value: string): { max: number; min: number } | null {
  const parts = value.split("..");
  const min = Number(parts[0]);
  const max = Number(parts[1]);
  return parts.length === 2 && Number.isFinite(min) && Number.isFinite(max) && min <= max
    ? { min, max }
    : null;
}

// Parse Google Fonts family parameter
// Supports:
// - Simple: "Roboto"
// - With weights: "Roboto:400,700"
// - With styles: "Roboto:italic"
// - Axes syntax (ital,wght@): "Roboto:ital,wght@1,400;0,700"
// - Variable ranges (wght@): "Roboto:wght@200..800"
// - Mixed: "Roboto:400,700italic|Open+Sans:wght@300;600;ital@1"
export function parseGoogleFontsFamily(family: string): ParsedFont[] {
  const fonts: ParsedFont[] = [];
  const families = family.split("|");

  for (const familySpec of families) {
    const font: ParsedFont = {
      name: "",
      weights: [],
      weightRanges: [],
      styles: ["normal"],
    };

    if (familySpec.includes(":")) {
      const parts = familySpec.split(":");
      const name = parts[0] ?? "";
      const spec = parts[1] ?? "";

      if (name) {
        font.name = name.replaceAll(/\+/g, " ");
      }

      if (spec) {
        // Handle axes syntax: ital,wght@ or wght@
        if (spec.includes("@")) {
          const [axis, values] = spec.split("@");
          const axesList = axis?.split(",") || [];
          const hasItal = axesList.includes("ital");
          const hasWght = axesList.includes("wght");

          if (hasItal && hasWght) {
            // Parse ital,wght@ format: 0,400;1,200..800
            const specs = values?.split(";") || [];
            const weights: FontWeight[] = [];
            const styles: FontStyle[] = [];

            for (const s of specs) {
              const [ital, weight] = s.split(",");
              const style: FontStyle = ital === "1" ? "italic" : "normal";
              const range = weight ? parseWeightRange(weight) : null;

              if (range) {
                font.weightRanges.push({ ...range, styles: [style] });
              } else if (weight) {
                weights.push(weight as FontWeight);
              }
              styles.push(style);
            }

            font.weights = [...new Set(weights)];
            font.styles = [...new Set(styles)];
          } else if (hasWght) {
            // Parse wght@ format: 400;700 or 200..800
            for (const spec of values?.split(";") || []) {
              const range = parseWeightRange(spec);
              if (range) {
                font.weightRanges.push({ ...range, styles: ["normal"] });
              } else if (spec) {
                font.weights.push(spec as FontWeight);
              }
            }
            font.weights = [...new Set(font.weights)];
          } else if (hasItal) {
            // Parse ital@ format: 1 (italic only)
            font.weights = ["400"];
            font.styles = values
              ?.split(",")
              .map((v) => (v === "1" ? "italic" : "normal")) as FontStyle[];
          }
        } else {
          // Handle simple comma-separated list: 400,700,italic
          const values = spec.split(",");
          const weights: FontWeight[] = [];
          const styles: FontStyle[] = [];

          for (const v of values) {
            if (v === "italic" || v === "i") {
              styles.push("italic");
            } else if (v === "bold" || v === "b") {
              weights.push("700");
            } else if (v === "normal") {
              weights.push("400");
            } else if (!isNaN(Number.parseInt(v, 10))) {
              weights.push(v as FontWeight);
            }
          }

          if (weights.length > 0) {
            font.weights = [...new Set(weights)];
          }
          if (styles.length > 0) {
            font.styles = [...new Set(styles)];
          }
        }
      }
    } else {
      font.name = familySpec.replaceAll(/\+/g, " ");
    }

    if (font.weights.length === 0 && font.weightRanges.length === 0) {
      font.weights = ["400"];
    }

    fonts.push(font);
  }

  return fonts;
}
