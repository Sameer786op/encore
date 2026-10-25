# Putting Vyse Music on the Microsoft Store

Store copies are signed by Microsoft, so nobody sees "Windows protected your PC" or a browser download warning, and the Store installs updates. The GitHub download keeps working alongside it.

## Build the package

1. In Partner Center, open the reserved app, then **Product management > Product identity**. Copy these three values into `electron-builder.store.yml`:

   | Partner Center | `electron-builder.store.yml` |
   | --- | --- |
   | Package/Identity/Name | `appx.identityName` |
   | Package/Identity/Publisher | `appx.publisher` (starts with `CN=`) |
   | Package/Properties/PublisherDisplayName | `appx.publisherDisplayName` |

   Set `appx.displayName` to the name you reserved.
2. Run `npm run dist:store`. It makes `release/Vyse-Music-Store-<version>.appx`.
3. `npm run icons` re-makes the Store logos in `build/appx` (with the app icon) from `resources/logo-source.webp` if the logo changes.

The package isn't signed on this computer, so it can't be installed by double-clicking. The Store signs it when you submit.

## Submit it

In the reserved app, **Start your submission**:

- **Pricing and availability**: Free; choose the markets.
- **Properties**: Category **Music**. Privacy policy URL: `https://github.com/Sameer786op/encore/blob/main/PRIVACY.md`. Website: `https://github.com/Sameer786op/encore`. Support: `https://github.com/Sameer786op/encore/issues`.
- **Age ratings**: answer the questionnaire. Vyse Music has no chat, no user-made content shared with others, no purchases and no ads. Songs may have explicit lyrics, which are marked.
- **Packages**: upload the `.appx`.
- **Submission options > Notes for certification**: paste the note below. Partner Center will ask why the package uses `runFullTrust`; Vyse Music is a desktop (Win32) app built with Electron and packaged as MSIX, and every desktop app needs it.
- **Store listings > English**: the text below, plus at least one screenshot (1366×768 or larger).

### Notes for certification

> Vyse Music is a free desktop music player. No account or sign-in is needed. Search for a song from Search or open a song on Home and press play. Everything the user saves stays on their device; Vyse Music has no server. Optional features in Settings (Connected accounts for Spotify, YouTube Music and Apple Music; Last.fm, ListenBrainz, Discord) need the tester's own accounts and can be skipped.

## Store listing

**Product name:** Vyse Music

**Short description:**
A free music player with no ads. Search millions of songs, make playlists and bring in your music from other apps.

**Description:**

Vyse Music is a free, ad-free music player for Windows. Search millions of songs, albums and artists and press play: no account, no ads, no subscription.

Bring the music you already have. Import your playlists, liked songs and history from Spotify, YouTube Music and Apple Music, and play the music files on your computer in the same library.

Home is made for you. Daily mixes come from the artists you play most, new releases from the artists you follow show up as soon as they're out, and the latest trending songs and charts are kept fresh while you listen.

Make it yours. Choose dark or light, an accent colour, a picture or GIF behind everything, and how see-through the glass is. Change the speed, add reverb, or try Slowed + reverb and Nightcore.

Everything stays on your computer. Vyse Music has no server and doesn't track you.

**Features:**
- Search millions of songs, albums and artists, with no ads
- Import playlists and history from Spotify, YouTube Music and Apple Music
- Play the music files on your computer
- Daily mixes and new-release alerts from the artists you love
- New and trending songs on Home, refreshed while you listen
- Synced lyrics that follow along
- Mini player that stays on top
- Speed, reverb, Slowed + reverb and Nightcore
- Dark and light themes, accent colours and your own background
- Keyboard shortcuts you can change, including ones that work in the background
- Last.fm and ListenBrainz scrobbling, and Discord status
- No account, no tracking; your library stays on your computer

**Search terms:** music player, free music, playlists, lyrics, ad free, mp3 player, music library

**What's new in this version:** Home now shows new releases, trending songs and charts, and refreshes every 10 minutes. Search can show more songs. New releases from artists you follow are checked every hour.
