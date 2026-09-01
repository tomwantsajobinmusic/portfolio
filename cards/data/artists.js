/**
 * ARTIST DOSSIER DATA
 * ───────────────────
 * One entry per printed card. The key is the slug you put in the QR code URL:
 *   yoursite.com/?id=jensen-truly
 *
 * Fields:
 *   name        — artist / DJ name, shown in cold-stamp foil type
 *   event       — where the shot was taken (goes in the SHOT AT field)
 *   date        — month/year or full date (goes in the CAPTURED field)
 *   gear        — camera/lens, optional flex line (goes in the RIG field)
 *   image       — path to the photo used on the holo card face (portrait, ~3:4)
 *   cardNumber  — optional, e.g. "001/025" if these are numbered like a real TCG set
 *   rarity      — optional label, e.g. "HOLO RARE" — shows as a small foil badge
 *   nameFont    — optional, matches the font used on this artist's printed card,
 *                 e.g. "Venus Rising". Must match a font-family registered via
 *                 @font-face in styles.css. Falls back to --font-display if omitted.
 *   story       — the typewriter copy. Keep paragraphs short — 2-4 sentences reads
 *                 best typed out. Line breaks in the array = new paragraph.
 *   links       — optional array of {label, url} shown as buttons under the dossier
 */

window.ARTISTS = {

  "max-styler": {
    name: "Max Styler",
    event: "Wicked Oaks Festival — Austin, TX",
    date: "2025",
    gear: "Sony α6300 · Tameron 35-150",
    image: "assets/max-styler.jpg",
    cardNumber: "001/010",
    rarity: "HOLO RARE",
    nameFont: "Walnut Regular",
    story: [
      "It was pouring rain, and my first oppurtunity to shoot a big festival. I'll never forget being worried about my camera and the rented lens that I couldn’t afford to break. I was covered in mud and remember thinking to myself, “I definitely don’t look like I belong on stage plastered in mud,” but I had to get the shot. Somehow I just happened to catch Max throwing up the finger to the crowd. This was also the first photo of mine that a big artist posted; I remember sitting at my day job with my mind blown seeing it on his page. Definitely a moment I won’t ever forget.",
      "Printed as a one-of-ten holo, raised cold-stamped + UV Numoda Dragon. Not for sale, for portfolio display purposes only. If it caught your eye, please click the link below to learn more about me."
    ],
    links: [
      { label: "Learn more about my work", url: "https://thomasbrownworks.com" },
      { label: "Instagram", url: "https://instagram.com/thomasbrown802" }
    ]
  },

  "sofi-tukker": {
    name: "Sofi Tukker",
    event: "Breakaway — Dallas, TX",
    date: "2026",
    gear: "Sony α7III · Sigma 70-200",
    image: "assets/Sofi-Tukker.png",
    cardNumber: "002",
    rarity: "HOLO RARE",
    nameFont: "Venus Rising",
    story: [
      "Duplicate this entry to make a new card. Swap the image, rewrite the story, change the slug key above it — nothing else needs to change.",
      "The story field types itself out on load, so keep it punchy. Two short paragraphs is the sweet spot."
    ],
    links: [
      { label: "Learn more about my work", url: "https://thomasbrownworks.com" },
      { label: "Instagram", url: "https://instagram.com/thomasbrown802" }
    ]
  }

};
