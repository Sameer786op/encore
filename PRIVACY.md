# Vyse Music privacy policy

*Last updated: October 25, 2026*

Vyse Music is a free music player that runs on your own computer. It has no accounts of its own, no servers, no ads and no analytics. Nobody behind Vyse Music can see what you listen to.

## What stays on your computer

Your library, playlists, liked songs, listening history, settings and anything you import (such as a Spotify or Google Takeout export) are saved in Vyse Music's folder on your computer and nowhere else. Keys for Last.fm or ListenBrainz, if you add them, are encrypted by Windows before they are saved.

## What Vyse Music connects to

To work, Vyse Music asks these services for things, the same way a web browser would. They see your IP address and what was asked for, under their own privacy policies.

- **YouTube Music**, to search, show artwork and play songs. Playback never uses your Google account, even if you connect it below.
- **LRCLIB** (lrclib.net), to find lyrics for the song that's playing. It is sent the song's title, artist, album and length.
- **Playlist links you paste** from Spotify, YouTube Music or Apple Music, to read the list of songs on that public page.
- **GitHub**, to look for new versions of Vyse Music. The Microsoft Store version doesn't do this; the Store updates it.

Only if you turn them on in Settings:

- **Spotify, YouTube Music or Apple Music**, if you connect them under Connected accounts. You sign in on their own page, in a window from Vyse Music (Spotify and Apple Music) or in your own browser (YouTube Music, on Google's page for signing in a TV, where Google calls it "YouTube on TV"); your password goes only to them. The sign-in is kept on your computer, separately for each service (YouTube Music's encrypted with your Windows account), and Vyse Music uses it only to read your playlists, liked songs and the artists you follow. It never changes anything on your account. Disconnecting deletes that sign-in from your computer; for YouTube Music you can also remove "YouTube on TV" under Security in your Google account, though that may sign out a TV you watch YouTube on too. Song titles from Spotify and Apple Music playlists are searched on YouTube Music to find each song, as with imports.
- **Last.fm** or **ListenBrainz**, which are sent the songs you play, using the account you connect.
- **Discord**, which shows what you're playing on your Discord profile. This goes to the Discord app on your computer.

## Removing your data

Uninstalling Vyse Music from the Microsoft Store removes everything it saved. If you installed it from GitHub, your library stays in `%APPDATA%\Vyse Music` (or `%APPDATA%\Encore`, from before the app was renamed) after uninstalling in case you come back, and you can delete that folder.

## Children

Vyse Music doesn't collect personal information from anyone, including children.

## Questions

Open an issue at [github.com/Sameer786op/encore/issues](https://github.com/Sameer786op/encore/issues).
