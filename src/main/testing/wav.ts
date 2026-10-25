/** a short silent WAV file with title / artist / album tags, for tests */
export function makeWav(tags: { title?: string; artist?: string; album?: string }, seconds = 1, sampleRate = 8000): Buffer {
  const samples = Math.round(seconds * sampleRate);
  const data = Buffer.alloc(samples * 2);

  const fmt = Buffer.alloc(24);
  fmt.write("fmt ", 0, "ascii");
  fmt.writeUInt32LE(16, 4);
  fmt.writeUInt16LE(1, 8); // PCM
  fmt.writeUInt16LE(1, 10); // mono
  fmt.writeUInt32LE(sampleRate, 12);
  fmt.writeUInt32LE(sampleRate * 2, 16);
  fmt.writeUInt16LE(2, 20);
  fmt.writeUInt16LE(16, 22);

  const dataHeader = Buffer.alloc(8);
  dataHeader.write("data", 0, "ascii");
  dataHeader.writeUInt32LE(data.length, 4);

  // RIFF INFO list: INAM = title, IART = artist, IPRD = album
  const infoChunks = Object.entries({ INAM: tags.title, IART: tags.artist, IPRD: tags.album })
    .filter((e): e is [string, string] => !!e[1])
    .map(([id, value]) => {
      let text = Buffer.from(`${value}\0`, "utf8");
      if (text.length % 2) text = Buffer.concat([text, Buffer.from([0])]);
      const head = Buffer.alloc(8);
      head.write(id, 0, "ascii");
      head.writeUInt32LE(text.length, 4);
      return Buffer.concat([head, text]);
    });
  const infoBody = Buffer.concat([Buffer.from("INFO", "ascii"), ...infoChunks]);
  const listHeader = Buffer.alloc(8);
  listHeader.write("LIST", 0, "ascii");
  listHeader.writeUInt32LE(infoBody.length, 4);

  const body = Buffer.concat([Buffer.from("WAVE", "ascii"), fmt, listHeader, infoBody, dataHeader, data]);
  const riff = Buffer.alloc(8);
  riff.write("RIFF", 0, "ascii");
  riff.writeUInt32LE(body.length, 4);
  return Buffer.concat([riff, body]);
}
