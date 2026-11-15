/** Incremental parser for a server-sent-event stream. Feed it text chunks; it returns complete payloads. */
export function createSseParser(): (chunk: string) => string[] {
  let buffer = '';
  return (chunk: string) => {
    buffer += chunk.replace(/\r\n/g, '\n');
    const out: string[] = [];
    let cut = buffer.indexOf('\n\n');
    while (cut >= 0) {
      const block = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      const data = block
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).replace(/^ /, ''))
        .join('\n');
      if (data) out.push(data);
      cut = buffer.indexOf('\n\n');
    }
    return out;
  };
}
