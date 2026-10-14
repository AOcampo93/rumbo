import type { ClipNames } from './character.ts';

// The AR scenes a route's place can open (route-spec AR_SCENES): one guide who waits to be
// asked, or an encounter where several characters act a loop until the visitor talks to one.

export type SceneLang = 'es' | 'en' | 'pt';

export interface ActorDef {
  /** The API's character id: his voice and knowledge. */
  id: string;
  /** How the page names him ("Hablar con …"). */
  name: Record<SceneLang, string>;
  model: string;
  clips: ClipNames;
  /** Meshes the scene never shows (e.g. a bow the model carries for other clips). */
  hidden?: readonly string[];
  /** The sword's mesh: only out while fighting, drawing or sheathing. */
  sword?: string;
  /** Feet on the floor, in metres from the scene's centre (x to the right, z towards the viewer). */
  x: number;
  z: number;
}

export interface SceneDef {
  id: string;
  /**
   * `guide`: one character, idle until asked. `encounter`: the characters fight in a loop;
   * walking up to one offers to talk to him, and both stop while he answers.
   */
  kind: 'guide' | 'encounter';
  actors: readonly ActorDef[];
}

const SOLDIER_CLIPS = {
  talking: 'Hablando',
  fight: 'Luchando',
  draw: 'Desenvainar',
  sheathe: 'Envainar',
} as const;

export const SCENES: Record<string, SceneDef> = {
  artesano: {
    id: 'artesano',
    kind: 'guide',
    actors: [
      {
        id: 'artesano',
        name: { es: 'el artesano', en: 'the craftsman', pt: 'o artesão' },
        model: '/ra_test/models/artesano.glb',
        clips: { idle: 'Idle_BocaCerrada', talking: 'Hablando' },
        x: 0,
        z: 0,
      },
    ],
  },
  asalto_1140: {
    id: 'asalto_1140',
    kind: 'encounter',
    actors: [
      {
        id: 'soldado_portugues',
        name: {
          es: 'el soldado portugués',
          en: 'the Portuguese soldier',
          pt: 'o soldado português',
        },
        model: '/ra_test/models/soldado_portugues.glb',
        clips: { idle: 'Idle_BocaCerrada', ...SOLDIER_CLIPS },
        hidden: ['Arco'],
        sword: 'Espada',
        x: -0.6,
        z: 0,
      },
      {
        id: 'soldado_almoravide',
        name: {
          es: 'el guerrero almorávide',
          en: 'the Almoravid warrior',
          pt: 'o guerreiro almorávida',
        },
        model: '/ra_test/models/soldado_almoravide.glb',
        clips: { idle: 'Idle', ...SOLDIER_CLIPS },
        hidden: ['Arco'],
        sword: 'Cimitarra',
        x: 0.6,
        z: 0,
      },
    ],
  },
};

export const DEFAULT_SCENE = 'artesano';

/** Whether the sword is out in a state: put away while waiting or talking. */
export function swordOut(state: string): boolean {
  return state !== 'idle' && state !== 'talking';
}

/** The scene a link asks for (?scene=, or the first version's ?character=artesano). */
export function sceneFromParams(params: URLSearchParams): SceneDef {
  const id = params.get('scene') ?? params.get('character') ?? DEFAULT_SCENE;
  return SCENES[id] ?? (SCENES[DEFAULT_SCENE] as SceneDef);
}
