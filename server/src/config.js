import fs from "node:fs";
import path from "node:path";

/** Division ladder. `min` is the inclusive rating floor; `tier` drives the track pool. */
export const DEFAULT_DIVISIONS = [
  { name: "Bronze I", min: -Infinity, tier: 1 },
  { name: "Bronze II", min: 850, tier: 1 },
  { name: "Bronze III", min: 925, tier: 1 },
  { name: "Silver I", min: 1000, tier: 2 },
  { name: "Silver II", min: 1075, tier: 2 },
  { name: "Silver III", min: 1150, tier: 2 },
  { name: "Gold I", min: 1225, tier: 3 },
  { name: "Gold II", min: 1300, tier: 3 },
  { name: "Gold III", min: 1400, tier: 3 },
  { name: "Master I", min: 1500, tier: 4 },
  { name: "Master II", min: 1600, tier: 4 },
  { name: "Master III", min: 1700, tier: 4 },
  { name: "Trackmaster", min: 1850, tier: 4 },
];

/** The 17 official PolyTrack 0.6.3 tracks. `id` is the game's track id (sha256 of the track data). */
export const OFFICIAL_TRACKS = [
  { id: "5803f9e963625804e3de3246d043dc7dde847aa32e991f7f7326b0453f1fa038", name: "Summer 1", author: "Kodub", trackUrl: "tracks/official/summer1.track", tier: 1, roundSeconds: 70 },
  { id: "7eac4fee1111152cfba4d3737410264ca0f22c7f5a2211e79f0099589b8b48c0", name: "Summer 2", author: "Kodub", trackUrl: "tracks/official/summer2.track", tier: 1, roundSeconds: 75 },
  { id: "148826aa16ffaa23dbc453b32cff05e025ddbce1773fc7733cc13d218926515a", name: "Summer 3", author: "Kodub", trackUrl: "tracks/official/summer3.track", tier: 1, roundSeconds: 80 },
  { id: "93c7363dfea7fb09ca1d23b72cad5df43a30841d41c8ff25fb544c85bb03c7ae", name: "Summer 4", author: "Kodub", trackUrl: "tracks/official/summer4.track", tier: 1, roundSeconds: 80 },
  { id: "7603aaeffa1989a649dfaa8e1804bed4481b49df233e377687d0669899566e52", name: "Summer 5", author: "Kodub", trackUrl: "tracks/official/summer5.track", tier: 2, roundSeconds: 90 },
  { id: "c117823cf6788e3247b9ee63a0c091c07352bbe352c650a7790dc6718148c2fa", name: "Summer 6", author: "Kodub", trackUrl: "tracks/official/summer6.track", tier: 2, roundSeconds: 90 },
  { id: "e4bcaca3a583bb0eb62a700a69d14e89c852f0c5bf740fca76e0519ebdfc9ab1", name: "Summer 7", author: "Kodub", trackUrl: "tracks/official/summer7.track", tier: 2, roundSeconds: 100 },
  { id: "7239b17057127936907a805b0caa5d8c6f6c97eca9bdabf1a5312dce479629b7", name: "Winter 1", author: "Kodub", trackUrl: "tracks/official/winter1.track", tier: 2, roundSeconds: 80 },
  { id: "99864b635d1891d22e17eb9267527a07a92c49c0f02893729fa2ded90e3ca0f9", name: "Winter 2", author: "Kodub", trackUrl: "tracks/official/winter2.track", tier: 2, roundSeconds: 90 },
  { id: "a5341fe706097cff2a3812a3fc0d87399254557328351ae8e5c882700fc1a196", name: "Winter 3", author: "Kodub", trackUrl: "tracks/official/winter3.track", tier: 3, roundSeconds: 90 },
  { id: "7d134c939df80c676a258266201beedd3b93572d5603f3ff4339ff8679803715", name: "Winter 4", author: "Kodub", trackUrl: "tracks/official/winter4.track", tier: 3, roundSeconds: 100 },
  { id: "2fe4bd46b0075cc25fc770ce50adbb68447cf493c999635bb272d231811dd264", name: "Winter 5", author: "Kodub", trackUrl: "tracks/official/winter5.track", tier: 3, roundSeconds: 110 },
  { id: "c20b4ee3cd517ca6cae7e43f047548757287fbd08ba81b97892a3ef520159a34", name: "Desert 1", author: "Kodub", trackUrl: "tracks/official/desert1.track", tier: 3, roundSeconds: 90 },
  { id: "88647ea04145fbbbb19b55f1590e038fb0378acb2571110f02cb545cc46b0d57", name: "Desert 2", author: "Kodub", trackUrl: "tracks/official/desert2.track", tier: 3, roundSeconds: 100 },
  { id: "2806030c503abb41a1a26fa9a570888be14296172bb273798ef0ad87a108a2ec", name: "Desert 3", author: "Kodub", trackUrl: "tracks/official/desert3.track", tier: 4, roundSeconds: 100 },
  { id: "4697ea67b18c3f49b30a3d8884602115536650bc5435c88e3732e64d21a72d33", name: "Desert 4", author: "Kodub", trackUrl: "tracks/official/desert4.track", tier: 4, roundSeconds: 110 },
  { id: "e5d084e06db4ab71196fea44efeceb23c8561266a78669c324a38f92581fe2db", name: "Desert 5", author: "Kodub", trackUrl: "tracks/official/desert5.track", tier: 4, roundSeconds: 120 },
];

export const DEFAULT_CONFIG = {
  host: "0.0.0.0",
  port: 8788,
  dataDir: "./data",
  /** Serve a PML mod directory at /mod (handy for local development). */
  serveModFrom: null,
  /** Only accept clients reporting this game version (null = any). */
  gameVersion: "0.6.3",
  /** Reject players whose PML reports physics-touching mods. */
  requireVanillaPhysics: true,
  maxConnections: 500,
  queues: {
    duel: { name: "Ranked 1v1", teams: 2, teamSize: 1, scoring: "duel", roundsToWin: 4, maxRounds: 9 },
    teams: { name: "Ranked 3v3", teams: 2, teamSize: 3, scoring: "teams", roundsToWin: 5, maxRounds: 13, pointsTable: [6, 5, 4, 3, 2, 1] },
    ffa: { name: "Ranked FFA", players: 4, minPlayers: 3, scoring: "points", maxRounds: 5, pointsTable: [10, 6, 4, 3, 2, 1] },
  },
  matchmaking: {
    tickMs: 2000,
    /** Rating window around the group mean a player accepts right away... */
    initialWindow: 150,
    /** ...which grows by this much for every 10 seconds waited... */
    windowGrowthPer10s: 50,
    /** ...up to this maximum. */
    maxWindow: 1000,
    /** FFA queues may start with `minPlayers` once someone waited this long. */
    relaxAfterSeconds: 60,
  },
  rounds: {
    countdownSeconds: 4,
    /** Once everyone has a finished run, the round ends after this many seconds. */
    finishGraceSeconds: 15,
    /** Time the results screen stays up between rounds. */
    resultsSeconds: 7,
    /** Players must report ready (track loaded) within this time. */
    readyTimeoutSeconds: 30,
    /** A disconnected player may reconnect within this time before forfeiting. */
    disconnectGraceSeconds: 20,
    /** Records arriving this long after the round end are still accepted (latency). */
    lateRecordGraceMs: 1500,
    /** Fallback when a track has no roundSeconds. */
    defaultRoundSeconds: 90,
  },
  rating: {
    initial: 1000,
    kPlacement: 40,
    kNormal: 20,
    placementMatches: 5,
    divisions: DEFAULT_DIVISIONS,
  },
  tracks: OFFICIAL_TRACKS,
  /** Same track for the whole match (Trackmania ranked) or a new one every round. */
  trackPerRound: false,
  /**
   * Opt-in proxy for PolyTrack's official backend so a self-hosted game copy keeps leaderboards and
   * the game's own invite-code multiplayer (see server/src/kodubproxy.js). Build the copy with
   * POLYRANKED_KODUB_PROXY=https://<this server>/kodub to use it.
   */
  kodubProxy: {
    enabled: false,
    path: "/kodub",
    upstream: "https://vps.kodub.com",
    /** Origin header sent upstream; the default is the one PolyModLoader's desktop app uses. */
    origin: "https://app-polytrack-desktop.polymodloader.com",
  },
};

export function deepMerge(base, override) {
  if (Array.isArray(base) || Array.isArray(override)) return override === undefined ? base : override;
  if (typeof base !== "object" || base === null) return override === undefined ? base : override;
  const out = { ...base };
  for (const [k, v] of Object.entries(override ?? {})) {
    out[k] = typeof v === "object" && v !== null && !Array.isArray(v) && typeof base[k] === "object" && base[k] !== null
      ? deepMerge(base[k], v)
      : v;
  }
  return out;
}

/**
 * Load config from (in order of precedence) CLI flags, environment and a JSON file.
 * @param {string[]} argv
 */
export function loadConfig(argv = process.argv.slice(2), env = process.env) {
  let configPath = env.POLYRANKED_CONFIG ?? null;
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--config") configPath = argv[++i];
    else if (a === "--port") flags.port = Number(argv[++i]);
    else if (a === "--host") flags.host = argv[++i];
    else if (a === "--data-dir") flags.dataDir = argv[++i];
    else if (a === "--serve-mod") flags.serveModFrom = argv[++i];
  }
  let fileCfg = {};
  if (configPath) {
    fileCfg = JSON.parse(fs.readFileSync(path.resolve(configPath), "utf8"));
  } else if (fs.existsSync(path.resolve("config.json"))) {
    fileCfg = JSON.parse(fs.readFileSync(path.resolve("config.json"), "utf8"));
  }
  let cfg = deepMerge(DEFAULT_CONFIG, fileCfg);
  if (env.PORT) cfg.port = Number(env.PORT);
  if (env.HOST) cfg.host = env.HOST;
  if (env.POLYRANKED_DATA_DIR) cfg.dataDir = env.POLYRANKED_DATA_DIR;
  cfg = deepMerge(cfg, flags);
  // Divisions given as JSON cannot express -Infinity; treat a missing/ null min as -Infinity.
  cfg.rating.divisions = cfg.rating.divisions.map((d) => ({ ...d, min: d.min == null ? -Infinity : d.min }));
  return cfg;
}
