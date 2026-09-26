export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i <= line.length) {
    if (line[i] === '"') {
      let v = "";
      i++;
      for (;;) {
        const j = line.indexOf('"', i);
        if (j < 0) { v += line.slice(i); i = line.length; break; }
        v += line.slice(i, j);
        if (line[j + 1] === '"') { v += '"'; i = j + 2; } else { i = j + 1; break; }
      }
      out.push(v);
    } else {
      const j = line.indexOf(",", i);
      const end = j < 0 ? line.length : j;
      out.push(line.slice(i, end));
      i = end;
    }
    i++;
  }
  return out;
}

export async function* lines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const dec = new TextDecoder();
  let buf = "";
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    buf += dec.decode(chunk, { stream: true });
    let nl: number;
    let start = 0;
    while ((nl = buf.indexOf("\n", start)) >= 0) {
      yield buf.slice(start, nl).replace(/\r$/, "");
      start = nl + 1;
    }
    buf = buf.slice(start);
  }
  buf += dec.decode();
  if (buf) yield buf;
}

export type CsvRow = Record<string, string>;

export async function* csvRows(
  lineIter: AsyncIterable<string>,
  prefilter?: (line: string) => boolean,
): AsyncGenerator<CsvRow> {
  let header: string[] | undefined;
  for await (const line of lineIter) {
    if (!header) {
      if (line.startsWith('"SKU"')) header = parseCsvLine(line);
      continue;
    }
    if (!line || (prefilter && !prefilter(line))) continue;
    const f = parseCsvLine(line);
    const row: CsvRow = {};
    for (let k = 0; k < header.length; k++) row[header[k]!] = f[k] ?? "";
    yield row;
  }
}
