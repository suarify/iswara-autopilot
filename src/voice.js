// Hardcoded voice commands (English + Malay keywords). parseVoiceCommand
// maps a speech transcript to one of: faster | slower | left | right | uturn.
export const VOICE_COMMANDS = {
  faster: {
    label: "Go faster",
    seconds: 6,
    steer: 0,
    boost_mps: 4,
    instruction:
      "Driver voice command: go faster — pick a faster forward vector up to the ceiling when safe.",
  },
  slower: {
    label: "Slow down",
    seconds: 6,
    steer: 0,
    boost_mps: -6,
    instruction:
      "Driver voice command: slow down — pick a slower forward vector, but do not stop without a concrete reason.",
  },
  left: {
    label: "Turn left",
    seconds: 2.5,
    steer: -0.35,
    boost_mps: 0,
    instruction:
      "Driver voice command: turn left at the next opportunity if a moving left vector exists.",
  },
  right: {
    label: "Turn right",
    seconds: 2.5,
    steer: 0.35,
    boost_mps: 0,
    instruction:
      "Driver voice command: turn right at the next opportunity if a moving right vector exists.",
  },
  uturn: {
    label: "U-turn",
    seconds: 5,
    steer: -0.85,
    boost_mps: -2,
    instruction:
      "Driver voice command: U-turn now — prefer a moving vector that reverses direction when one exists.",
  },
};

const MULTIWORD = [
  [/u[\s-]?turn|you[\s-]?turn|e[\s-]?turn|pusingan|pusing\s+balik|balik\s+semula/i, "uturn"],
  [/speed\s+up|tekan\s+minyak|pijak\s+minyak|go\s+fast/i, "faster"],
  [/slow\s+down|tekan\s+brek|pijak\s+brek/i, "slower"],
  [/belok\s+kiri|ke\s+kiri/i, "left"],
  [/belok\s+kanan|ke\s+kanan/i, "right"],
];

// Whole-word matching (avoids "right" firing on "bright"). Includes
// common ASR mishearings plus Malay keywords.
const WORDS = {
  faster: ["faster", "fastest", "master", "laju", "cepat", "pantas", "pecut", "minyak", "gas", "speed"],
  slower: ["slower", "slowest", "slow", "lower", "perlahan", "brek", "brake", "break", "stop"],
  left: ["left", "lift", "kiri", "last"],
  right: ["right", "write", "light", "ride", "rite", "kanan"],
  uturn: ["uturn", "pusing"],
};

const wordPattern = (words) =>
  new RegExp(`\\b(?:${words.join("|")})\\b`, "i");

const WORD_PATTERNS = Object.fromEntries(
  Object.entries(WORDS).map(([cmd, words]) => [cmd, wordPattern(words)]),
);

const ORDER = ["uturn", "faster", "slower", "left", "right"];

export function parseVoiceCommand(transcript) {
  if (!transcript) return null;
  const matches = (text) => {
    for (const [pattern, cmd] of MULTIWORD)
      if (pattern.test(text)) return cmd;
    for (const cmd of ORDER) if (WORD_PATTERNS[cmd].test(text)) return cmd;
    return null;
  };
  // A single transcript…
  const direct = matches(transcript);
  if (direct) return direct;
  return null;
}

// JSGF grammar to bias the recognizer toward our tiny vocabulary
// (English + Malay). Chrome honors this; other browsers ignore it and
// the keyword matcher below still applies.
export function voiceGrammarSrc() {
  const filler = [
    "go", "to", "the", "a", "do", "please", "tolong", "sikit", "sila",
    "turn", "belok", "ke", "tekan", "pijak", "buat", "here", "now", "cepat",
  ];
  const words = [...new Set([...Object.values(WORDS).flat(), ...filler])];
  return `#JSGF V1.0; grammar kancil; public <cmd> = ${words.join(" | ")};`;
}

// Match across several ASR alternatives; first command found wins.
export function parseVoiceAlternatives(transcripts) {
  for (const text of transcripts || []) {
    const cmd = parseVoiceCommand(text);
    if (cmd) return { cmd, text };
  }
  return null;
}
