/*
 * Cool Cars 1.0.5 – PolyTrack 0.6.3 port of CRJakob's Cool Cars 1.0.4
 * (https://github.com/CRJakob/jakobspolymods, coolcars/1.0.4, written for PolyTrack 0.5.1).
 * Registers its car models with Car Switcher; the models live in <version>/assets/.
 */
import { PolyMod } from "https://cdn.polymodloader.com/cb/PolyTrackMods/PolyModLoader/0.6.3/PolyTypes.js";

const ENGINE = "audio/engine.mp3";
const CARS = [
  { name: "Audi R8", file: "audir8.glb" },
  { name: "Countach", file: "countach.glb" },
  { name: "Koenigsegg", file: "koenigsegg.glb" },
  { name: "SVJ", file: "svj.glb" },
  { name: "Mclaren F1 GT", file: "mclaren.glb" },
  { name: "Nissan Skyline GTR", file: "nissan.glb" },
  { name: "AE86", file: "driftcar.glb" },
  { name: "Cybertruck", file: "cybertruck.glb" },
  { name: "Mclaren F1", file: "mclarenmp4_5.glb" },
];

class CoolCarsMod extends PolyMod {
  constructor() {
    super();
    this.init = (pml) => {
      const switcher = pml.getMod("carswitcher");
      if (!switcher || !Array.isArray(switcher.carModels)) throw new Error("Cool Cars needs the Car Switcher mod");
      const assets = `${this.modBaseUrl}/${this.modVersion}/assets`;
      switcher.carModels.push(...CARS.map((car) => ({ name: car.name, url: `${assets}/${car.file}`, sound: car.sound ?? ENGINE })));
    };
  }
}

export const polyMod = new CoolCarsMod();
