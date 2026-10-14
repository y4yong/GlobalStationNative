import { pool } from './db.js';
import { deleteStoredMediaReferences } from './mediaStorage.js';

function notFound() {
  return Object.assign(new Error('Content not found.'), { statusCode: 404 });
}

export async function setContentArchived(id: string, archived: boolean, creatorId?: string, adminId?: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const values: unknown[] = [archived, id];
    const ownerClause = creatorId ? 'AND created_by = $3' : '';
    if (creatorId) values.push(creatorId);
    const result = await client.query<{ id: string; is_archived: boolean }>(
      `UPDATE content SET is_archived = $1, updated_at = now() WHERE id = $2 ${ownerClause} RETURNING id, is_archived`,
      values,
    );
    if (!result.rows[0]) throw notFound();
    if (adminId) {
      await client.query(
        'INSERT INTO admin_audit_logs (admin_user_id, action, entity_type, entity_id, metadata) VALUES ($1, $2, $3, $4, $5)',
        [adminId, archived ? 'CONTENT_ARCHIVED' : 'CONTENT_RESTORED', 'CONTENT', id, { archived }],
      );
    }
    await client.query('COMMIT');
    return { id, isArchived: result.rows[0].is_archived };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteContentPermanently(id: string, creatorId?: string, adminId?: string) {
  const client = await pool.connect();
  let mediaReferences: string[] = [];
  try {
    await client.query('BEGIN');
    const contentResult = await client.query<{ created_by: string | null; poster_url: string; poster_horizontal_url: string | null }>(
      'SELECT created_by, poster_url, poster_horizontal_url FROM content WHERE id = $1 FOR UPDATE',
      [id],
    );
    const content = contentResult.rows[0];
    if (!content || (creatorId && content.created_by !== creatorId)) throw notFound();
    const episodeResult = await client.query<{ hls_manifest_url: string }>(
      'SELECT hls_manifest_url FROM episodes WHERE content_id = $1',
      [id],
    );
    mediaReferences = [content.poster_url, content.poster_horizontal_url, ...episodeResult.rows.map(episode => episode.hls_manifest_url)].filter((reference): reference is string => Boolean(reference));
    await client.query('DELETE FROM content WHERE id = $1', [id]);
    if (adminId) {
      await client.query(
        'INSERT INTO admin_audit_logs (admin_user_id, action, entity_type, entity_id, metadata) VALUES ($1, $2, $3, $4, $5)',
        [adminId, 'CONTENT_DELETED', 'CONTENT', id, { mediaCount: mediaReferences.length }],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  try {
    await deleteStoredMediaReferences(mediaReferences);
  } catch (error) {
    console.error('Content was deleted but some uploaded media could not be removed.', error);
  }
  return { id, deleted: true };
}