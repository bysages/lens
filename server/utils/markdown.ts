import TurndownService from "turndown";

/** Shared converter — construction builds the full rule set, the config is static. */
export const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });

interface TableCell {
  textContent: string;
  getAttribute(name: string): string | null;
}

interface TableRow {
  children: ArrayLike<TableCell>;
  getAttribute(name: string): string | null;
}

function cellText(cell: TableCell): string {
  return (cell.textContent ?? "").replace(/\s+/g, " ").replace(/\|/g, "\\|").trim();
}

function alignmentFrom(cell: TableCell): string {
  const align = cell.getAttribute("style")?.match(/text-align\s*:\s*(left|center|right)/i)?.[1];
  return (align ?? "").toLowerCase();
}

function separatorFor(align: string): string {
  if (align === "center") return ":---:";
  if (align === "right") return "---:";
  if (align === "left") return ":---";
  return "---";
}

// Plain TurndownService has no table rules — cell text is flattened into
// run-together paragraphs. Emit GFM tables instead, using the first row as
// the header row GFM requires.
turndown.addRule("gfmTables", {
  filter: ["table"],
  replacement(_content, node) {
    const table = node as unknown as { querySelectorAll(selectors: string): ArrayLike<TableRow> };
    const rows = Array.from(table.querySelectorAll("tr"));
    if (rows.length === 0) return "";

    const grid = rows.map((row) => Array.from(row.children).map(cellText));
    const header = grid[0];
    if (!header || header.length === 0) return "";
    const width = header.length;

    const headerCells = Array.from(rows[0]!.children);
    const aligns = headerCells.map(alignmentFrom);

    const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
    const lines = [
      line(header),
      line(aligns.map(separatorFor)),
      ...grid.slice(1).map((cells) => {
        const normalized = [...cells];
        while (normalized.length < width) normalized.push("");
        return line(normalized.slice(0, width));
      }),
    ];
    return `\n\n${lines.join("\n")}\n\n`;
  },
});
