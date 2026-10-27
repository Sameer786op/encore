/** a YouTube Music image re-requested at about `px` square; other images as they are */
export function artAt(src: string, px: number): string {
  if (/googleusercontent\.com|ggpht\.com/.test(src)) return src.replace(/=w\d+-h\d+[^&?]*$/, `=w${px}-h${px}-l90-rj`);
  return src;
}
