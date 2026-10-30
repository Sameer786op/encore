// Text helpers for telling whether two song descriptions are the same song.

/** lowercase, no accents, no punctuation, single spaces */
export function fold(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}' ]+/gu, " ")
    .replace(/'/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// "(feat. X)", "[ft X]", "(with X)" and a trailing " feat. X"
const FEATURE_BRACKETS = /[([]\s*(?:feat\.?|ft\.?|featuring|with)\s[^)\]]*[)\]]/gi;
const FEATURE_TRAILING = /\s(?:feat\.?|ft\.?|featuring)\s.*$/i;

export function stripFeatures(title: string): string {
  return title.replace(FEATURE_BRACKETS, " ").replace(FEATURE_TRAILING, " ").replace(/\s+/g, " ").trim();
}

/** the artists a title credits: "Danza Kuduro (feat. Don Omar)" -> ["Don Omar"] */
export function featuredIn(title: string): string[] {
  const credits = [...title.matchAll(FEATURE_BRACKETS)].map((m) => m[0].slice(1, -1));
  const trailing = FEATURE_TRAILING.exec(title.replace(FEATURE_BRACKETS, " "))?.[0];
  if (trailing) credits.push(trailing);
  return credits.flatMap((credit) => splitArtists(credit.replace(/^\s*(?:feat\.?|ft\.?|featuring|with)\s+/i, "")));
}

// what video titles add round the song's name: "(Official Video)", "[Lyrics]", "(Audio)", "| Hindi Song 2025";
// only brackets of nothing but these words go, so "(8D Audio)" or "(Slowed + Reverb)" still says what it is
const NOISE_WORDS = "official|music|lyrics?|lyrical|video|audio|visuali[sz]er|hd|hq|4k|full|song|mv|m/v";
const VIDEO_NOISE = new RegExp(`\\s*[([]\\s*(?:(?:${NOISE_WORDS})[\\s:,-]*)+[)\\]]`, "gi");

/**
 * The ways a music video's title can name its song, best guess first: "Drake - Hotline Bling (Official Audio)"
 * on the "Drake Media" channel is Hotline Bling by Drake, but "Kesariya - Arijit Singh" puts the song first.
 */
export function videoReadings(title: string, channel: string[]): { title: string; artists: string[] }[] {
  const clean = title.replace(VIDEO_NOISE, " ").replace(/\s[|｜].*$/, "").replace(/\s+/g, " ").trim() || title;
  const dash = /^(.+?)\s[-–—]\s(.+)$/.exec(clean);
  if (!dash) return [{ title: stripFeatures(clean), artists: [...channel, ...featuredIn(clean)] }];
  const [, left, right] = dash;
  return [
    { title: stripFeatures(right), artists: [...splitArtists(left), ...featuredIn(right)] },
    { title: stripFeatures(left), artists: [...splitArtists(stripFeatures(right)), ...featuredIn(right), ...featuredIn(left)] },
    { title: stripFeatures(clean), artists: channel },
  ];
}

/**
 * Tags that make a recording a different version of a song. Only these
 * count when comparing; neutral ones like "remastered" are ignored.
 */
const VERSION_TAGS: [tag: string, pattern: RegExp][] = [
  ["live", /\blive\b|\ben vivo\b|\bao vivo\b/],
  ["remix", /\bremix\b|\brmx\b|\bmix\b(?! ?tape)|\bbootleg\b|\bflip\b|\brework\b|\bvip\b/],
  ["acoustic", /\bacoustic\b|\bunplugged\b/],
  ["instrumental", /\binstrumental\b|\bkaraoke\b|\boff vocal\b/],
  ["cover", /\bcover\b|\btribute\b/],
  ["sped up", /\bsped up\b|\bspeed up\b|\bnightcore\b/],
  ["slowed", /\bslowed\b|\breverb\b/],
  ["acapella", /\ba ?cap+ella\b|\bvocals? only\b/],
  ["extended", /\bextended\b|\bclub mix\b/],
  ["edit", /\b(?:radio |single |short )?edit\b/],
  ["demo", /\bdemo\b/],
  ["8d", /\b8d\b/],
  ["lofi", /\blo ?fi\b/],
  ["orchestral", /\borchestral\b|\bsymphonic\b/],
  ["piano", /\bpiano (?:version|cover)\b/],
];

export function versionTags(title: string): Set<string> {
  const folded = fold(title);
  const tags = new Set<string>();
  for (const [tag, pattern] of VERSION_TAGS) if (pattern.test(folded)) tags.add(tag);
  return tags;
}

/** the name of the song itself: no features, no bracketed or dashed suffixes */
export function coreTitle(title: string): string {
  const withoutFeatures = stripFeatures(title);
  const withoutBrackets = withoutFeatures.replace(/\s*[([{][^)\]}]*[)\]}]/g, " ");
  // "Song - Remastered 2011" / "Song - From the movie X"
  const withoutDash = withoutBrackets.replace(/\s[-–—]\s.*$/, "");
  const core = fold(withoutDash);
  return core || fold(withoutFeatures) || fold(title);
}

/** YouTube channels named "Artist - Topic" or "ArtistVEVO" are the artist */
export function cleanArtistName(name: string): string {
  return name
    .replace(/\s*-\s*topic$/i, "")
    .replace(/vevo$/i, "")
    .replace(/\s+official$/i, "")
    .trim();
}

/** "A, B & C" / "A feat. B" / "A x B" -> ["A", "B", "C"] */
export function splitArtists(value: string): string[] {
  return value
    .split(/\s*(?:,|;|\s&\s|\sand\s|\sx\s|\s×\s|\sfeat\.?\s|\sft\.?\s|\sfeaturing\s|\svs\.?\s|\swith\s)\s*/i)
    .map((a) => a.trim())
    .filter(Boolean);
}

function bigrams(value: string): Map<string, number> {
  const grams = new Map<string, number>();
  const s = value.replace(/\s+/g, " ");
  for (let i = 0; i < s.length - 1; i++) {
    const gram = s.slice(i, i + 2);
    grams.set(gram, (grams.get(gram) ?? 0) + 1);
  }
  return grams;
}

/** Sørensen–Dice similarity of character pairs, 0..1 */
export function dice(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const ga = bigrams(a);
  const gb = bigrams(b);
  let overlap = 0;
  for (const [gram, count] of ga) overlap += Math.min(count, gb.get(gram) ?? 0);
  return (2 * overlap) / (a.length - 1 + (b.length - 1));
}

/** how much of the smaller word set appears in the larger one, 0..1 */
export function tokenContainment(a: string, b: string): number {
  const ta = new Set(a.split(" ").filter(Boolean));
  const tb = new Set(b.split(" ").filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  const [small, large] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  let shared = 0;
  for (const t of small) if (large.has(t)) shared++;
  return shared / small.size;
}

export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const containment = tokenContainment(a, b);
  // containment alone would call "love" and "love story" identical, so damp it by length
  const lengthRatio = Math.min(a.length, b.length) / Math.max(a.length, b.length);
  return Math.max(dice(a, b), containment * (0.6 + 0.4 * lengthRatio));
}

/** a stable key for "this song by this artist", used to group plays and cache matches */
export function songKey(artist: string, title: string): string {
  const primary = splitArtists(cleanArtistName(artist))[0] ?? artist;
  return `${fold(primary)}|${fold(stripFeatures(title))}`;
}
