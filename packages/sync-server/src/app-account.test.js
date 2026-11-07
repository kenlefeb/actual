import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';

import {
  getAccountDb,
  getLoginMethod,
  getServerPrefs,
  getSession,
} from './account-db';
import { bootstrapPassword, checkPassword } from './accounts/password';
import { handlers as app, authRateLimiter } from './app-account';

const provider = vi.hoisted(() => ({
  discoveryFails: false,
  endSession: true,
}));

vi.mock('openid-client', async importOriginal => {
  const actual = await importOriginal();
  return {
    ...actual,
    Issuer: {
      discover: async () => {
        if (provider.discoveryFails) throw new Error('discovery down');
        return new actual.Issuer({
          issuer: 'https://identity.example',
          ...(provider.endSession && {
            end_session_endpoint: 'https://identity.example/oidc/logout',
          }),
        });
      },
    },
  };
});

const ADMIN_ROLE = 'ADMIN';
const BASIC_ROLE = 'BASIC';

// Create user helper function
const createUser = (userId, userName, role, owner = 0, enabled = 1) => {
  getAccountDb().mutate(
    'INSERT INTO users (id, user_name, display_name, enabled, owner, role) VALUES (?, ?, ?, ?, ?, ?)',
    [userId, userName, `${userName} display`, enabled, owner, role],
  );
};

const deleteUser = userId => {
  getAccountDb().mutate('DELETE FROM user_access WHERE user_id = ?', [userId]);
  getAccountDb().mutate('DELETE FROM users WHERE id = ?', [userId]);
};

const createSession = (userId, sessionToken, authMethod = null) => {
  getAccountDb().mutate(
    'INSERT INTO sessions (token, user_id, expires_at, auth_method) VALUES (?, ?, ?, ?)',
    [sessionToken, userId, Math.floor(Date.now() / 1000) + 60 * 60, authMethod], // Expire in 1 hour (stored in seconds)
  );
};

const generateSessionToken = () => `token-${uuidv4()}`;

const clearServerPrefs = () => {
  getAccountDb().mutate('DELETE FROM server_prefs');
};

const insertAuthRow = (method, active, extraData = null) => {
  getAccountDb().mutate(
    'INSERT INTO auth (method, display_name, extra_data, active) VALUES (?, ?, ?, ?)',
    [method, method, extraData, active],
  );
};

const clearAuth = () => {
  getAccountDb().mutate('DELETE FROM auth');
};

beforeEach(() => {
  authRateLimiter.resetKey('127.0.0.1');
});

describe('auth rate limiting', () => {
  it('should return 429 after exceeding the rate limit on /login', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app).post('/login').send({ password: 'wrong' });
    }

    const res = await request(app).post('/login').send({ password: 'wrong' });

    expect(res.statusCode).toEqual(429);
    expect(res.body).toEqual({
      status: 'error',
      reason: 'too-many-requests',
    });
  });

  it('should apply the same rate limit across /login and /bootstrap', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app).post('/login').send({ password: 'wrong' });
    }

    const res = await request(app)
      .post('/bootstrap')
      .send({ password: 'test' });

    expect(res.statusCode).toEqual(429);
    expect(res.body).toEqual({
      status: 'error',
      reason: 'too-many-requests',
    });
  });

  it('should not rate limit non-auth endpoints', async () => {
    for (let i = 0; i < 6; i++) {
      await request(app).post('/login').send({ password: 'wrong' });
    }

    const res = await request(app).get('/needs-bootstrap');
    expect(res.statusCode).toEqual(200);
  });
});

describe('/change-password', () => {
  let adminUserId,
    basicUserId,
    adminPasswordToken,
    adminOpenidToken,
    basicPasswordToken;

  beforeEach(() => {
    adminUserId = uuidv4();
    basicUserId = uuidv4();
    adminPasswordToken = generateSessionToken();
    adminOpenidToken = generateSessionToken();
    basicPasswordToken = generateSessionToken();
    createUser(adminUserId, 'admin', ADMIN_ROLE);
    createUser(basicUserId, 'basic', BASIC_ROLE);
    createSession(adminUserId, adminPasswordToken, 'password');
    createSession(adminUserId, adminOpenidToken, 'openid');
    createSession(basicUserId, basicPasswordToken, 'password');
  });

  afterEach(() => {
    deleteUser(adminUserId);
    deleteUser(basicUserId);
    clearAuth();
  });

  it('should return 401 if no session token is provided', async () => {
    const res = await request(app).post('/change-password').send({
      password: 'newpassword',
    });

    expect(res.statusCode).toEqual(401);
    expect(res.body).toHaveProperty('status', 'error');
    expect(res.body).toHaveProperty('reason', 'unauthorized');
  });

  it('should return 403 when user is not an admin', async () => {
    await bootstrapPassword('oldpassword');

    const res = await request(app)
      .post('/change-password')
      .set('x-actual-token', basicPasswordToken)
      .send({ password: 'newpassword', currentPassword: 'oldpassword' });

    expect(res.statusCode).toEqual(403);
    expect(res.body).toEqual({
      status: 'error',
      reason: 'forbidden',
      details: 'permission-not-found',
    });
  });

  it('should return 403 when admin session uses openid auth method', async () => {
    await bootstrapPassword('oldpassword');

    const res = await request(app)
      .post('/change-password')
      .set('x-actual-token', adminOpenidToken)
      .send({ password: 'newpassword', currentPassword: 'oldpassword' });

    expect(res.statusCode).toEqual(403);
    expect(res.body).toEqual({
      status: 'error',
      reason: 'forbidden',
      details: 'password-auth-not-active',
    });
  });

  it('should return 400 when admin password-auth session sends empty password', async () => {
    await bootstrapPassword('oldpassword');

    const res = await request(app)
      .post('/change-password')
      .set('x-actual-token', adminPasswordToken)
      .send({ password: '', currentPassword: 'oldpassword' });

    expect(res.statusCode).toEqual(400);
    expect(res.body).toEqual({ status: 'error', reason: 'invalid-password' });
  });

  it('should return 200 when admin with password-auth session sends valid password', async () => {
    await bootstrapPassword('oldpassword');

    const res = await request(app)
      .post('/change-password')
      .set('x-actual-token', adminPasswordToken)
      .send({ password: 'newpassword', currentPassword: 'oldpassword' });

    expect(res.statusCode).toEqual(200);
    expect(res.body).toEqual({ status: 'ok', data: {} });
  });
  it.each([undefined, '', 'wrong', null, {}])(
    'rejects a stolen token without the current password: %j',
    async currentPassword => {
      await bootstrapPassword('oldpassword');
      const res = await request(app)
        .post('/change-password')
        .set('x-actual-token', adminPasswordToken)
        .send({ password: 'attacker password', currentPassword });
      expect(res.statusCode).toBe(400);
      expect(res.body.reason).toBe('invalid-current-password');
      expect(await checkPassword('oldpassword')).toBe(true);
      expect(
        getAccountDb().first('SELECT token FROM sessions WHERE token = ?', [
          adminPasswordToken,
        ]),
      ).not.toBeNull();
    },
  );

  it('rate limits incorrect current passwords', async () => {
    await bootstrapPassword('oldpassword');
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post('/change-password')
        .set('x-actual-token', adminPasswordToken)
        .send({ password: 'newpassword', currentPassword: 'wrong' });
    }
    const res = await request(app)
      .post('/change-password')
      .set('x-actual-token', adminPasswordToken)
      .send({ password: 'newpassword', currentPassword: 'oldpassword' });
    expect(res.statusCode).toBe(429);
    expect(await checkPassword('oldpassword')).toBe(true);
  });
});

describe('getLoginMethod()', () => {
  afterEach(() => {
    clearAuth();
  });

  it('returns the active DB method when no req is provided', () => {
    insertAuthRow('password', 1);
    expect(getLoginMethod(undefined)).toBe('password');
  });

  it('honors a client-requested method when it is active in DB', () => {
    insertAuthRow('openid', 1);
    const req = { body: { loginMethod: 'openid' } };
    expect(getLoginMethod(req)).toBe('openid');
  });

  it('honors a client-requested method that exists but is inactive in DB', () => {
    insertAuthRow('openid', 1);
    insertAuthRow('password', 0);
    const req = { body: { loginMethod: 'password' } };
    expect(getLoginMethod(req)).toBe('password');
  });

  it('ignores a client-requested method that is not in DB', () => {
    insertAuthRow('openid', 1);
    const req = { body: { loginMethod: 'password' } };
    expect(getLoginMethod(req)).toBe('openid');
  });

  it('falls back to config default when auth table is empty and no req', () => {
    // auth table is empty — getActiveLoginMethod() returns undefined
    // config default for loginMethod is 'password'
    expect(getLoginMethod(undefined)).toBe('password');
  });
});

describe('/login', () => {
  afterEach(() => {
    clearAuth();
  });

  it('should allow password login when OIDC is the active method', async () => {
    await bootstrapPassword('testpassword');
    insertAuthRow('openid', 1);
    getAccountDb().mutate(
      "UPDATE auth SET active = 0 WHERE method = 'password'",
    );

    const res = await request(app)
      .post('/login')
      .send({ loginMethod: 'password', password: 'testpassword' });

    expect(res.statusCode).toEqual(200);
    expect(res.body).toHaveProperty('status', 'ok');
    expect(res.body.data).toHaveProperty('token');
  });

  it('should reject wrong password even when method is explicitly requested', async () => {
    await bootstrapPassword('testpassword');
    insertAuthRow('openid', 1);
    getAccountDb().mutate(
      "UPDATE auth SET active = 0 WHERE method = 'password'",
    );

    const res = await request(app)
      .post('/login')
      .send({ loginMethod: 'password', password: 'wrongpassword' });

    expect(res.statusCode).toEqual(400);
    expect(res.body).toHaveProperty('reason', 'invalid-password');
  });
});

describe('/server-prefs', () => {
  describe('POST /server-prefs', () => {
    let adminUserId, basicUserId, adminSessionToken, basicSessionToken;

    beforeEach(() => {
      adminUserId = uuidv4();
      basicUserId = uuidv4();
      adminSessionToken = generateSessionToken();
      basicSessionToken = generateSessionToken();

      createUser(adminUserId, 'admin', ADMIN_ROLE);
      createUser(basicUserId, 'user', BASIC_ROLE);
      createSession(adminUserId, adminSessionToken);
      createSession(basicUserId, basicSessionToken);
    });

    afterEach(() => {
      deleteUser(adminUserId);
      deleteUser(basicUserId);
      clearServerPrefs();
    });

    it('should return 401 if no session token is provided', async () => {
      const res = await request(app)
        .post('/server-prefs')
        .send({
          prefs: { 'flags.plugins': 'true' },
        });

      expect(res.statusCode).toEqual(401);
      expect(res.body).toHaveProperty('status', 'error');
      expect(res.body).toHaveProperty('reason', 'unauthorized');
    });

    it('should return 403 if user is not an admin', async () => {
      const res = await request(app)
        .post('/server-prefs')
        .set('x-actual-token', basicSessionToken)
        .send({
          prefs: { 'flags.plugins': 'true' },
        });

      expect(res.statusCode).toEqual(403);
      expect(res.body).toEqual({
        status: 'error',
        reason: 'forbidden',
        details: 'permission-not-found',
      });
    });

    it('should return 400 if prefs is not an object', async () => {
      const res = await request(app)
        .post('/server-prefs')
        .set('x-actual-token', adminSessionToken)
        .send({
          prefs: 'invalid',
        });

      expect(res.statusCode).toEqual(400);
      expect(res.body).toEqual({
        status: 'error',
        reason: 'invalid-prefs',
      });
    });

    it('should return 400 if prefs is missing', async () => {
      const res = await request(app)
        .post('/server-prefs')
        .set('x-actual-token', adminSessionToken)
        .send({});

      expect(res.statusCode).toEqual(400);
      expect(res.body).toEqual({
        status: 'error',
        reason: 'invalid-prefs',
      });
    });

    it('should return 400 if prefs is null', async () => {
      const res = await request(app)
        .post('/server-prefs')
        .set('x-actual-token', adminSessionToken)
        .send({
          prefs: null,
        });

      expect(res.statusCode).toEqual(400);
      expect(res.body).toEqual({
        status: 'error',
        reason: 'invalid-prefs',
      });
    });

    it('should return 200 and save server preferences for admin user', async () => {
      const prefs = { 'flags.plugins': 'true' };

      const res = await request(app)
        .post('/server-prefs')
        .set('x-actual-token', adminSessionToken)
        .send({ prefs });

      expect(res.statusCode).toEqual(200);
      expect(res.body).toEqual({
        status: 'ok',
        data: {},
      });

      // Verify that preferences were saved
      const savedPrefs = getServerPrefs();
      expect(savedPrefs).toEqual(prefs);
    });

    it('should update existing server preferences', async () => {
      // First, set initial preferences
      getAccountDb().mutate(
        'INSERT INTO server_prefs (key, value) VALUES (?, ?)',
        ['flags.plugins', 'false'],
      );

      // Update preferences
      const updatedPrefs = { 'flags.plugins': 'true' };
      const res = await request(app)
        .post('/server-prefs')
        .set('x-actual-token', adminSessionToken)
        .send({ prefs: updatedPrefs });

      expect(res.statusCode).toEqual(200);
      expect(res.body).toEqual({
        status: 'ok',
        data: {},
      });

      // Verify that preferences were updated
      const savedPrefs = getServerPrefs();
      expect(savedPrefs).toEqual(updatedPrefs);
    });

    it('should save multiple server preferences', async () => {
      const prefs = {
        'flags.plugins': 'true',
        anotherKey: 'anotherValue',
      };

      const res = await request(app)
        .post('/server-prefs')
        .set('x-actual-token', adminSessionToken)
        .send({ prefs });

      expect(res.statusCode).toEqual(200);
      expect(res.body).toEqual({
        status: 'ok',
        data: {},
      });

      // Verify that all preferences were saved
      const savedPrefs = getServerPrefs();
      expect(savedPrefs).toEqual(prefs);
    });
  });
});

describe('logout', () => {
  it('revokes only the supplied token and allows repeated logout', async () => {
    const userId = uuidv4();
    const token = generateSessionToken();
    const otherToken = generateSessionToken();
    createUser(userId, userId, BASIC_ROLE);
    createSession(userId, token, 'password');
    createSession(userId, otherToken, 'password');
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await request(app).post('/logout').send({ token });
        expect(res.status).toBe(200);
      }
      expect(
        getAccountDb().first('SELECT token FROM sessions WHERE token = ?', [
          token,
        ]),
      ).toBeNull();
      expect(
        getAccountDb().first('SELECT token FROM sessions WHERE token = ?', [
          otherToken,
        ]),
      ).toEqual({ token: otherToken });
      for (const token of [undefined, '', null, [], {}]) {
        expect(
          (await request(app).post('/logout').send({ token })).status,
        ).toBe(400);
      }
      expect(
        getAccountDb().first('SELECT token FROM sessions WHERE token = ?', [
          otherToken,
        ]),
      ).toEqual({ token: otherToken });
    } finally {
      getAccountDb().mutate('DELETE FROM sessions WHERE user_id = ?', [userId]);
      deleteUser(userId);
    }
  });
});

describe('logout from an OpenID session', () => {
  let userId;
  beforeEach(() => {
    provider.discoveryFails = false;
    provider.endSession = true;
    userId = uuidv4();
    createUser(userId, userId, BASIC_ROLE);
    clearAuth();
    insertAuthRow(
      'openid',
      1,
      JSON.stringify({
        issuer: 'https://identity.example/.well-known/openid-configuration',
        client_id: 'client',
        client_secret: 'secret',
        server_hostname: 'https://actual.example',
      }),
    );
  });
  afterEach(() => {
    getAccountDb().mutate('DELETE FROM sessions WHERE user_id = ?', [userId]);
    deleteUser(userId);
    clearAuth();
  });
  const sessionRow = token =>
    getAccountDb().first('SELECT token FROM sessions WHERE token = ?', [token]);

  it('deletes the session and returns the provider logout URL', async () => {
    const token = generateSessionToken();
    createSession(userId, token, 'openid');
    const res = await request(app).post('/logout').send({
      token,
      returnTo: 'https://evil.example/',
      post_logout_redirect_uri: 'https://evil.example/',
    });
    expect(res.status).toBe(200);
    expect(sessionRow(token)).toBeNull();
    const url = new URL(res.body.data.providerLogoutUrl);
    expect(url.origin + url.pathname).toBe(
      'https://identity.example/oidc/logout',
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'client',
      post_logout_redirect_uri: 'https://actual.example/',
    });
  });

  // fork: sc-2970
  const ID_TOKEN = 'stored.id.token';
  const setIdToken = token =>
    getAccountDb().mutate('UPDATE sessions SET id_token = ? WHERE token = ?', [
      ID_TOKEN,
      token,
    ]);

  it('sends the stored ID token as id_token_hint, without logging it', async () => {
    const token = generateSessionToken();
    createSession(userId, token, 'openid');
    setIdToken(token);
    const logs = ['log', 'info', 'warn', 'error', 'debug'].map(m =>
      vi.spyOn(console, m),
    );
    try {
      const res = await request(app).post('/logout').send({ token });
      expect(res.status).toBe(200);
      expect(sessionRow(token)).toBeNull();
      const url = new URL(res.body.data.providerLogoutUrl);
      expect(Object.fromEntries(url.searchParams)).toEqual({
        client_id: 'client',
        post_logout_redirect_uri: 'https://actual.example/',
        id_token_hint: ID_TOKEN,
      });
      for (const log of logs) {
        expect(JSON.stringify(log.mock.calls)).not.toContain(ID_TOKEN);
      }
    } finally {
      for (const log of logs) log.mockRestore();
    }
  });

  it('still answers with no URL when discovery fails for a session with an ID token', async () => {
    provider.discoveryFails = true;
    const token = generateSessionToken();
    createSession(userId, token, 'openid');
    setIdToken(token);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const res = await request(app).post('/logout').send({ token });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ok', data: {} });
      expect(sessionRow(token)).toBeNull();
      expect(JSON.stringify(log.mock.calls)).not.toContain(ID_TOKEN);
    } finally {
      log.mockRestore();
    }
  });

  it('never adds the hint to the Auth0 /v2/logout fallback', async () => {
    provider.endSession = false;
    getAccountDb().mutate(
      "UPDATE auth SET extra_data = ? WHERE method = 'openid'",
      [
        JSON.stringify({
          issuer:
            'https://tenant.us.auth0.com/.well-known/openid-configuration',
          client_id: 'client',
          client_secret: 'secret',
          server_hostname: 'https://actual.example',
        }),
      ],
    );
    const token = generateSessionToken();
    createSession(userId, token, 'openid');
    setIdToken(token);
    const res = await request(app).post('/logout').send({ token });
    expect(res.body.data.providerLogoutUrl).toBe(
      'https://tenant.us.auth0.com/v2/logout?client_id=client&returnTo=https%3A%2F%2Factual.example%2F',
    );
  });

  it('keeps the ID token out of getSession and authenticated responses', async () => {
    const token = generateSessionToken();
    createSession(userId, token, 'openid');
    setIdToken(token);
    expect(getSession(token)).not.toHaveProperty('id_token');
    const res = await request(app)
      .get('/validate')
      .set('x-actual-token', token);
    expect(res.statusCode).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(ID_TOKEN);
  });

  it('returns no URL for a password session or an unknown token', async () => {
    const token = generateSessionToken();
    createSession(userId, token, 'password');
    for (const t of [token, generateSessionToken()]) {
      const res = await request(app).post('/logout').send({ token: t });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ok', data: {} });
    }
    expect(sessionRow(token)).toBeNull();
  });

  it('still deletes the session when discovery fails', async () => {
    provider.discoveryFails = true;
    const token = generateSessionToken();
    createSession(userId, token, 'openid');
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const res = await request(app).post('/logout').send({ token });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ok', data: {} });
      expect(sessionRow(token)).toBeNull();
    } finally {
      log.mockRestore();
    }
  });
});

describe('/validate', () => {
  // The hosted MCP entry relies on this: it reads `data.permission` to refuse
  // an ADMIN session token in production (mcp-remote, task 8.1).
  it.each([ADMIN_ROLE, BASIC_ROLE])(
    "returns the %s permission of the token's user",
    async role => {
      const userId = uuidv4();
      const token = generateSessionToken();
      createUser(userId, `validate-${role}-${userId}`, role);
      createSession(userId, token);

      const res = await request(app)
        .get('/validate')
        .set('x-actual-token', token);

      expect(res.statusCode).toEqual(200);
      expect(res.body.data.validated).toBe(true);
      expect(res.body.data.permission).toBe(role);

      getAccountDb().mutate('DELETE FROM sessions WHERE token = ?', [token]);
      deleteUser(userId);
    },
  );

  it('rejects an unknown token', async () => {
    const res = await request(app)
      .get('/validate')
      .set('x-actual-token', 'nope');
    expect(res.statusCode).toEqual(401);
  });
});
