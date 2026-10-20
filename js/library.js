// Media from the editonny library (github.com/soumatheusgomes/editonny).
// Backgrounds and light overlays were made for editonny (MIT). Music and sounds are CC0.

export const BACKGROUNDS = [
  ["orange-fluid", "Fluido laranja"], ["purple-fluid", "Fluido roxo"], ["neon-green-fluid", "Fluido verde"],
  ["orange-neon-grid", "Grade neon"], ["dark-grid", "Grade escura"], ["light-grid", "Grade clara"],
  ["graph-paper", "Papel quadriculado"], ["wave-dots", "Pontos em onda"], ["soft-light", "Luz suave"],
  ["rising-particles", "Partículas"], ["spinning-rays", "Raios girando"], ["dark-rays", "Raios escuros"],
].map(([id, name]) => ({ id, name, video: `assets/lib/backgrounds/${id}.mp4`, cover: `assets/lib/backgrounds/${id}.jpg` }));

export const LIGHTS = [
  ["golden-light", "Luz dourada"], ["orange-light", "Luz laranja"], ["pink-blue-light", "Luz rosa e azul"],
  ["floating-dust", "Poeira no ar"], ["tv-lines", "Linhas de TV"],
].map(([id, name]) => ({ id, name, video: `assets/lib/overlays/${id}.mp4`, cover: `assets/lib/overlays/${id}.jpg` }));

const MOODS = { "Chill beat": "Tranquila com batida", Groove: "Groove", Upbeat: "Animada", Calm: "Calma", Emotional: "Emocionante", Hiphop: "Hip hop" };
export const MUSIC = [
  ["upbeat-poor-but-happy", "Poor, But Happy", "Upbeat", 128], ["upbeat-blue-skies", "Blue Skies", "Upbeat", 175.6],
  ["upbeat-letting-go-of-the-past", "Letting Go Of The Past", "Upbeat", 179.6],
  ["chill-beat-city-in-the-rearview", "City In The Rearview", "Chill beat", 175.7], ["chill-beat-opinions", "Opinions", "Chill beat", 168],
  ["chill-beat-old-age", "Old Age", "Chill beat", 213.9], ["chill-beat-dream-pop", "Dream Pop", "Chill beat", 241.7],
  ["chill-beat-autumn", "Autumn", "Chill beat", 169.8],
  ["groove-sleep", "Sleep", "Groove", 198], ["groove-make-money", "Make Money", "Groove", 223.9],
  ["groove-make-love", "Make Love", "Groove", 226.4], ["groove-make-funk", "Make Funk", "Groove", 163],
  ["calm-first-snow", "First Snow", "Calm", 174.1], ["calm-laundry-on-the-wire", "Laundry On The Wire", "Calm", 180],
  ["calm-windows-down", "Windows Down", "Calm", 165.8], ["calm-glad-to-be-stuck-inside", "Glad To Be Stuck Inside", "Calm", 160.9],
  ["calm-vintage", "Vintage", "Calm", 174], ["calm-morning-coffee", "Morning Coffee", "Calm", 192],
  ["calm-ghosts", "Ghosts", "Calm", 90.3], ["calm-so-broke", "So Broke", "Calm", 222],
  ["emotional-dreamy-piano-fantasy", "Dreamy Piano Fantasy", "Emotional", 161.6], ["emotional-emotional-piano", "Emotional Piano", "Emotional", 134.4],
  ["hiphop-hip-hop-driver", "Hip Hop Driver", "Hiphop", 107.1],
].map(([id, title, mood, dur]) => ({ id, title, mood: MOODS[mood], dur, file: `assets/lib/music/${id}.mp3` }));

export const SOUNDS = [
  ["title-swoosh", "Título (swoosh)"], ["whoosh", "Passagem rápida"], ["swish", "Mudança"], ["pop-ui", "Aparecer"],
  ["mouth-pop", "Estalo"], ["bubble-pop", "Bolha"], ["cork-pop", "Rolha"], ["ding", "Sino"], ["correct", "Certo"],
  ["soft-error", "Errado"], ["sparkle", "Brilho"], ["impact", "Impacto"], ["riser", "Suspense subindo"],
  ["glitch", "Falha digital"], ["cash-register", "Caixa registradora"], ["cash-chaching", "Dinheiro"],
  ["notification", "Notificação"], ["message", "Mensagem"], ["click", "Clique"], ["typing", "Digitando"],
  ["photo", "Foto"], ["pencil", "Lápis"], ["pen", "Caneta"], ["chalk", "Giz"], ["clock", "Relógio"],
  ["timer", "Cronômetro"], ["question-huh", "Hã?"], ["question-hm", "Hmm?"],
].map(([id, name]) => ({ id, name, file: `assets/lib/sfx/${id}.mp3` }));

// Visual effects drawn by the editor itself, so they also appear in the exported video.
export const EFFECTS = [
  ["vignette", "Vinheta"], ["cinema", "Cinema"], ["noir", "Preto e branco"], ["warm", "Cores quentes"],
  ["cool", "Cores frias"], ["glow", "Brilho"], ["blur", "Desfoque"], ["vhs", "Fita VHS"], ["shake", "Tremor"],
  ["zoomin", "Zoom lento"], ["confetti", "Confete"], ["money", "Chuva de dinheiro"], ["emojirain", "Chuva de emoji"],
].map(([id, name]) => ({ id, name }));

export const MARKS = [
  ["arrow", "Seta"], ["circle", "Círculo"], ["check", "Certo"], ["cross", "Errado"], ["underline", "Sublinhado"],
  ["box", "Caixa"], ["spotlight", "Holofote"], ["sticker", "Emoji"],
].map(([id, name]) => ({ id, name }));

export const TRANSITIONS = [
  ["none", "Nenhuma"], ["fade", "Escurecer"], ["flash", "Flash"], ["zoom", "Zoom"], ["glitch", "Falha digital"], ["blinds", "Persiana"],
];

export const TEXT_STYLES = [
  ["limpa", "Limpa"], ["impacto", "Impacto"], ["manuscrita", "Manuscrita"], ["marcador", "Marcador"], ["neon", "Neon"], ["etiqueta", "Etiqueta"],
];
export const TEXT_ANIMS = [["pop", "Pular"], ["subir", "Subir"], ["digitar", "Digitar"], ["nenhuma", "Nenhuma"]];
export const FORMATS = [["auto", "Igual ao 1º vídeo"], ["9:16", "Vertical 9:16 (Reels, TikTok)"], ["16:9", "Horizontal 16:9 (YouTube)"], ["1:1", "Quadrado 1:1"], ["4:5", "Retrato 4:5 (Feed)"]];
