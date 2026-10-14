import {
  AmbientLight,
  CanvasTexture,
  CircleGeometry,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  RingGeometry,
  Scene,
  Vector3,
  WebGLRenderer,
  MeshBasicMaterial,
  type Object3D,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// The stage: a WebGL renderer that runs either a WebXR immersive-ar session (floor reticle,
// tap to place) or, where AR isn't available, a plain 3D view with orbit controls.

export type StageMode = 'fallback' | 'ar';

export async function isArSupported(): Promise<boolean> {
  try {
    return (await navigator.xr?.isSessionSupported('immersive-ar')) === true;
  } catch {
    return false;
  }
}

/** How far in front of the user the character appears when no floor point is known (metres). */
export const PLACE_DISTANCE = 1.5;

/** Width of the soft contact shadow under the character (metres). */
export const CONTACT_SHADOW_SIZE = 0.9;

/** Y rotation that makes something at `from` face `to` (the model faces +Z). */
export function facingAngle(from: { x: number; z: number }, to: { x: number; z: number }): number {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

export interface StageOptions {
  canvas: HTMLCanvasElement;
  /** DOM overlay root for the AR session. */
  overlay: HTMLElement;
  /** Called every frame with the elapsed seconds. */
  onFrame: (dt: number) => void;
  onModeChange?: (mode: StageMode) => void;
  onPlaced?: () => void;
}

export class Stage {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(50, 1, 0.05, 50);
  /** The characters and their shadows live here; AR placement moves this group. */
  readonly anchor = new Group();
  mode: StageMode = 'fallback';
  fps = 0;

  private readonly controls: OrbitControls;
  private readonly floor: Mesh;
  private readonly reticle: Mesh;
  /** One group per character (the model and its shadow), turned by `turnActor`. */
  private readonly actors: Group[] = [];
  private session: XRSession | null = null;
  private hitSource: XRHitTestSource | null = null;
  private refSpace: XRReferenceSpace | null = null;
  private reticleVisible = false;
  /** In AR, once the character stands somewhere the reticle hides (a tap still moves him). */
  private placed = false;
  private lastTime = 0;
  private fpsFrames = 0;
  private fpsStart = 0;
  private readonly background = new Color(0xe9e4da);
  /** How far back the 3D view's camera stands (1 frames one character). */
  private viewScale = 1;

  constructor(private readonly options: StageOptions) {
    const renderer = new WebGLRenderer({ canvas: options.canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // No shadow maps: a fixed contact shadow is far cheaper on phones and never flickers.
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType('local-floor');
    renderer.setClearColor(0x000000, 0);
    this.renderer = renderer;

    this.scene.add(new HemisphereLight(0xffffff, 0x8a8478, 1.6), new AmbientLight(0xffffff, 0.4));
    const sun = new DirectionalLight(0xffffff, 2.2);
    sun.position.set(0.8, 3, 1.2);
    this.anchor.add(sun, sun.target);

    // Neutral floor for the 3D view (hidden in AR) and a soft contact shadow for both.
    this.floor = new Mesh(
      new CircleGeometry(2.2, 48),
      new MeshStandardMaterial({ color: 0xd8d2c6, roughness: 1 }),
    );
    this.floor.rotation.x = -Math.PI / 2;
    this.anchor.add(this.floor);
    this.scene.add(this.anchor);

    this.reticle = new Mesh(
      new RingGeometry(0.12, 0.16, 32).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({ color: 0xffffff }),
    );
    this.reticle.matrixAutoUpdate = false;
    this.reticle.visible = false;
    this.scene.add(this.reticle);

    this.controls = new OrbitControls(this.camera, options.canvas);
    this.controls.target.set(0, 0.6, 0);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.minDistance = 1;
    this.controls.maxDistance = 6;

    window.addEventListener('resize', () => this.resize());
    this.enterFallback();
    renderer.setAnimationLoop((time, frame) => this.render(time, frame));
  }

  /** Put a character on the stage, his feet (y = 0) at (x, z) from its centre. */
  addActor(object: Object3D, x = 0, z = 0): Group {
    const group = new Group();
    group.position.set(x, 0, z);
    group.add(object, contactShadow());
    group.visible = this.mode !== 'ar' || this.placed;
    this.actors.push(group);
    this.anchor.add(group);
    return group;
  }

  /**
   * Turns a character a step towards a point of the stage (anchor space), at most
   * `maxStep` radians, so he turns round instead of snapping.
   */
  turnActor(actor: Group, towards: { x: number; z: number }, maxStep: number): void {
    const target = facingAngle(actor.position, towards);
    const delta = Math.atan2(
      Math.sin(target - actor.rotation.y),
      Math.cos(target - actor.rotation.y),
    );
    actor.rotation.y += Math.max(-maxStep, Math.min(maxStep, delta));
  }

  /** Frames a wider scene in the 3D view (e.g. 1.3 for two characters side by side). */
  setViewScale(scale: number): void {
    this.viewScale = scale;
    if (this.mode === 'fallback') this.enterFallback();
  }

  /** Where the viewer (the phone, or the 3D view's camera) is, in the stage's own space. */
  viewerOnStage(target = new Vector3()): Vector3 {
    const camera = this.mode === 'ar' ? this.renderer.xr.getCamera() : this.camera;
    target.setFromMatrixPosition(camera.matrixWorld);
    return this.anchor.worldToLocal(target);
  }

  resize(): void {
    const { clientWidth: w, clientHeight: h } = this.options.canvas;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  async startAr(): Promise<void> {
    if (this.session) return;
    const session = await navigator.xr!.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay', 'local-floor'],
      domOverlay: { root: this.options.overlay },
    });
    this.session = session;
    session.addEventListener('end', () => this.onSessionEnd());
    session.addEventListener('select', () => this.place());
    await this.renderer.xr.setSession(session);
    this.refSpace = this.renderer.xr.getReferenceSpace() as XRReferenceSpace | null;
    const viewer = await session.requestReferenceSpace('viewer');
    this.hitSource = (await session.requestHitTestSource?.({ space: viewer })) ?? null;

    this.mode = 'ar';
    this.placed = false;
    this.controls.enabled = false;
    this.scene.background = null;
    this.floor.visible = false;
    // Until the user taps, nobody is there.
    for (const actor of this.actors) actor.visible = false;
    this.options.onModeChange?.('ar');
  }

  async endAr(): Promise<void> {
    await this.session?.end();
  }

  /** Floor point under the reticle if there is one, else 1.5 m ahead of the camera. */
  place(): void {
    if (this.mode !== 'ar') return;
    const camera = this.renderer.xr.getCamera();
    const cameraPos = new Vector3().setFromMatrixPosition(camera.matrixWorld);
    const target = new Vector3();
    if (this.reticleVisible) {
      target.setFromMatrixPosition(this.reticle.matrix);
    } else {
      const forward = new Vector3(0, 0, -1).transformDirection(camera.matrixWorld);
      forward.y = 0;
      if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
      target.copy(cameraPos).addScaledVector(forward.normalize(), PLACE_DISTANCE);
      target.y = 0;
    }
    this.anchor.position.copy(target);
    this.anchor.rotation.y = facingAngle(target, cameraPos);
    this.placed = true;
    this.reticle.visible = false;
    for (const actor of this.actors) actor.visible = true;
    this.options.onPlaced?.();
  }

  private onSessionEnd(): void {
    this.hitSource?.cancel();
    this.hitSource = null;
    this.session = null;
    this.refSpace = null;
    this.reticle.visible = false;
    this.reticleVisible = false;
    this.enterFallback();
    this.options.onModeChange?.('fallback');
  }

  private enterFallback(): void {
    this.mode = 'fallback';
    this.scene.background = this.background;
    this.floor.visible = true;
    this.anchor.position.set(0, 0, 0);
    this.anchor.rotation.set(0, 0, 0);
    for (const actor of this.actors) actor.visible = true;
    this.camera.position.set(0.8, 1.2, 3.7).multiplyScalar(this.viewScale);
    this.controls.enabled = true;
    this.controls.update();
    this.resize();
  }

  private render(time: number, frame?: XRFrame): void {
    const dt = this.lastTime ? Math.min((time - this.lastTime) / 1000, 0.1) : 0;
    this.lastTime = time;
    this.fpsFrames++;
    if (time - this.fpsStart >= 1000) {
      this.fps = Math.round((this.fpsFrames * 1000) / (time - this.fpsStart));
      this.fpsFrames = 0;
      this.fpsStart = time;
    }
    this.options.onFrame(dt);

    if (frame && this.hitSource && this.refSpace) {
      const hit = frame.getHitTestResults(this.hitSource)[0];
      const pose = hit?.getPose(this.refSpace);
      this.reticleVisible = !!pose;
      this.reticle.visible = !!pose && !this.placed;
      if (pose) this.reticle.matrix.fromArray(pose.transform.matrix);
    }
    if (this.mode === 'fallback') this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}

/**
 * A soft dark ellipse under the feet, from a radial gradient. Drawn after the floor without
 * writing depth, so it never fights with it (or with the real floor in AR).
 */
function contactShadow(): Mesh {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(0,0,0,0.55)');
    g.addColorStop(0.45, 'rgba(0,0,0,0.3)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const shadow = new Mesh(
    new PlaneGeometry(CONTACT_SHADOW_SIZE, CONTACT_SHADOW_SIZE * 0.75),
    new MeshBasicMaterial({ map: new CanvasTexture(canvas), transparent: true, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.003;
  shadow.renderOrder = 1;
  return shadow;
}
