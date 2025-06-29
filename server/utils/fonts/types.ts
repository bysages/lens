// Re-export unifont types for convenience
import type {
  FontFaceData,
  ResolveFontOptions,
  FontStyles,
  Provider,
  Unifont,
} from "unifont";

// Font types and interfaces
export interface WebFontItem {
  kind: "webfonts#webfont";
  family: string;
  category: string;
  variants: string[];
  subsets: string[];
  version?: string;
  lastModified?: string;
  files: Record<string, string>;
  menu?: string;
}

export interface WebFontsResponse {
  kind: "webfonts#webfontList";
  items: WebFontItem[];
}

export interface ParsedFont {
  name: string;
  weights: string[];
  styles: FontStyles[];
}

// Export unifont types
export type { FontFaceData, ResolveFontOptions, FontStyles, Provider, Unifont };
