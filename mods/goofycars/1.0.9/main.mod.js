/*
 * Goofy Cars 1.0.9 – PolyTrack 0.6.3 port of CRJakob's Goofy Cars 1.0.8
 * (https://github.com/CRJakob/jakobspolymods, goofycars/1.0.8, written for PolyTrack 0.5.1).
 * Registers its car models with Car Switcher; the models live in <version>/assets/.
 */
import { PolyMod } from "https://cdn.polymodloader.com/cb/PolyTrackMods/PolyModLoader/0.6.3/PolyTypes.js";

const ENGINE = "audio/engine.mp3";
const CARS = [
  { name: "Dababy Car", file: "dababy.glb" },
  { name: "Hitbox Car", file: "hitbox.glb" },
  { name: "Octane", file: "octane.glb" },
  { name: "Wireframe", file: "wireframe.glb" },
  { name: "Lego F1 Car", file: "legocar.glb" },
  { name: "Checkpoint", file: "checkpoint.glb" },
  { name: "Golf Cart", file: "golfcart.glb" },
  { name: "Minecart", file: "minecart.glb", sound: "minecart.flac" },
];

class GoofyCarsMod extends PolyMod {
  constructor() {
    super();
    this.init = (pml) => {
      const switcher = pml.getMod("carswitcher");
      if (!switcher || !Array.isArray(switcher.carModels)) throw new Error("Goofy Cars needs the Car Switcher mod");
      const assets = `${this.modBaseUrl}/${this.modVersion}/assets`;
      switcher.carModels.push(...CARS.map((car) => ({ name: car.name, url: `${assets}/${car.file}`, sound: car.sound ? `${assets}/${car.sound}` : ENGINE })));
    };
  }
}

export const polyMod = new GoofyCarsMod();
