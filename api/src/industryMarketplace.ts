import { pool } from './db.js';

export type MarketplaceProjectKind = 'PROJECT' | 'SCRIPT' | 'IP' | 'TALENT';
export type MarketplaceProjectFormat = 'VERTICAL_SERIES' | 'SHORT_FILM' | 'FEATURE_FILM' | 'OTHER';
export type MarketplaceProjectStage = 'IDEA' | 'SCRIPT' | 'DEVELOPMENT' | 'PRODUCTION' | 'POST_PRODUCTION';

export interface IndustryProfileInput {
  organization: string;
  industryRole: string;
  bio: string;
  region: string;
}

export interface MarketplaceProjectInput {
  title: string;
  summary: string;
  kind: MarketplaceProjectKind;
  format: MarketplaceProjectFormat;
  category: string;
  stage: MarketplaceProjectStage;
  seeking: string[];
  regions: string[];
  subtitleLanguages: string[];
  dubbingLanguages: string[];
  investmentTarget: number | null;
}

export async function getIndustryProfile(userId: string) {
  const { rows } = await pool.query(`
    SELECT user_id AS id, organization, industry_role AS "industryRole", bio, region
    FROM industry_profiles WHERE user_id = $1
  `, [userId]);
  return rows[0] ?? null;
}

export async function saveIndustryProfile(userId: string, input: IndustryProfileInput) {
  const { rows } = await pool.query(`
    INSERT INTO industry_profiles (user_id, organization, industry_role, bio, region)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (user_id) DO UPDATE SET
      organization = EXCLUDED.organization,
      industry_role = EXCLUDED.industry_role,
      bio = EXCLUDED.bio,
      region = EXCLUDED.region,
      updated_at = now()
    RETURNING "user_id" AS id, organization, industry_role AS "industryRole", bio, region
  `, [userId, input.organization, input.industryRole, input.bio, input.region]);
  return rows[0];
}

export async function listIndustryPeople(userId: string) {
  const { rows } = await pool.query(`
    SELECT u.id, u.name, ip.organization, ip.industry_role AS "industryRole",
      ip.bio, ip.region,
      ARRAY(SELECT role FROM user_roles WHERE user_id = u.id) AS roles,
      connection.id AS "connectionId",
      connection.status AS "connectionStatus",
      CASE WHEN connection.requester_id = $1 THEN 'OUTGOING' ELSE 'INCOMING' END AS "connectionDirection"
    FROM industry_profiles ip
    JOIN users u ON u.id = ip.user_id
    LEFT JOIN LATERAL (
      SELECT id, requester_id, status
      FROM industry_connections c
      WHERE c.status <> 'CANCELLED'
        AND ((c.requester_id = $1 AND c.recipient_id = u.id)
          OR (c.requester_id = u.id AND c.recipient_id = $1))
      LIMIT 1
    ) connection ON TRUE
    WHERE u.id <> $1 AND u.status = 'ACTIVE'
    ORDER BY ip.updated_at DESC, u.name ASC
    LIMIT 100
  `, [userId]);
  return rows;
}

export async function listIndustryConnections(userId: string) {
  const { rows } = await pool.query(`
    SELECT c.id, c.requester_id AS "requesterId", c.recipient_id AS "recipientId",
      c.message, c.status, c.created_at AS "createdAt",
      CASE WHEN c.requester_id = $1 THEN recipient.name ELSE requester.name END AS "peerName",
      CASE WHEN c.requester_id = $1 THEN recipient.id ELSE requester.id END AS "peerId",
      CASE WHEN c.requester_id = $1 THEN recipient_profile.organization ELSE requester_profile.organization END AS organization,
      CASE WHEN c.requester_id = $1 THEN recipient_profile.industry_role ELSE requester_profile.industry_role END AS "industryRole"
    FROM industry_connections c
    JOIN users requester ON requester.id = c.requester_id
    JOIN users recipient ON recipient.id = c.recipient_id
    LEFT JOIN industry_profiles requester_profile ON requester_profile.user_id = requester.id
    LEFT JOIN industry_profiles recipient_profile ON recipient_profile.user_id = recipient.id
    WHERE c.requester_id = $1 OR c.recipient_id = $1
    ORDER BY CASE c.status WHEN 'PENDING' THEN 0 ELSE 1 END, c.created_at DESC
    LIMIT 200
  `, [userId]);
  return rows;
}

export async function createIndustryConnection(userId: string, recipientId: string, message: string) {
  const { rows } = await pool.query(`
    INSERT INTO industry_connections (requester_id, recipient_id, message)
    SELECT $1, u.id, $3 FROM users u
    WHERE u.id = $2 AND u.id <> $1 AND u.status = 'ACTIVE'
      AND EXISTS (SELECT 1 FROM industry_profiles WHERE user_id = u.id)
      AND NOT EXISTS (
        SELECT 1 FROM industry_connections c
        WHERE c.status <> 'CANCELLED'
          AND LEAST(c.requester_id, c.recipient_id) = LEAST($1::uuid, $2::uuid)
          AND GREATEST(c.requester_id, c.recipient_id) = GREATEST($1::uuid, $2::uuid)
      )
    RETURNING id, requester_id AS "requesterId", recipient_id AS "recipientId", message, status, created_at AS "createdAt"
  `, [userId, recipientId, message]);
  return rows[0] ?? null;
}

export async function respondToIndustryConnection(userId: string, connectionId: string, status: 'ACCEPTED' | 'DECLINED') {
  const { rows } = await pool.query(`
    UPDATE industry_connections SET status = $1, updated_at = now()
    WHERE id = $2 AND recipient_id = $3 AND status = 'PENDING'
    RETURNING id, requester_id AS "requesterId", recipient_id AS "recipientId", message, status, created_at AS "createdAt"
  `, [status, connectionId, userId]);
  return rows[0] ?? null;
}

export async function listMarketplaceProjects(userId: string, view: 'DISCOVER' | 'MINE' | 'INVEST') {
  const visibility = view === 'MINE'
    ? 'p.creator_id = $1'
    : view === 'INVEST'
      ? "p.status = 'APPROVED' AND p.investment_target IS NOT NULL"
      : "p.status = 'APPROVED'";
  const { rows } = await pool.query(`
    SELECT p.id, p.creator_id AS "creatorId", p.title, p.summary, p.kind, p.format,
      p.category, p.stage, p.seeking, p.regions,
      p.subtitle_languages AS "subtitleLanguages",
      p.dubbing_languages AS "dubbingLanguages",
      p.investment_target AS "investmentTarget", p.status,
      p.created_at AS "createdAt", u.name AS "creatorName",
      COALESCE(ip.organization, '') AS organization,
      EXISTS (SELECT 1 FROM marketplace_interests mi WHERE mi.project_id = p.id AND mi.investor_id = $1) AS "hasExpressedInterest",
      (SELECT COUNT(*)::int FROM marketplace_interests mi WHERE mi.project_id = p.id) AS "interestCount"
    FROM marketplace_projects p
    JOIN users u ON u.id = p.creator_id
    LEFT JOIN industry_profiles ip ON ip.user_id = p.creator_id
    WHERE ${visibility}
    ORDER BY p.created_at DESC
    LIMIT 100
  `, [userId]);
  return rows;
}

export async function createMarketplaceProject(userId: string, input: MarketplaceProjectInput) {
  const { rows } = await pool.query(`
    INSERT INTO marketplace_projects (
      creator_id, title, summary, kind, format, category, stage, seeking,
      regions, subtitle_languages, dubbing_languages, investment_target
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING id, creator_id AS "creatorId", title, summary, kind, format,
      category, stage, seeking, regions,
      subtitle_languages AS "subtitleLanguages",
      dubbing_languages AS "dubbingLanguages",
      investment_target AS "investmentTarget", status, created_at AS "createdAt"
  `, [
    userId, input.title, input.summary, input.kind, input.format, input.category,
    input.stage, input.seeking, input.regions, input.subtitleLanguages,
    input.dubbingLanguages, input.investmentTarget,
  ]);
  return rows[0];
}

export async function listMarketplaceInterests(userId: string) {
  const { rows } = await pool.query(`
    SELECT mi.id, mi.project_id AS "projectId", p.title AS "projectTitle",
      p.creator_id AS "creatorId", p.investment_target AS "investmentTarget",
      mi.investor_id AS "investorId", investor.name AS "investorName",
      mi.amount, mi.message, mi.status, mi.created_at AS "createdAt",
      (p.creator_id = $1) AS "isOwner"
    FROM marketplace_interests mi
    JOIN marketplace_projects p ON p.id = mi.project_id
    JOIN users investor ON investor.id = mi.investor_id
    WHERE p.creator_id = $1 OR mi.investor_id = $1
    ORDER BY mi.created_at DESC
    LIMIT 200
  `, [userId]);
  return rows;
}

export async function createMarketplaceInterest(
  userId: string,
  projectId: string,
  amount: number | null,
  message: string,
) {
  const { rows } = await pool.query(`
    INSERT INTO marketplace_interests (project_id, investor_id, amount, message)
    SELECT p.id, $2, $3, $4
    FROM marketplace_projects p
    WHERE p.id = $1 AND p.status = 'APPROVED' AND p.creator_id <> $2
    ON CONFLICT (project_id, investor_id) DO NOTHING
    RETURNING id, project_id AS "projectId", investor_id AS "investorId",
      amount, message, status, created_at AS "createdAt"
  `, [projectId, userId, amount, message]);
  return rows[0] ?? null;
}

export async function updateMarketplaceInterest(
  userId: string,
  interestId: string,
  status: 'ACKNOWLEDGED' | 'DECLINED',
) {
  const { rows } = await pool.query(`
    UPDATE marketplace_interests mi SET status = $1, updated_at = now()
    FROM marketplace_projects p
    WHERE mi.id = $2 AND p.id = mi.project_id AND p.creator_id = $3 AND mi.status = 'PENDING'
    RETURNING mi.id, mi.project_id AS "projectId", mi.status
  `, [status, interestId, userId]);
  return rows[0] ?? null;
}
