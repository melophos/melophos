// the origin story, told twice on purpose (D1). the project's voice is used wherever MELOPHOS speaks as an
// organisation: the README and the home page. the founder's note is the first person original, kept in one
// place on the About page and signed. tests/story.test.ts checks that the README says what PROJECT_VOICE says.

export const PROJECT_VOICE = [
  "MELOPHOS began with a player who has monocular vision, which makes judging depth and scanning across a wide 88-key keyboard harder than it looks.",
  "It aims for lights on a single flat line right where the hands are, any instrument and practice data kept on the player's own server, as the founder's note on the About page explains.",
] as const;

// the README's own words from before the move, unchanged
export const FOUNDER_NOTE =
  "I have monocular vision, which makes judging depth and scanning across a wide 88-key keyboard harder than it looks. Light-up keyboards helped, but every one I found was locked to one brand's app, one instrument and a subscription. MELOPHOS is the tool I wanted: lights on a single flat line right where my hands are, any instrument I own now or later and my practice data kept on my own server.";

export const FOUNDER_SIGNATURE = "Isaac Adjei, founder";
