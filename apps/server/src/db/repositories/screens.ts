import type { PlaylistItem, Screen } from '@chicolven/shared/types';
import { withBooleans, type DB } from '../index.ts';

export type ScreenInput = Omit<Screen, 'id'>;
export type PlaylistItemInput = Pick<PlaylistItem, 'item_type' | 'ref_id' | 'duration_s'>;

const SCREEN_BOOLS = ['low_power', 'active'] as const;
const b = (v: boolean | undefined) => (v ? 1 : 0);

export class ScreenRepo {
  constructor(private db: DB) {}

  list(): Screen[] {
    return this.db
      .prepare('SELECT * FROM screens ORDER BY id')
      .all()
      .map((r) => withBooleans<Screen>(r, SCREEN_BOOLS));
  }

  get(id: number): Screen | null {
    const row = this.db.prepare('SELECT * FROM screens WHERE id = ?').get(id);
    return row ? withBooleans<Screen>(row, SCREEN_BOOLS) : null;
  }

  create(input: ScreenInput): Screen {
    const info = this.db
      .prepare(
        `INSERT INTO screens (name, title, layout, grid_cols, grid_rows, rotation_seconds, orientation, low_power, active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.name,
        input.title,
        input.layout,
        input.grid_cols,
        input.grid_rows,
        input.rotation_seconds,
        input.orientation,
        b(input.low_power),
        b(input.active),
      );
    return this.get(Number(info.lastInsertRowid))!;
  }

  update(id: number, input: Partial<ScreenInput>): Screen | null {
    const current = this.get(id);
    if (!current) return null;
    const n = { ...current, ...input };
    this.db
      .prepare(
        `UPDATE screens SET name = ?, title = ?, layout = ?, grid_cols = ?, grid_rows = ?, rotation_seconds = ?,
          orientation = ?, low_power = ?, active = ? WHERE id = ?`,
      )
      .run(n.name, n.title, n.layout, n.grid_cols, n.grid_rows, n.rotation_seconds, n.orientation, b(n.low_power), b(n.active), id);
    return this.get(id);
  }

  delete(id: number): boolean {
    return this.db.prepare('DELETE FROM screens WHERE id = ?').run(id).changes > 0;
  }

  playlist(screenId: number): PlaylistItem[] {
    return this.db
      .prepare('SELECT * FROM playlist_items WHERE screen_id = ? ORDER BY position, id')
      .all(screenId) as PlaylistItem[];
  }

  /** Replaces the whole playlist of a screen. */
  setPlaylist(screenId: number, items: PlaylistItemInput[]): PlaylistItem[] {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM playlist_items WHERE screen_id = ?').run(screenId);
      const stmt = this.db.prepare(
        'INSERT INTO playlist_items (screen_id, item_type, ref_id, position, duration_s) VALUES (?, ?, ?, ?, ?)',
      );
      items.forEach((item, position) => stmt.run(screenId, item.item_type, item.ref_id, position, item.duration_s));
    })();
    return this.playlist(screenId);
  }
}
