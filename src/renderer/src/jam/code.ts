// A Jam's code: what friends type to join, and the secret its messages are
// encrypted with. Letters and numbers that can't be mistaken for each other
// (no 0/O, 1/I/L), in three groups of four: about 59 bits, too many to guess.

const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const GROUPS = 3;
const GROUP = 4;
const LENGTH = GROUPS * GROUP;

/** a fresh code, like "K7QM-P3XR-9TWD" */
export function makeCode(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  let out = "";
  // only bytes below the largest multiple of the alphabet's size, so every letter is as likely
  const limit = 256 - (256 % ALPHABET.length);
  while (out.length < LENGTH) {
    for (const byte of random(LENGTH)) {
      if (byte < limit && out.length < LENGTH) out += ALPHABET[byte % ALPHABET.length];
    }
  }
  return format(out);
}

function format(raw: string): string {
  const groups: string[] = [];
  for (let i = 0; i < LENGTH; i += GROUP) groups.push(raw.slice(i, i + GROUP));
  return groups.join("-");
}

/** the code in what someone pasted or typed (any case, with or without dashes, inside a message), or null */
export function findCode(text: string): string | null {
  const letters = `[${ALPHABET}]`;
  const group = `${letters}{${GROUP}}`;
  const found = new RegExp(`(?:^|[^A-Z0-9])(${group})[\\s-]?(${group})[\\s-]?(${group})(?![A-Z0-9])`).exec(text.toUpperCase());
  return found ? found.slice(1, 1 + GROUPS).join("-") : null;
}
