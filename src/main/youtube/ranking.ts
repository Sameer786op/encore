// How well a search result fits what was typed. YouTube Music's song search is good, but a song
// that's only an upload (a regional release, a fan edit) is found among the videos instead,
// next to reactions and tutorials about it.

/** lowercase, Latin accents and punctuation gone, single spaces; other scripts keep their vowel signs */
export function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\$/g, "s")
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, " ")
    .trim();
}

// words that say nothing about which song is meant
const FILLER = new Set(["the", "a", "an", "of", "and", "or", "in", "on", "to", "by", "feat", "ft", "featuring", "official", "video", "audio", "lyric", "lyrics", "lyrical", "song", "songs", "music", "full", "hd", "hq", "4k", "new", "latest"]);

export function queryWords(query: string): string[] {
  return [...new Set(normalize(query).split(" ").filter((word) => word && !FILLER.has(word)))];
}

/** whether a song's title and artists hold the words searched: all of one or two, three in four of more */
export function matchesQuery(query: string, title: string, artists: string[] = []): boolean {
  const words = queryWords(query);
  if (words.length === 0) return true;
  // words match at their start, so a half-typed "kesar" finds "Kesariya" but "ho" doesn't find "Who"
  const haystack = ` ${normalize([title, ...artists].join(" "))}`;
  const found = words.filter((word) => haystack.includes(` ${word}`)).length;
  return found >= (words.length <= 2 ? words.length : Math.ceil(words.length * 0.75));
}

// videos about a song rather than the song itself
const ABOUT = [
  "reaction", "reacts", "reacting", "first time hearing", "tutorial", "lesson", "how to play", "chords", "karaoke",
  "guitar cover", "piano cover", "drum cover", "bass cover", "flute cover", "violin cover", "fingerstyle",
  "choreography", "dance cover", "dance video", "dance practice", "review", "interview", "podcast", "unboxing",
  "behind the scenes", "making of", "shorts", "status", "ringtone", "1 hour", "10 hours", "hour loop",
  "jukebox", "nonstop", "non stop", "mashup", "top 10", "top 20", "top 50", "playlist", "full album", "best of", "all songs",
];
// edits of a song, which people search for by name when they want one
const EDITS = ["slowed", "reverb", "reverbed", "sped up", "speed up", "nightcore", "8d", "bass boosted", "lofi", "lo fi"];

const has = (text: string, phrase: string) => text.includes(` ${phrase} `);
const unasked = (title: string, query: string, phrases: string[]) => {
  const t = ` ${normalize(title)} `;
  const q = ` ${normalize(query)} `;
  return phrases.some((phrase) => has(t, phrase) && !has(q, phrase));
};

/** a reaction, a lesson, a compilation: something about the song rather than the song */
export function aboutTheSong(title: string, query: string): boolean {
  const t = normalize(title);
  return unasked(title, query, ABOUT) || (/\btop \d+\b|\bshorts?\b/.test(t) && !/\btop \d+\b|\bshorts?\b/.test(normalize(query)));
}

/** a video that's about the song, or an edit of it nobody asked for */
export function offTarget(title: string, query: string): boolean {
  return aboutTheSong(title, query) || unasked(title, query, EDITS);
}
