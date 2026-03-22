// Font types and interfaces
// Compatible with Google Fonts Developer API

// CSS font-style property values (https://www.w3.org/TR/css-fonts-4/#font-style-prop)
export type FontStyle =
  | "normal" // Default (upright)
  | "italic" // Italic variant
  | "oblique"; // Slanted variant

// CSS font-weight property values
export type FontWeight =
  | "100"
  | "200"
  | "300"
  | "400"
  | "500"
  | "600"
  | "700"
  | "800"
  | "900" // Numeric weights
  | "normal" // Same as 400
  | "bold"; // Same as 700

export interface ParsedFont {
  name: string;
  weights: FontWeight[];
  styles: FontStyle[];
}

// Font variant (combining weight and style)
export type FontVariant =
  | "regular" // 400, normal
  | "italic" // 400, italic
  | "100"
  | "200"
  | "300"
  | "400"
  | "500"
  | "600"
  | "700"
  | "800"
  | "900" // upright weights
  | "100italic"
  | "200italic"
  | "300italic"
  | "500italic"
  | "600italic"
  | "700italic"
  | "800italic"
  | "900italic"; // italic weights

// WebFonts API types
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
