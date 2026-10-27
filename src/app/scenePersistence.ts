import type { Scene } from '../scene/types';
import { restoreScene } from './restoreScene';
import { sceneValidationError } from '../scene/validation';

export const SCENE_KEY = 'fieldlab.scene.v1';
export type SaveKind = 'saved' | 'pending' | 'off' | 'conflict' | 'corrupt' | 'unavailable' | 'invalid';
export interface SaveState { kind: SaveKind; message?: string; }
export function reconcileSaveState(current: SaveState, clean: boolean): SaveState {
  return clean && ['off', 'pending', 'invalid'].includes(current.kind) ? { kind: 'saved' } : current;
}
interface LoadedScene extends SaveState { scene?: Scene; presetId?: string | null; }
type StorageAccess = Pick<Storage, 'getItem' | 'setItem'> & Partial<Pick<Storage, 'length' | 'key' | 'removeItem'>>;

/** Compare against the exact record last read, including its revision token.
 * Per-tab drafts retain work even if simultaneous browser processes race a shared write.
 */
export class ScenePersistence {
  private baseline: string | null = null;
  private blocked: SaveState | null = null;
  private revision = 0;
  recoveryRaw: string | null = null;
  constructor(private storage: StorageAccess, private tabId: string) {}

  load(base: Scene): LoadedScene {
    try {
      this.baseline = this.storage.getItem(SCENE_KEY);
      if (this.baseline === null) { this.blocked = null; return { kind: 'saved' }; }
      this.recoveryRaw = this.baseline;
      const raw = JSON.parse(this.baseline);
      const scene = restoreScene(raw, base);
      if (!scene) throw new Error('Invalid saved scene');
      this.blocked = null;
      this.recoveryRaw = null;
      return { kind: 'saved', scene, presetId: typeof raw._fieldlab?.presetId === 'string' ? raw._fieldlab.presetId : null };
    } catch (error) {
      this.blocked = this.recoveryRaw !== null
        ? { kind: 'corrupt', message: 'The saved scene could not be read. Its original data is preserved. Download it before choosing to replace it.' }
        : { kind: 'unavailable', message: 'Autosave is unavailable. Export your scene before leaving this page.' };
      return this.blocked;
    }
  }

  save(scene: Scene, presetId: string | null): SaveState {
    if (this.blocked) return this.blocked;
    try {
      const encoded = JSON.stringify({ ...scene, _fieldlab: { presetId, writer: this.tabId, revision: ++this.revision, savedAt: Date.now() } });
      const draftKey = `${SCENE_KEY}.draft.${this.tabId}`;
      if (this.storage.key && this.storage.removeItem) {
        const drafts: string[] = [];
        for (let i = 0; i < (this.storage.length ?? 0); i++) {
          const key = this.storage.key(i);
          if (key?.startsWith(`${SCENE_KEY}.draft.`) && key !== draftKey) drafts.push(key);
        }
        for (const key of drafts.slice(0, Math.max(0, drafts.length - 9))) this.storage.removeItem(key);
      }
      this.storage.setItem(draftKey, encoded);
      const issue = sceneValidationError(scene);
      if (issue) return { kind: 'invalid', message: `Autosave paused: ${issue}. Correct the value or export your draft before leaving.` };
      if (this.storage.getItem(SCENE_KEY) !== this.baseline) {
        return { kind: 'conflict', message: 'Another tab saved a newer scene. Your work is retained in this tab and its recovery draft. Export it or load the newer save.' };
      }
      this.storage.setItem(SCENE_KEY, encoded);
      this.baseline = encoded;
      return { kind: 'saved' };
    } catch {
      return { kind: 'unavailable', message: 'Autosave failed. Storage may be blocked or full. Export your scene before leaving this page.' };
    }
  }

  replaceCorruptSave(): void {
    // Preserve the raw record before explicitly permitting a replacement.
    if (this.recoveryRaw !== null) this.storage.setItem(`${SCENE_KEY}.recovery.${Date.now()}`, this.recoveryRaw);
    this.blocked = null;
  }
}
