// Font utility functions (no external dependencies)
// Compatible with Google Fonts API syntax

import type { FontStyle, FontWeight, ParsedFont } from "./types";

// Parse Google Fonts family parameter
// Supports:
// - Simple: "Roboto"
// - With weights: "Roboto:400,700"
// - With styles: "Roboto:italic"
// - Axes syntax (ital,wght@): "Roboto:ital,wght@1,400;0,700"
// - Weight axes syntax (wght@): "Roboto:wght@400;700"
// - Mixed: "Roboto:400,700italic|Open+Sans:wght@300;600;ital@1"
export function parseGoogleFontsFamily(family: string): ParsedFont[] {
  const fonts: ParsedFont[] = [];
  const families = family.split("|");

  for (const familySpec of families) {
    const font: ParsedFont = {
      name: "",
      weights: ["400"],
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
            // Parse ital,wght@ format: 1,400;0,700
            const specs = values?.split(";") || [];
            const weights: FontWeight[] = [];
            const styles: FontStyle[] = [];

            for (const s of specs) {
              const [ital, weight] = s.split(",");
              if (weight) {
                weights.push(weight as FontWeight);
                styles.push(ital === "1" ? "italic" : "normal");
              }
            }

            font.weights = [...new Set(weights)];
            font.styles = [...new Set(styles)];
          } else if (hasWght) {
            // Parse wght@ format: 400;700
            font.weights = parseWeights(values || "");
            font.styles = ["normal"];
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

    fonts.push(font);
  }

  return fonts;
}

// Parse weight specifications including ranges
export function parseWeights(weightSpec: string): FontWeight[] {
  const weights: FontWeight[] = [];
  const specs = weightSpec.split(";");

  for (const spec of specs) {
    if (spec.includes("..")) {
      // Handle range format like "200..800"
      const parts = spec.split("..");
      const start = parts[0] ? Number(parts[0]) : 100;
      const end = parts[1] ? Number(parts[1]) : 900;
      const standardWeights = [100, 200, 300, 400, 500, 600, 700, 800, 900];

      for (const weight of standardWeights) {
        if (weight >= start && weight <= end) {
          weights.push(String(weight) as FontWeight);
        }
      }
    } else {
      // Handle individual weights
      weights.push(spec as FontWeight);
    }
  }

  return weights.length > 0 ? weights : ["400"];
}
