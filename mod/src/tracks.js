import { log } from "./util.js";

let registryCache = null;
let trackDataClass = null;

/** Collect the game's official + community tracks: id -> {name, loadCallback}. */
export function registryTracks(bridge) {
  if (registryCache) return registryCache;
  const map = new Map();
  const add = (category) => (id, group, trackMetadata, environment, loadCallback) => {
    map.set(id, { id, name: trackMetadata?.name ?? id, category, loadCallback });
  };
  try {
    bridge.trackRegistry.forEachOfficialTrack(add("official"));
    bridge.trackRegistry.forEachCommunityTrack(add("community"));
  } catch (err) {
    log.warn("could not enumerate the track registry", err);
  }
  registryCache = map;
  return map;
}

/** The game's track-data class (has the static `fromExportString`). Learned from any loaded track. */
export async function getTrackDataClass(bridge, game) {
  if (trackDataClass) return trackDataClass;
  if (game?.TrackCodec?.fromExportString) {
    trackDataClass = game.TrackCodec;
    return trackDataClass;
  }
  const first = registryTracks(bridge).values().next().value;
  if (first) {
    const loaded = await first.loadCallback();
    trackDataClass = loaded.trackData.constructor;
  }
  return trackDataClass;
}

/**
 * Resolve a server track description into `{trackMetadata, trackData}`.
 * @param {object} bridge
 * @param {object} game lookupGame() result
 * @param {{id?:string, trackUrl?:string|null, trackCode?:string|null, name?:string}} info
 */
export async function resolveTrack(bridge, game, info) {
  let result = null;
  const entry = info.id ? registryTracks(bridge).get(info.id) : null;
  if (entry) {
    result = await entry.loadCallback();
  } else if (info.trackCode) {
    const TrackData = await getTrackDataClass(bridge, game);
    if (!TrackData?.fromExportString) throw new Error("track codec unavailable");
    result = TrackData.fromExportString(info.trackCode);
  } else if (info.trackUrl) {
    const TrackData = await getTrackDataClass(bridge, game);
    if (!TrackData?.fromExportString) throw new Error("track codec unavailable");
    const res = await fetch(info.trackUrl);
    if (!res.ok) throw new Error(`failed to fetch track (${res.status})`);
    result = TrackData.fromExportString(await res.text());
  }
  if (!result?.trackData || !result.trackMetadata) throw new Error(`unknown track ${info.name ?? info.id ?? ""}`);
  if (typeof result.trackData.hasStartingPoint === "function" && !result.trackData.hasStartingPoint()) {
    throw new Error("track has no starting point");
  }
  return { trackMetadata: result.trackMetadata, trackData: result.trackData };
}
