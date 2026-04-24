/**
 * КУДРИ · работа с таблицей profiles.
 * Профиль 1-к-1 с users. Ключ — user_id (он же PRIMARY KEY).
 * PUT имеет PATCH-семантику: поля, отсутствующие в теле, не затрагиваются.
 * На вход принимаются оба формата ключей: snake_case (curl_type) и camelCase (curlType).
 * На выход всегда camelCase.
 */

const { db } = require('./db');

const CURL_TYPES  = ['2A','2B','2C','3A','3B','3C','4'];
const POROSITIES  = ['low','medium','high','unknown'];
const THICKNESSES = ['thin','medium','thick'];
const SCALPS      = ['oily','normal','dry','sensitive','mixed'];
const GOALS       = ['hydration','nutrition','growth','volume','definition','frizz','shine','repair','color','scalp'];
const COLOR_STATE_MAX = 500;

const selectByUser = db.prepare(`SELECT * FROM profiles WHERE user_id = ?`);

const upsertStmt = db.prepare(`
  INSERT INTO profiles (user_id, curl_type, porosity, thickness, scalp, color_state, goals, updated_at)
  VALUES (@user_id, @curl_type, @porosity, @thickness, @scalp, @color_state, @goals,
          strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  ON CONFLICT(user_id) DO UPDATE SET
    curl_type   = excluded.curl_type,
    porosity    = excluded.porosity,
    thickness   = excluded.thickness,
    scalp       = excluded.scalp,
    color_state = excluded.color_state,
    goals       = excluded.goals,
    updated_at  = strftime('%Y-%m-%dT%H:%M:%fZ','now')
`);

/**
 * Возвращает профиль пользователя или null если его нет.
 */
function getProfileByUserId(userId) {
  const row = selectByUser.get(userId);
  if (!row) return null;
  return deserialize(row);
}

/**
 * Валидирует input, мерджит с существующим профилем (PATCH-семантика), пишет в БД.
 * @returns { profile } при успехе; { error, field? } при провале валидации.
 */
function upsertProfile(userId, input) {
  const v = validate(input);
  if (v.error) return v;

  const existing = selectByUser.get(userId);
  const pick = (key) => (key in v.data) ? v.data[key] : (existing ? existing[key] : null);

  upsertStmt.run({
    user_id:     userId,
    curl_type:   pick('curl_type'),
    porosity:    pick('porosity'),
    thickness:   pick('thickness'),
    scalp:       pick('scalp'),
    color_state: pick('color_state'),
    goals:       ('goals' in v.data)
                   ? (v.data.goals === null ? null : JSON.stringify(v.data.goals))
                   : (existing ? existing.goals : null)
  });

  return { profile: deserialize(selectByUser.get(userId)) };
}

/**
 * Нормализует ключи (camelCase → snake_case), валидирует значения.
 * Возвращает { data } — объект только с теми полями, что присутствовали в input
 * (для PATCH-семантики отсутствие ключа != null).
 * При невалидном значении — { error, field }.
 */
function validate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { error: 'bad_body' };
  }

  // Нормализация ключей. snake_case имеет приоритет, camelCase — fallback.
  const n = {};
  if      ('curl_type'   in input) n.curl_type   = input.curl_type;
  else if ('curlType'    in input) n.curl_type   = input.curlType;
  if      ('porosity'    in input) n.porosity    = input.porosity;
  if      ('thickness'   in input) n.thickness   = input.thickness;
  if      ('scalp'       in input) n.scalp       = input.scalp;
  if      ('color_state' in input) n.color_state = input.color_state;
  else if ('colorState'  in input) n.color_state = input.colorState;
  if      ('goals'       in input) n.goals       = input.goals;

  // Пустое тело или объект без распознанных полей — bad_body (нет смысла в PUT без данных)
  if (Object.keys(n).length === 0) {
    return { error: 'bad_body' };
  }

  const data = {};

  if ('curl_type' in n) {
    if (n.curl_type !== null && !CURL_TYPES.includes(n.curl_type)) {
      return { error: 'bad_value', field: 'curl_type' };
    }
    data.curl_type = n.curl_type;
  }
  if ('porosity' in n) {
    if (n.porosity !== null && !POROSITIES.includes(n.porosity)) {
      return { error: 'bad_value', field: 'porosity' };
    }
    data.porosity = n.porosity;
  }
  if ('thickness' in n) {
    if (n.thickness !== null && !THICKNESSES.includes(n.thickness)) {
      return { error: 'bad_value', field: 'thickness' };
    }
    data.thickness = n.thickness;
  }
  if ('scalp' in n) {
    if (n.scalp !== null && !SCALPS.includes(n.scalp)) {
      return { error: 'bad_value', field: 'scalp' };
    }
    data.scalp = n.scalp;
  }
  if ('color_state' in n) {
    if (n.color_state !== null) {
      if (typeof n.color_state !== 'string') {
        return { error: 'bad_value', field: 'color_state' };
      }
      if (n.color_state.length > COLOR_STATE_MAX) {
        return { error: 'too_long', field: 'color_state' };
      }
    }
    data.color_state = n.color_state;
  }
  if ('goals' in n) {
    if (n.goals !== null) {
      if (!Array.isArray(n.goals)) {
        return { error: 'bad_value', field: 'goals' };
      }
      for (const g of n.goals) {
        if (!GOALS.includes(g)) {
          return { error: 'bad_value', field: 'goals' };
        }
      }
    }
    data.goals = n.goals;
  }

  return { data };
}

/**
 * DB-row → API-формат (camelCase, goals как массив).
 */
function deserialize(row) {
  return {
    userId:     row.user_id,
    curlType:   row.curl_type,
    porosity:   row.porosity,
    thickness:  row.thickness,
    scalp:      row.scalp,
    colorState: row.color_state,
    goals:      row.goals ? JSON.parse(row.goals) : [],
    updatedAt:  row.updated_at
  };
}

module.exports = { getProfileByUserId, upsertProfile };
